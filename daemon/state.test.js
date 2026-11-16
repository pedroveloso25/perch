const test = require("node:test");
const assert = require("node:assert/strict");
const { createState, SESSION_TTL_MS, TOOL_TTL_MS, DONE_HOLD_MS } = require("./state");

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  return { s: createState({ now: clock.now }), clock };
}

const ev = (event, session_id = "a", tool) => ({ event, session_id, tool });

test("começa idle", () => {
  const { s } = setup();
  assert.equal(s.derive().state, "idle");
});

test("working reporta a tool da sessão mais recente", () => {
  const { s, clock } = setup();
  s.handle(ev("working", "a", "Read"));
  clock.advance(10);
  s.handle(ev("working", "b", "Bash"));
  assert.deepEqual(s.derive(), { state: "working", tool: "Bash", sessions: 2 });
});

test("blocked tem precedência sobre working", () => {
  const { s } = setup();
  s.handle(ev("working", "a", "Edit"));
  s.handle(ev("blocked", "b"));
  assert.equal(s.derive().state, "blocked");
});

test("stop só celebra quando a última sessão termina", () => {
  const { s } = setup();
  s.handle(ev("working", "a"));
  s.handle(ev("working", "b"));
  s.handle(ev("stop", "a"));
  assert.equal(s.derive().state, "working");
  s.handle(ev("stop", "b"));
  assert.equal(s.derive().state, "done");
});

test("done decai para idle depois do hold", () => {
  const { s, clock } = setup();
  s.handle(ev("working"));
  s.handle(ev("stop"));
  clock.advance(DONE_HOLD_MS);
  assert.equal(s.sweep().changed, true);
  assert.equal(s.derive().state, "idle");
});

test("stop de sessão desconhecida não celebra", () => {
  const { s } = setup();
  s.handle(ev("stop", "fantasma"));
  assert.equal(s.derive().state, "idle");
});

test("SessionEnd depois de Stop não reinicia o done", () => {
  const { s, clock } = setup();
  s.handle(ev("working"));
  s.handle(ev("stop"));
  clock.advance(DONE_HOLD_MS - 1);
  s.handle(ev("end"));
  clock.advance(1);
  s.sweep();
  assert.equal(s.derive().state, "idle");
});

test("SessionEnd com sessão ativa remove sem celebrar", () => {
  const { s } = setup();
  s.handle(ev("working"));
  s.handle(ev("end"));
  assert.equal(s.derive().state, "idle");
});

test("sessão ociosa expira pelo TTL curto", () => {
  const { s, clock } = setup();
  s.handle(ev("working")); // UserPromptSubmit: sem tool
  clock.advance(SESSION_TTL_MS + 1);
  assert.deepEqual(s.sweep().expired, ["a"]);
  assert.equal(s.derive().state, "idle");
});

test("tool longa não expira pelo TTL curto", () => {
  const { s, clock } = setup();
  s.handle(ev("working", "a", "Bash"));
  clock.advance(SESSION_TTL_MS + 1);
  s.sweep();
  assert.equal(s.derive().state, "working");
  clock.advance(TOOL_TTL_MS);
  s.sweep();
  assert.equal(s.derive().state, "idle");
});

test("tool-done volta ao TTL curto e mantém a tool", () => {
  const { s, clock } = setup();
  s.handle(ev("working", "a", "Bash"));
  s.handle(ev("tool-done"));
  assert.equal(s.derive().tool, "Bash");
  clock.advance(SESSION_TTL_MS + 1);
  s.sweep();
  assert.equal(s.derive().state, "idle");
});

test("ping renova o TTL", () => {
  const { s, clock } = setup();
  s.handle(ev("working"));
  clock.advance(SESSION_TTL_MS - 1);
  s.handle(ev("ping"));
  clock.advance(SESSION_TTL_MS - 1);
  s.sweep();
  assert.equal(s.derive().state, "working");
});

test("trabalho novo cancela o done pendente", () => {
  const { s } = setup();
  s.handle(ev("working"));
  s.handle(ev("stop"));
  s.handle(ev("working"));
  s.handle(ev("blocked"));
  s.handle(ev("stop"));
  // o done do segundo stop vale; o primeiro não deveria "vazar" para depois
  assert.equal(s.derive().state, "done");
});

test("evento desconhecido é rejeitado", () => {
  const { s } = setup();
  assert.equal(s.handle(ev("bagunça")), false);
});

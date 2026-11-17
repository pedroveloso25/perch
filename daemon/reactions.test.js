const test = require("node:test");
const assert = require("node:assert/strict");
const { createReactions } = require("./reactions");

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("eventos de sessão não são reação (seguem para state.js)", () => {
  const r = createReactions();
  assert.equal(r.handle({ event: "working", session_id: "a" }), null);
  assert.equal(r.handle(null), null);
});

test("reação válida passa com a fonte", () => {
  const r = createReactions();
  assert.deepEqual(r.handle({ event: "react", kind: "celebrate", source: "build" }),
    { ok: true, reaction: { kind: "celebrate", source: "build" } });
});

test("tipo desconhecido é recusado", () => {
  const r = createReactions();
  assert.deepEqual(r.handle({ event: "react", kind: "explodir" }), { ok: false });
  assert.deepEqual(r.handle({ event: "react" }), { ok: false });
});

test("fonte ausente ou estranha não quebra", () => {
  const r = createReactions({ minGapMs: 0 });
  assert.equal(r.handle({ event: "react", kind: "hello" }).reaction.source, "desconhecida");
  assert.equal(r.handle({ event: "react", kind: "hello", source: { x: 1 } }).reaction.source, "desconhecida");
  assert.equal(r.handle({ event: "react", kind: "hello", source: "x".repeat(100) }).reaction.source.length, 40);
});

test("intervalo mínimo: rajada vira uma reação só", () => {
  const c = clock();
  const r = createReactions({ now: c.now });
  assert.ok(r.handle({ event: "react", kind: "alert" }).reaction);
  c.advance(100);
  assert.deepEqual(r.handle({ event: "react", kind: "alert" }), { ok: true, reaction: null });
  c.advance(500);
  assert.ok(r.handle({ event: "react", kind: "alert" }).reaction);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { status, install, uninstall, isPerchHook, EVENTS } = require("./claude-hooks");

const REPO = "C:/Users/pedro/OneDrive/Documentos/Projetos/pessoal/desktop pet/perch/hooks/notify.js";
const APP = "C:\\Users\\pedro\\AppData\\Local\\Programs\\Perch\\resources\\hooks\\notify.js";

// Formato real do settings do usuário (hooks apontando para o repo) + coisas alheias.
function userSettings() {
  const hooks = {};
  for (const [event, { arg, matcher }] of Object.entries(EVENTS))
    hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: `node "${REPO}" ${arg}`, async: true, timeout: 5 }] }];
  hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command: "node C:/outro/projeto/notify.js working" }] });
  return { model: "opus", tui: { tema: "escuro" }, hooks };
}

test("reconhece só o notify.js de uma pasta perch", () => {
  assert.ok(isPerchHook({ type: "command", command: `node "${REPO}" working` }));
  assert.ok(isPerchHook({ type: "command", command: `node "${APP.replace(/\\/g, "/")}" stop` }));
  assert.ok(isPerchHook({ type: "command", command: `node "${APP}" stop` }));
  assert.ok(!isPerchHook({ type: "command", command: "node C:/outro/projeto/notify.js working" }));
  assert.ok(!isPerchHook({ type: "command", command: "node C:/perch-fake/notify.js working" }));
  assert.ok(!isPerchHook({ type: "command", command: "echo perch" }));
});

test("status: hooks do repo contam como 'other' para o app instalado", () => {
  const s = status(userSettings(), APP);
  assert.equal(s.state, "other");
  assert.deepEqual(s.paths, [REPO]);
  assert.equal(status(userSettings(), REPO).state, "connected");
  assert.equal(status({}, APP).state, "none");
});

test("install troca os hooks antigos do perch, sem duplicar e sem tocar no resto", () => {
  const before = userSettings();
  const after = install(before, APP);
  assert.equal(status(after, APP).state, "connected");
  assert.equal(after.model, "opus");
  assert.deepEqual(after.tui, { tema: "escuro" });
  // PreToolUse: o hook alheio fica, o do perch é um só (o novo).
  const pre = after.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(pre.length, 2);
  assert.ok(pre.includes("node C:/outro/projeto/notify.js working"));
  assert.ok(pre.some((c) => c.includes("Programs/Perch/resources/hooks/notify.js") && c.endsWith(" working")));
  assert.ok(!JSON.stringify(after).includes("desktop pet/perch/hooks"), "repo antigo saiu");
  // o original não foi alterado (funções puras)
  assert.equal(status(before, REPO).state, "connected");
});

test("install é idempotente", () => {
  const once = install(userSettings(), APP);
  assert.deepEqual(install(once, APP), once);
});

test("hooks criados são async com timeout curto e matcher onde precisa", () => {
  const s = install({}, APP);
  for (const [event, { matcher }] of Object.entries(EVENTS)) {
    const [g] = s.hooks[event];
    assert.equal(g.matcher, matcher);
    assert.equal(g.hooks[0].async, true);
    assert.equal(g.hooks[0].timeout, 5);
  }
});

test("uninstall tira só o perch e limpa o que ficou vazio", () => {
  const s = uninstall(userSettings());
  assert.deepEqual(Object.keys(s.hooks), ["PreToolUse"]);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.model, "opus");
  assert.deepEqual(uninstall({ model: "x" }), { model: "x" });
  assert.equal(uninstall(install({}, APP)).hooks, undefined);
});

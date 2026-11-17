const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrain } = require("./brain");

// rng determinístico: devolve a sequência dada, em loop.
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

const FLOOR = { active: true, userIdle: 0, locked: false, free: true, x: 500, minX: 100, maxX: 1800 };

// Avança `secs` segundos em passos de 0,1 s e devolve a última decisão.
function run(brain, secs, s = FLOOR) {
  let r;
  for (let t = 0; t < secs; t += 0.1) r = brain.update(0.1, s);
  return r;
}

test("começa parado e, depois do descanso, sai para passear", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) }); // descanso mínimo, decide passear, destino longe
  assert.equal(b.activity, "rest");
  const r = run(b, 7);
  assert.equal(r.activity, "walk");
  assert.ok(Math.abs(r.target - 500) >= 80);
  assert.ok(r.target >= 100 && r.target <= 1800);
});

test("passeio anda na velocidade certa, para no destino e volta a descansar", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  run(b, 7);
  const target = b.target;
  let x = 500;
  for (let i = 0; i < 1000 && b.activity === "walk"; i++) {
    x = b.walkStep(x, 0.1);
    b.update(0.1, { ...FLOOR, x });
  }
  assert.equal(x, target);
  assert.equal(b.activity, "rest");
  assert.equal(createBrain().walkStep(0, 1), 0, "sem passeio, não anda");
});

test("dorme depois de 2 min sem input e acorda quando você volta", () => {
  const b = createBrain();
  assert.equal(run(b, 1, { ...FLOOR, userIdle: 130 }).activity, "sleep");
  assert.equal(run(b, 5, { ...FLOOR, userIdle: 135 }).activity, "sleep", "continua dormindo");
  assert.equal(b.update(0.1, { ...FLOOR, userIdle: 0.5 }).activity, "wake");
  assert.equal(run(b, 2, FLOOR).activity, "rest", "acordar dura pouco");
});

test("tela bloqueada faz dormir na hora", () => {
  const b = createBrain();
  assert.equal(b.update(0.1, { ...FLOOR, locked: true }).activity, "sleep");
  assert.equal(b.update(0.1, { ...FLOOR, locked: true, userIdle: 0 }).activity, "sleep", "bloqueada não acorda");
});

test("clique acorda (mesmo com você ausente) e interrompe o passeio", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  run(b, 1, { ...FLOOR, userIdle: 300 });
  b.poke();
  assert.equal(b.update(0.1, { ...FLOOR, userIdle: 300 }).activity, "wake");

  const w = createBrain({ rng: seq(0, 0.1, 0.9) });
  run(w, 7);
  assert.equal(w.activity, "walk");
  w.poke();
  assert.equal(w.activity, "rest");
});

test("Claude trabalhando: nada de passear nem dormir; acorda se estava dormindo", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  run(b, 1, { ...FLOOR, userIdle: 200 });
  assert.equal(b.activity, "sleep");
  const busy = { ...FLOOR, active: false, userIdle: 200 };
  assert.equal(run(b, 60, busy).activity, "rest");
  assert.equal(b.target, null);
});

test("não passeia nem dorme no colo ou caindo", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  assert.equal(run(b, 30, { ...FLOOR, free: false }).activity, "rest");
  assert.equal(run(b, 1, { ...FLOOR, free: false, userIdle: 500 }).activity, "rest");
});

test("pegaram no colo no meio do passeio: para", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  run(b, 7);
  assert.equal(b.activity, "walk");
  assert.equal(b.update(0.1, { ...FLOOR, free: false }).activity, "rest");
});

test("chão estreito demais: não passeia", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  assert.equal(run(b, 60, { ...FLOOR, minX: 450, maxX: 550 }).activity, "rest");
});

test("configure: sono mais cedo e ninguém passeia", () => {
  const b = createBrain({ rng: seq(0, 0.1, 0.9) });
  b.configure({ sleepAfter: 30, walkChance: 0, lixo: 1, restMin: "x" });
  assert.equal(run(b, 1, { ...FLOOR, userIdle: 40 }).activity, "sleep");
  const c = createBrain({ rng: seq(0, 0.1, 0.9) });
  c.configure({ walkChance: 0 });
  assert.equal(run(c, 60).activity, "rest");
});

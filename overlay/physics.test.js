const test = require("node:test");
const assert = require("node:assert/strict");
const { createBody, releaseVelocity } = require("./physics");

const AREA = { x: 0, y: 0, width: 1920, height: 1040 }; // chão em y = 1040
const EXT = { side: 50, up: 120 };

// Roda até parar (ou estourar o limite) e devolve os eventos.
function settle(body, area = AREA, ext = EXT, maxSteps = 2000) {
  const impacts = [];
  for (let i = 0; i < maxSteps; i++) {
    const r = body.step(1 / 60, area, ext);
    if (r.impact) impacts.push(r.impact);
    if (r.resting) return { impacts, steps: i + 1 };
  }
  return { impacts, steps: Infinity };
}

test("solto no ar cai até o chão e para", () => {
  const b = createBody();
  b.place(500, 300);
  const { steps, impacts } = settle(b);
  assert.ok(Number.isFinite(steps));
  assert.equal(b.y, 1040);
  assert.equal(b.x, 500);
  assert.ok(impacts[0] > 1500, "primeiro pouso vem rápido");
});

test("quica pouco: cada pouso é mais fraco e termina parado", () => {
  const b = createBody();
  b.place(500, 100);
  const { impacts } = settle(b);
  assert.ok(impacts.length >= 2 && impacts.length <= 4, `quiques: ${impacts.length}`);
  for (let i = 1; i < impacts.length; i++) assert.ok(impacts[i] < impacts[i - 1]);
});

test("já no chão: parado no primeiro passo, sem impacto", () => {
  const b = createBody();
  b.place(500, 1040);
  const r = b.step(1 / 60, AREA, EXT);
  assert.equal(r.resting, true);
  assert.equal(r.impact, 0);
});

test("solto abaixo do chão (sobre a barra de tarefas) sobe para o chão", () => {
  const b = createBody();
  b.place(500, 1070);
  settle(b);
  assert.equal(b.y, 1040);
});

test("arremesso bate na parede pela meia largura do pet e volta", () => {
  const b = createBody();
  b.place(1800, 900);
  b.throw(2000, 0);
  let maxX = 0;
  for (let i = 0; i < 600; i++) {
    b.step(1 / 60, AREA, EXT);
    maxX = Math.max(maxX, b.x);
  }
  assert.equal(maxX, 1920 - 50);
  assert.ok(b.x < 1870);
});

test("arremesso para cima não tira a cabeça da tela", () => {
  const b = createBody();
  b.place(500, 1040);
  b.throw(0, -2500);
  let minY = Infinity;
  for (let i = 0; i < 300; i++) {
    b.step(1 / 60, AREA, EXT);
    minY = Math.min(minY, b.y);
  }
  assert.ok(minY >= 120);
});

test("arremesso limitado a maxThrow", () => {
  const b = createBody({ maxThrow: 1000 });
  b.throw(3000, 4000);
  assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 1000) < 1e-9);
});

test("monitor com workArea deslocada (segundo monitor à esquerda, mais alto)", () => {
  const area = { x: -1280, y: -200, width: 1280, height: 984 }; // chão em y = 784
  const b = createBody();
  b.place(-600, -100);
  settle(b, area);
  assert.equal(b.y, 784);
  assert.equal(b.x, -600);
});

test("desliza no chão depois de um arremesso lateral e para", () => {
  const b = createBody();
  b.place(500, 1040);
  b.throw(800, 0);
  const { steps } = settle(b);
  assert.ok(Number.isFinite(steps));
  assert.ok(b.x > 500 && b.x < 700);
});

test("releaseVelocity usa só o fim do gesto", () => {
  const s = [
    { t: 0, x: 0, y: 0 },
    { t: 500, x: 0, y: 0 },    // ficou parado segurando...
    { t: 550, x: 50, y: 0 },
    { t: 600, x: 100, y: -20 }, // ...e jogou para a direita
  ];
  const v = releaseVelocity(s);
  assert.equal(v.vx, 1000);
  assert.equal(v.vy, -200);
});

test("releaseVelocity sem movimento suficiente é zero", () => {
  assert.deepEqual(releaseVelocity([]), { vx: 0, vy: 0 });
  assert.deepEqual(releaseVelocity([{ t: 0, x: 1, y: 1 }]), { vx: 0, vy: 0 });
});

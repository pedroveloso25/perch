const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, remove } = require("./bgremove");

// Imagem w×h preenchida com `bg`; paint(x, y) devolve [r,g,b,a] ou null.
function image(w, h, bg, paint = () => null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) || [...bg, 255];
      data.set(c, (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}
const alphaAt = (img, out, x, y) => out[(y * img.width + x) * 4 + 3];

const RED = [220, 60, 40, 255];
const WHITE = [255, 255, 255];

test("cor do fundo = mediana da borda, mesmo com ruído", () => {
  const img = image(20, 20, WHITE, (x, y) => (x === 0 && y < 3 ? [0, 0, 0, 255] : null));
  assert.deepEqual(analyze(img).bg, [255, 255, 255]);
  assert.equal(analyze(img).transparent, false);
});

test("detecta imagem que já tem fundo transparente", () => {
  const img = image(20, 20, [0, 0, 0], (x, y) => (x > 5 && x < 15 && y > 5 && y < 15 ? RED : [0, 0, 0, 0]));
  assert.equal(analyze(img).transparent, true);
});

test("fundo branco some, personagem fica opaco", () => {
  const img = image(30, 30, WHITE, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? RED : null));
  const { data, removed } = remove(img);
  assert.equal(alphaAt(img, data, 0, 0), 0);
  assert.equal(alphaAt(img, data, 15, 15), 255);
  assert.ok(Math.abs(removed - (900 - 100) / 900) < 0.01);
});

test("branco DENTRO do personagem (olho) fica, a menos que holes", () => {
  const img = image(30, 30, WHITE, (x, y) => {
    if (x === 15 && y === 15) return [255, 255, 255, 255]; // o "olho"
    return x >= 10 && x < 20 && y >= 10 && y < 20 ? RED : null;
  });
  assert.equal(alphaAt(img, remove(img).data, 15, 15), 255);
  assert.equal(alphaAt(img, remove(img, { holes: true }).data, 15, 15), 0);
});

test("fundo levemente irregular (compressão JPEG) dentro da tolerância", () => {
  const img = image(30, 30, WHITE, (x, y) => {
    if (x >= 10 && x < 20 && y >= 10 && y < 20) return RED;
    const n = (x * 7 + y * 13) % 9; // ruído determinístico de até 8 níveis
    return [255 - n, 255 - n, 250 - n, 255];
  });
  const { data } = remove(img, { tolerance: 30 });
  for (const [x, y] of [[0, 0], [5, 25], [29, 29], [25, 3]]) assert.equal(alphaAt(img, data, x, y), 0);
});

test("contorno anti-aliased vira semitransparente e perde o halo branco", () => {
  // Pixel de borda = 50% vermelho + 50% branco.
  const mix = RED.slice(0, 3).map((c, i) => Math.round((c + WHITE[i]) / 2));
  const img = image(30, 30, WHITE, (x, y) => {
    if (x >= 10 && x < 20 && y >= 10 && y < 20) return RED;
    if (x === 9 && y >= 10 && y < 20) return [...mix, 255];
    return null;
  });
  const { data } = remove(img, { tolerance: 30 });
  const i = (15 * 30 + 9) * 4;
  assert.ok(data[i + 3] > 0 && data[i + 3] < 255, `alfa ${data[i + 3]}`);
  assert.ok(data[i + 1] < 160, `verde descontaminado: ${data[i + 1]}`); // sem desmistura seria ~158+
});

test("tolerância zero não come o personagem", () => {
  const img = image(30, 30, WHITE, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? RED : null));
  const { data } = remove(img, { tolerance: 0 });
  assert.equal(alphaAt(img, data, 15, 15), 255);
  assert.equal(alphaAt(img, data, 0, 0), 0);
});

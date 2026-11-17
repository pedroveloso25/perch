/* Remoção de fundo por preenchimento a partir das bordas (Fase 3).

   Funciona para o caso comum de mascote: fundo de cor sólida (ou quase) que
   encosta nas bordas da imagem — branco de imagem gerada por IA, cor chapada
   de pixel art. Não é IA: foto com fundo complexo não sai limpa.

   1. A cor do fundo é a mediana dos pixels da borda.
   2. Flood fill (4 vizinhos) a partir da borda por pixels "parecidos" com
      ela (distância RGB <= tolerância). Só o que é alcançável vira fundo, então
      o branco do olho do personagem fica; "holes" remove também os bolsões
      fechados (o vão entre as pernas).
   3. Borda suave: o contorno (pixels que encostam no fundo) é tratado como
      mistura de fundo + personagem. O alfa é a distância do pixel ao fundo
      dividida pela do vizinho mais "personagem" (meio-a-meio dá 0,5), e a
      cor do fundo é descontada. Sem isso sobra um halo branco em volta do
      pet sobre fundo escuro. Contorno chapado (pixel art) fica opaco.

   Roda no navegador (window.BgRemove) e no Node (testes). */

(function (root) {
  const SEE_THROUGH = 16; // alfa abaixo disto já é transparente

  function median(values) {
    const s = values.slice().sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 255;
  }

  /**
   * @param img { width, height, data: RGBA }
   * @returns { bg: [r,g,b], transparent: a imagem já tem fundo transparente }
   */
  function analyze(img) {
    const { width: w, height: h, data } = img;
    const r = [], g = [], b = [];
    let clear = 0, total = 0;
    const visit = (x, y) => {
      const i = (y * w + x) * 4;
      total++;
      if (data[i + 3] < SEE_THROUGH) { clear++; return; }
      r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]);
    };
    for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { visit(0, y); visit(w - 1, y); }
    // Metade da borda transparente: a imagem já foi recortada antes.
    return { bg: [median(r), median(g), median(b)], transparent: clear / total > 0.5 };
  }

  /**
   * @param opts { tolerance: 0-200 (distância RGB), holes, soft: borda suave, bg? }
   * @returns { data: novo RGBA, removed: fração de pixels que virou fundo }
   */
  function remove(img, { tolerance = 40, holes = false, soft = true, bg } = {}) {
    const { width: w, height: h, data } = img;
    const [br, bgc, bb] = bg || analyze(img).bg;
    const n = w * h;
    const dist = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4)
      dist[p] = data[i + 3] < SEE_THROUGH ? 0
        : Math.hypot(data[i] - br, data[i + 1] - bgc, data[i + 2] - bb);

    const isBg = new Uint8Array(n);
    const passable = (p) => dist[p] <= tolerance;
    if (holes) {
      for (let p = 0; p < n; p++) if (passable(p)) isBg[p] = 1;
    } else {
      const stack = [];
      const seed = (p) => { if (!isBg[p] && passable(p)) { isBg[p] = 1; stack.push(p); } };
      for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (stack.length) {
        const p = stack.pop(), x = p % w;
        if (x > 0) seed(p - 1);
        if (x < w - 1) seed(p + 1);
        if (p >= w) seed(p - w);
        if (p < n - w) seed(p + w);
      }
    }

    const out = new Uint8ClampedArray(data);
    let removed = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (isBg[p]) { out[i + 3] = 0; removed++; continue; }
      if (!soft) continue;
      // Só o contorno (encosta em fundo) ganha borda suave.
      const x = p % w, y = (p / w) | 0;
      const touches = (x > 0 && isBg[p - 1]) || (x < w - 1 && isBg[p + 1])
        || (p >= w && isBg[p - w]) || (p < n - w && isBg[p + w]);
      if (!touches) continue;
      // Referência de "personagem puro": o vizinho (8) mais longe do fundo.
      let fg = dist[p];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!isBg[q] && dist[q] > fg) fg = dist[q];
        }
      if (fg <= dist[p] * 1.05) continue; // contorno chapado: fica opaco
      const a = Math.min(1, Math.max(0.05, dist[p] / fg));
      // Desmistura: c = a*cor + (1-a)*fundo  =>  cor = (c - (1-a)*fundo) / a
      out[i] = (data[i] - (1 - a) * br) / a;
      out[i + 1] = (data[i + 1] - (1 - a) * bgc) / a;
      out[i + 2] = (data[i + 2] - (1 - a) * bb) / a;
      out[i + 3] = data[i + 3] * a;
    }
    return { data: out, removed: removed / n };
  }

  const api = { analyze, remove };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BgRemove = api;
})(typeof window !== "undefined" ? window : globalThis);

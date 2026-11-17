"use strict";

/* Motor de animação por deformação de malha (Fase 2, validado em poc/mesh).

   A imagem vira uma grade de vértices e cada frame recalcula a posição deles:
   respiração, balanço e bob são funções do tempo; gelatina e squash são molas.
   O renderer não mexe em vértice nenhum: escolhe o "humor" (setMood) e avisa
   de eventos (pulo, agarrou, a janela andou). */

const PetMesh = (() => {
  const TAU = Math.PI * 2;
  const ALPHA_MIN = 24;   // 0-255: abaixo disso o pixel é fundo (recorte e pés)
  const MAX_TEX = 1024;   // imagens maiores são reduzidas antes de virar textura
  const STEP = 1 / 120;   // passo fixo da física
  const JELLY_K = 0.3;    // escala interna da força de inércia sobre os vértices

  const DEFAULTS = {
    // Humor: o renderer troca estes por estado, com transição suave.
    breathAmp: 0.03, breathHz: 0.35, swayAmp: 0.02, swayHz: 0.3, bobAmp: 0, bobHz: 0.5,
    // Corpo: valores afinados na PoC.
    swayWave: 1.2,
    jellyGain: 1, jellyHz: 3.2, jellyDamp: 0.16, jellyFalloff: 1.5, jellySpread: 0.45, hangWeight: 0.5,
    squashGain: 1, squashHz: 5, squashDamp: 0.22, volume: 0.8,
    gravity: 2500, hopSpeed: 380, impactK: 0.012, stretchK: 0.0004, stretchGain: 1,
  };
  const MOOD_KEYS = ["breathAmp", "breathHz", "swayAmp", "swayHz", "bobAmp", "bobHz"];

  /**
   * Prepara uma imagem: recorta no que é opaco e acha o personagem (a maior
   * "ilha" de pixels opacos; balão de pensamento, objeto solto e sujeira da
   * remoção de fundo ficam de fora) e os pés dele. Isso alimenta o palpite
   * automático de tamanho e chão em place().
   *
   * Retorna, em px da textura recortada: canvas, w, h, alpha, bottom (base do
   * recorte), comp {x0, y0, x1, y1, feetX} (personagem) e k (px da textura
   * por px da imagem original; o pet.json fala em px originais).
   */
  function analyze(source) {
    const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    const k = Math.min(1, MAX_TEX / Math.max(sw, sh));
    const W = Math.max(1, Math.round(sw * k)), H = Math.max(1, Math.round(sh * k));
    const full = document.createElement("canvas");
    full.width = W; full.height = H;
    const fctx = full.getContext("2d", { willReadFrequently: true });
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(source, 0, 0, W, H);
    const data = fctx.getImageData(0, 0, W, H).data; // lança se a imagem vier sem CORS

    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[(y * W + x) * 4 + 3] > ALPHA_MIN) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }

    // 2px de margem transparente: a borda da malha amostra transparente, sem serrilhado.
    const pad = 2;
    const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad);
    const cw = Math.min(W, x1 + pad + 1) - cx0, ch = Math.min(H, y1 + pad + 1) - cy0;
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    canvas.getContext("2d").drawImage(full, cx0, cy0, cw, ch, 0, 0, cw, ch);

    const alpha = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) alpha[y * cw + x] = data[((y + cy0) * W + (x + cx0)) * 4 + 3];

    const comp = largestIsland(alpha, cw, ch);
    return { canvas, w: cw, h: ch, alpha, bottom: y1 + 1 - cy0, comp, k };
  }

  /**
   * Maior componente conectado (8 vizinhos) do alfa, numa grade reduzida de
   * no máximo ~256 células por lado: rápido e imune a buracos de 1px.
   * feetX = centro das células do componente na faixa de 8% de baixo.
   */
  function largestIsland(alpha, w, h) {
    const cell = Math.max(1, Math.ceil(Math.max(w, h) / 256));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const solid = new Uint8Array(gw * gh);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (alpha[y * w + x] > ALPHA_MIN) solid[((y / cell) | 0) * gw + ((x / cell) | 0)] = 1;

    const label = new Int32Array(gw * gh).fill(-1);
    const stack = [];
    let best = null;
    for (let start = 0; start < solid.length; start++) {
      if (!solid[start] || label[start] >= 0) continue;
      const id = start;
      let area = 0, bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
      label[start] = id;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop(), cx = i % gw, cy = (i / gw) | 0;
        area++;
        if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx;
        if (cy < by0) by0 = cy; if (cy > by1) by1 = cy;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const n = ny * gw + nx;
            if (solid[n] && label[n] < 0) { label[n] = id; stack.push(n); }
          }
      }
      if (!best || area > best.area) best = { id, area, bx0, by0, bx1, by1 };
    }
    if (!best) return { x0: 0, y0: 0, x1: w, y1: h, feetX: w / 2 };

    const band = Math.max(1, Math.round((best.by1 - best.by0 + 1) * 0.08));
    let sx = 0, n = 0;
    for (let cy = best.by1 - band + 1; cy <= best.by1; cy++)
      for (let cx = best.bx0; cx <= best.bx1; cx++)
        if (label[cy * gw + cx] === best.id) { sx += cx + 0.5; n++; }
    return {
      x0: best.bx0 * cell, y0: best.by0 * cell,
      x1: Math.min(w, (best.bx1 + 1) * cell), y1: Math.min(h, (best.by1 + 1) * cell),
      feetX: (n ? sx / n : (best.bx0 + best.bx1 + 1) / 2) * cell,
    };
  }

  /**
   * Palpite automático para uma imagem: personagem com `height` px de altura
   * na tela e pés na base do personagem (o que fica abaixo dele, como o fogo
   * de um foguete, não levanta o pet). Unidades do pet.json: scale = px da
   * tela por px da imagem ORIGINAL; floor = px originais entre a base do
   * recorte e os pés.
   */
  function autoEntry(s, height) {
    const charH = (s.comp.y1 - s.comp.y0) / s.k;
    // max(0): a grade de ilhas arredonda para cima e podia pôr os pés abaixo da imagem.
    return { scale: height / Math.max(1, charH), floor: Math.max(0, s.bottom - s.comp.y1) / s.k };
  }

  const DEFAULT_HEIGHT = 120; // altura do personagem na tela, quando o pet.json não diz
  const FOOT_MARGIN = 14;     // pés -> base da janela

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // sem isto o canvas fica "tainted" e getImageData lança
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  const load = (url) => loadImage(url).then(analyze);

  /** pet://p/<pet>/<arquivo> (ver registerPetProtocol no main). */
  const url = (pet, file) => `pet://p/${encodeURIComponent(pet)}/${encodeURIComponent(file)}`;

  /**
   * Janela que cabe todas as imagens com os pés no mesmo ponto (centro, a
   * `foot` px da base), com folga para pulo, balanço e o que fica abaixo dos
   * pés. Calculada sobre TODAS as imagens: a janela não muda a cada estado.
   * @param items [{ s, p }] — sprite analisado + place()
   */
  function windowSize(items) {
    let side = 0, up = 0, down = 0;
    for (const { s, p } of items) {
      side = Math.max(side, p.pivot.x * p.ds, (s.w - p.pivot.x) * p.ds);
      up = Math.max(up, p.pivot.y * p.ds);
      down = Math.max(down, (s.h - p.pivot.y) * p.ds);
    }
    const foot = Math.ceil(Math.max(FOOT_MARGIN, down + 4));
    return {
      w: Math.ceil(2 * (side + 12 + 0.15 * up)), // balanço do topo
      h: Math.ceil(up + 45 + 0.12 * up + foot),  // pulo do "done" + esticar no ar
      foot,
      side: Math.ceil(side), // meia largura e altura visíveis: as bordas da
      up: Math.ceil(up),     // tela param o corpo, não a janela (physics.js)
    };
  }

  /** Entrada do pet.json (ou o palpite) -> escala da textura e pivô dos pés. */
  function place(s, entry, height) {
    const e = { ...autoEntry(s, height), ...(entry || {}) };
    return {
      scale: e.scale,
      floor: e.floor,
      ds: e.scale / s.k,
      pivot: { x: s.comp.feetX, y: s.bottom - e.floor * s.k },
    };
  }

  /**
   * Os pés ficam no centro horizontal da janela, a footMargin px da base.
   * Fixos: ao trocar de imagem o pet não muda de lugar. Quem garante que a
   * imagem cabe é o renderer, dimensionando a janela (ver fitWindow).
   */
  function create(canvas, { footMargin = FOOT_MARGIN, grid = 14 } = {}) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error("WebGL2 indisponível");

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es
      in vec2 a_pos; in vec2 a_uv; uniform vec2 u_res; out vec2 v_uv;
      void main() {
        vec2 c = a_pos / u_res * 2.0 - 1.0;
        gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
        v_uv = a_uv;
      }`));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
      void main() { o = texture(u_tex, v_uv); }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const uRes = gl.getUniformLocation(prog, "u_res");

    gl.bindVertexArray(gl.createVertexArray());
    const posBuf = gl.createBuffer(), uvBuf = gl.createBuffer(), idxBuf = gl.createBuffer();
    for (const [buf, name] of [[posBuf, "a_pos"], [uvBuf, "a_uv"]]) {
      const loc = gl.getAttribLocation(prog, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // textura pré-multiplicada

    const P = { ...DEFAULTS };
    const target = {};
    for (const k of MOOD_KEYS) target[k] = P[k];

    let viewW = 1, viewH = 1, feetX = 0, feetY = 0, ds = 1;
    let sprite = null, pivot = null, cols = 1, rows = 1, count = 0, idxCount = 0;
    let rest, uvs, hN, L, V, out, idx;
    let bodyH = 1, bodyW = 1;

    const body = { y: 0, vy: 0, air: false };       // y <= 0: altura do pulo
    const sq = { s: 0, v: 0 };                       // s > 0 achata, s < 0 estica
    const frame = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, g: 0, init: false }; // janela na tela
    const phase = { breath: 0, sway: 0, bob: 0 };    // fase acumulada: mudar o Hz não dá salto
    let swayLevel = P.swayAmp, bobLevel = 0;
    let hopTimer = 0, hopQueue = 0, hopGap = 0;
    let held = false, anchorX = 0, anchorY = 0, acc = 0;

    function buildMesh() {
      const s = sprite;
      const cell = Math.max(s.w, s.h) / grid;
      cols = Math.max(1, Math.round(s.w / cell));
      rows = Math.max(1, Math.round(s.h / cell));
      count = (cols + 1) * (rows + 1);
      rest = new Float32Array(count * 2);  // relativo aos pés, px, y para baixo
      uvs = new Float32Array(count * 2);
      hN = new Float32Array(count);        // 0 nos pés, 1 no topo
      L = new Float32Array(count * 2);     // deslocamento da gelatina
      V = new Float32Array(count * 2);
      out = new Float32Array(count * 2);
      bodyH = Math.max(1, pivot.y * ds);
      bodyW = s.w * ds;

      for (let j = 0, i = 0; j <= rows; j++)
        for (let c = 0; c <= cols; c++, i++) {
          const u = c / cols, v = j / rows;
          uvs[2 * i] = u; uvs[2 * i + 1] = v;
          rest[2 * i] = (u * s.w - pivot.x) * ds;
          rest[2 * i + 1] = (v * s.h - pivot.y) * ds;
          hN[i] = Math.min(1, Math.max(0, -rest[2 * i + 1] / bodyH));
        }

      idx = new Uint16Array(cols * rows * 6);
      let k = 0;
      for (let j = 0; j < rows; j++)
        for (let c = 0; c < cols; c++) {
          const a = j * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
          idx[k++] = b; idx[k++] = d; idx[k++] = e;
        }
      idxCount = k;
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      deform();
    }

    function step(dt) {
      const ease = 1 - Math.exp(-dt * 3);
      for (const k of MOOD_KEYS) P[k] += (target[k] - P[k]) * ease;
      // Segurado: quase não balança e não quica, para não "fugir" da mão.
      const fast = 1 - Math.exp(-dt * 6);
      swayLevel += ((held ? P.swayAmp * 0.3 : P.swayAmp) - swayLevel) * fast;
      bobLevel += ((held ? 0 : P.bobAmp) - bobLevel) * fast;
      phase.breath += TAU * P.breathHz * dt;
      phase.sway += TAU * P.swayHz * dt;
      phase.bob += TAU * P.bobHz * dt;

      // Janela: o main manda a posição a cada tick do arraste, em eventos
      // irregulares. A velocidade é suavizada para a inércia não tremer.
      const fvx = frame.vx, fvy = frame.vy;
      let rx = 0, ry = 0;
      if (frame.init) {
        rx = (frame.x - frame.px) / dt; ry = (frame.y - frame.py) / dt;
        frame.px = frame.x; frame.py = frame.y;
      }
      const k = 1 - Math.exp(-dt * 30);
      frame.vx += (rx - frame.vx) * k;
      frame.vy += (ry - frame.vy) * k;
      let ax = (frame.vx - fvx) / dt;
      let ay = (frame.vy - fvy) / dt - frame.g; // janela caindo: queda livre não deforma

      // Pulo (dentro da janela). Em queda livre tudo cai junto, então a
      // gravidade não deforma; o que deforma é o chão.
      const vy0 = body.vy, freeFall = (body.air || frame.g > 0) && !held;
      if (!held) {
        if (body.air) {
          body.vy += P.gravity * dt;
          body.y += body.vy * dt;
          if (body.y >= 0) {
            sq.v += body.vy * P.impactK * P.squashGain;
            body.y = 0; body.vy = 0; body.air = false;
            hopGap = 0.06;
          }
        } else if (hopTimer > 0) {
          if ((hopTimer -= dt) <= 0) { body.vy = -P.hopSpeed; body.air = true; }
        } else if (hopQueue > 0 && (hopGap -= dt) <= 0) {
          hopQueue--;
          hopTimer = 0.08;               // antecipação: agacha antes de subir
          sq.v += 2.5 * P.squashGain;
        }
      }
      ay += (body.vy - vy0) / dt - (freeFall ? P.gravity : 0);

      // Âncora: o ponto que não balança. Trocá-la de repente não dá salto
      // visual: ela muda força e rigidez, não o deslocamento acumulado.
      if (!held) { anchorX = 0; anchorY = freeFall ? -bodyH * 0.5 : 0; }

      const w0 = TAU * P.jellyHz, z = P.jellyDamp, gain = P.jellyGain * JELLY_K;
      const hang = held ? P.gravity * P.hangWeight : 0;
      const R = Math.max(bodyH, bodyW);
      for (let i = 0; i < count; i++) {
        const j = 2 * i;
        const m = Math.pow(Math.min(1, Math.hypot(rest[j] - anchorX, rest[j + 1] - anchorY) / R), P.jellyFalloff);
        const w = w0 * (1 - P.jellySpread * m); // pontas mais moles atrasam mais: vira onda
        const kk = w * w, c = 2 * z * w;
        V[j]     += (-kk * L[j]     - c * V[j]     - ax * gain * m) * dt;
        V[j + 1] += (-kk * L[j + 1] - c * V[j + 1] + (hang - ay * gain) * m) * dt;
        L[j] += V[j] * dt;
        L[j + 1] += V[j + 1] * dt;
      }

      const fallV = body.air ? body.vy : frame.vy;
      const stretch = freeFall ? -Math.min(Math.abs(fallV) * P.stretchK * P.stretchGain, 0.35) : 0;
      const ws = TAU * P.squashHz;
      sq.v += (-ws * ws * (sq.s - stretch) - 2 * P.squashDamp * ws * sq.v) * dt;
      sq.s = Math.min(0.6, Math.max(-0.45, sq.s + sq.v * dt));
    }

    function deform() {
      const b = P.breathAmp * Math.sin(phase.breath);
      const sy = 1 - sq.s;
      const sx = 1 + (1 / sy - 1) * P.volume;
      const maxL = 0.25 * Math.max(bodyH, bodyW);
      const swayA = swayLevel * bodyH;
      const lift = body.y - bobLevel * (0.5 - 0.5 * Math.cos(phase.bob));
      for (let i = 0; i < count; i++) {
        const j = 2 * i, h = hN[i];
        let x = rest[j], y = rest[j + 1];
        const bump = Math.sin(Math.PI * h); // barriga mexe mais que pés e topo
        x *= 1 + b * (0.4 + 0.9 * bump);
        y *= 1 + b * 0.6;
        x += swayA * Math.sin(phase.sway - P.swayWave * h) * h * h;
        y *= sy;
        x *= 1 + (sx - 1) * (0.55 + 0.9 * bump);
        // Limite suave: arraste violento estica, mas nunca rasga a imagem.
        const lx = L[j], ly = L[j + 1], d = Math.hypot(lx, ly);
        const f = d > 1e-6 ? maxL * Math.tanh(d / maxL) / d : 1;
        out[j] = feetX + x + lx * f;
        out[j + 1] = feetY + lift + y + ly * f;
      }
    }

    return {
      resize(w, h, dpr) {
        viewW = w; viewH = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        feetX = w / 2;
        feetY = h - footMargin;
        if (sprite) deform();
      },

      setFootMargin(m) {
        footMargin = m;
        feetY = viewH - footMargin;
      },

      /** @param placement saída de PetMesh.place(): { ds, pivot } */
      setSprite(s, placement) {
        sprite = s;
        ds = placement.ds;
        pivot = placement.pivot;
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        buildMesh();
      },

      setMood(mood) {
        for (const k of MOOD_KEYS) if (typeof mood[k] === "number") target[k] = mood[k];
      },

      hop(n = 1) { hopQueue += n; },

      /** A janela pousou no chão a `v` DIP/s: achata (satura em quedas altas). */
      impact(v) {
        sq.v += 7 * (1 - Math.exp(-v / 600)) * P.squashGain;
      },

      /**
       * "Boop": cutucada em (x, y) da janela. Os vértices perto afundam na
       * direção do ponto e voltam pela mola da gelatina.
       */
      poke(x, y) {
        if (!sprite) return;
        const px = x - feetX, py = y - feetY - body.y;
        const r = 0.45 * Math.max(bodyH, bodyW);
        for (let i = 0; i < count; i++) {
          const j = 2 * i, dx = rest[j] - px, dy = rest[j + 1] - py;
          const d = Math.hypot(dx, dy);
          if (d >= r) continue;
          const f = (1 - d / r) ** 2 * 420; // px/s
          V[j] -= (dx / (d || 1)) * f;
          V[j + 1] -= (dy / (d || 1)) * f;
        }
        sq.v += 1.5 * P.squashGain;
      },

      /** Agarrou em (x, y) da janela: esse ponto vira a âncora. */
      grab(x, y) {
        held = true;
        anchorX = x - feetX;
        anchorY = y - feetY - body.y;
        hopQueue = 0; hopTimer = 0;
        frame.init = false; // a próxima posição recebida é a referência, não um salto
      },

      release() { held = false; },

      /** Posição da janela na tela (DIP), enviada pelo main durante o arraste. */
      frameMoved(x, y, g = 0) {
        frame.x = x; frame.y = y; frame.g = g;
        if (!frame.init) { frame.px = x; frame.py = y; frame.init = true; }
      },

      update(dt) {
        if (!sprite) return;
        acc += Math.min(dt, 0.1);
        while (acc >= STEP) { step(STEP); acc -= STEP; }
        deform();
      },

      draw() {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!sprite) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
        gl.uniform2f(uRes, viewW, viewH);
        gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
      },

      /**
       * O ponto (x, y) da janela cai sobre um pixel visível do pet, na pose
       * deformada de AGORA? Acha o triângulo que contém o ponto, interpola o
       * UV e lê o alfa da imagem. Exato com qualquer deformação.
       */
      hitTest(x, y, threshold) {
        if (!sprite) return false;
        for (let k = 0; k < idxCount; k += 3) {
          const a = 2 * idx[k], b = 2 * idx[k + 1], c = 2 * idx[k + 2];
          const ax = out[a], ay = out[a + 1], bx = out[b], by = out[b + 1], cx = out[c], cy = out[c + 1];
          const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
          if (!d) continue;
          const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
          const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const u = l1 * uvs[a] + l2 * uvs[b] + l3 * uvs[c];
          const v = l1 * uvs[a + 1] + l2 * uvs[b + 1] + l3 * uvs[c + 1];
          const px = Math.min(sprite.w - 1, Math.max(0, Math.floor(u * sprite.w)));
          const py = Math.min(sprite.h - 1, Math.max(0, Math.floor(v * sprite.h)));
          return sprite.alpha[py * sprite.w + px] > threshold;
        }
        return false;
      },
    };
  }

  return { DEFAULT_HEIGHT, analyze, autoEntry, place, load, url, windowSize, create };
})();

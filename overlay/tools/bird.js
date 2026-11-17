/* Passarinho, o mascote de fábrica do perch (arte própria, desenhada em
   código — nasceu na PoC da Fase 2). Uma pose por estado.

   Roda numa página (canvas 2D); tools/make-assets.js executa renderAll() e
   grava os PNGs em assets/. Marcas soltas do corpo (!, Zzz, bolinhas de
   pensamento, brilhos) ficam separadas de propósito: a detecção de
   personagem (maior ilha opaca, mesh.js) as ignora e o passarinho sai do
   mesmo tamanho em todas as poses. */

const TAU = Math.PI * 2;
const C = { blue: "#4f7cff", dark: "#3557c9", belly: "#f4ead8", orange: "#ff9a3c", ink: "#1a1c24", cheek: "rgba(255,120,140,.45)" };
const W = 380, H = 440, DY = 40; // DY: espaço em cima para !, Zzz e bolinhas

function feather(g, x0, y0, x1, y1, w) {
  g.save();
  g.translate(x0, y0);
  g.rotate(Math.atan2(y1 - y0, x1 - x0));
  const len = Math.hypot(x1 - x0, y1 - y0);
  g.beginPath();
  g.moveTo(0, -w);
  g.quadraticCurveTo(len * 0.6, -w * 0.8, len, 0);
  g.quadraticCurveTo(len * 0.6, w * 0.8, 0, w);
  g.fill();
  g.restore();
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function drawBird(pose) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.lineCap = "round"; g.lineJoin = "round";
  g.translate(0, DY);

  // Pernas: no passeio, uma na frente e outra atrás.
  g.strokeStyle = C.orange; g.lineWidth = 9;
  const legs = pose === "andando" ? [[150, -14], [208, 14]] : [[150, 0], [208, 0]];
  for (const [x, lean] of legs) {
    const fx = x + lean;
    g.beginPath();
    g.moveTo(x, 318); g.lineTo(fx, 376);
    g.moveTo(fx - 17, 388); g.lineTo(fx, 376); g.lineTo(fx + 19, 388);
    g.moveTo(fx, 376); g.lineTo(fx + 1, 390);
    g.stroke();
  }

  // Cauda e penacho (partes finas: são elas que balançam na gelatina).
  g.fillStyle = C.dark;
  feather(g, 80, 250, 14, 312, 22);
  feather(g, 80, 262, 30, 330, 16);
  g.fillStyle = C.blue;
  const droop = pose === "dormindo" ? 22 : 0; // dormindo, o penacho cai um pouco
  feather(g, 168, 112, 132 - droop, 30 + droop * 1.5, 13);
  feather(g, 176, 110, 182 - droop, 14 + droop * 2, 13);
  feather(g, 184, 112, 228 - droop, 34 + droop * 1.2, 11);

  // Corpo e barriga.
  g.beginPath(); g.ellipse(180, 215, 128, 120, 0, 0, TAU); g.fill();
  g.fillStyle = C.belly;
  g.beginPath(); g.ellipse(200, 254, 82, 72, -0.2, 0, TAU); g.fill();

  // Asa: comemorando, levantada.
  g.fillStyle = C.dark;
  g.beginPath();
  if (pose === "finalizado") g.ellipse(92, 168, 44, 74, -0.75, 0, TAU);
  else g.ellipse(104, 236, 48, 72, 0.35, 0, TAU);
  g.fill();

  // Olho.
  if (pose === "dormindo") {
    g.strokeStyle = C.ink; g.lineWidth = 6;
    g.beginPath(); g.arc(228, 172, 18, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  } else if (pose === "finalizado") {
    g.strokeStyle = C.ink; g.lineWidth = 7;
    g.beginPath(); g.arc(228, 186, 18, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke();
  } else {
    const big = pose === "permissao";
    const [px, py] = pose === "pensando" ? [222, 166] : [233, 179];
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(226, 176, big ? 30 : 26, 0, TAU); g.fill();
    g.fillStyle = C.ink;
    g.beginPath(); g.arc(px, py, big ? 15 : 13, 0, TAU); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(px + 5, py - 6, 4.5, 0, TAU); g.fill();
  }

  // Bico: aberto quando chama você.
  g.fillStyle = C.orange;
  g.beginPath();
  if (pose === "permissao") {
    g.moveTo(290, 188); g.lineTo(348, 196); g.lineTo(290, 208); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(290, 214); g.lineTo(340, 234); g.lineTo(288, 236); g.closePath();
  } else {
    g.moveTo(290, 190); g.lineTo(346, 212); g.lineTo(288, 234); g.closePath();
  }
  g.fill();
  g.fillStyle = C.cheek;
  g.beginPath(); g.ellipse(262, 224, 18, 11, 0, 0, TAU); g.fill();

  // Marcas soltas.
  if (pose === "pensando") {
    g.fillStyle = "#cfd8ff";
    for (const [x, y, r] of [[268, 70, 9], [296, 40, 13], [334, 6, 18]]) {
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  } else if (pose === "permissao") {
    g.fillStyle = "#ff5c5c";
    g.beginPath(); g.roundRect(314, -30, 22, 70, 10); g.fill();
    g.beginPath(); g.arc(325, 62, 12, 0, TAU); g.fill();
  } else if (pose === "finalizado") {
    g.fillStyle = "#ffd34d";
    for (const [x, y, r] of [[300, 40, 20], [40, 110, 14], [340, 130, 12], [250, 0, 10]]) star(g, x, y, r);
  } else if (pose === "dormindo") {
    g.fillStyle = "#cfd8ff";
    g.font = "bold 44px system-ui, sans-serif";
    g.fillText("Z", 262, 70);
    g.font = "bold 32px system-ui, sans-serif";
    g.fillText("z", 302, 32);
    g.font = "bold 24px system-ui, sans-serif";
    g.fillText("z", 332, 6);
  }
  return c;
}

/** Ícone quadrado: o passarinho parado, centralizado, com margem. */
function drawIcon(size) {
  const src = drawBird("parado");
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  // Recorta o corpo (sem a folga de cima) e encaixa no quadrado.
  const sx = 0, sy = DY + 10, sw = W, sh = H - DY - 10;
  const k = (size * 0.92) / Math.max(sw, sh);
  g.imageSmoothingQuality = "high";
  g.drawImage(src, sx, sy, sw, sh, (size - sw * k) / 2, (size - sh * k) / 2, sw * k, sh * k);
  return c;
}

function renderAll() {
  const out = {};
  for (const pose of ["parado", "pensando", "permissao", "finalizado", "dormindo", "andando"])
    out[`passarinho/${pose}1.png`] = drawBird(pose).toDataURL("image/png");
  out["icon.png"] = drawIcon(256).toDataURL("image/png");
  out["tray.png"] = drawIcon(32).toDataURL("image/png");
  return out;
}

const PORT = 4747;
const PET = "default"; // pasta em %APPDATA%/perch/pets/
const STATES = ["idle", "working", "done", "blocked"];
const ALPHA_HIT = 32; // 0-255: abaixo disso o pixel é "fundo" e o clique atravessa

const pet = document.getElementById("pet");
const sprite = document.getElementById("sprite");

/* Mapa tool -> sprite. O renderer não conhece nenhum arquivo específico:
   troque a pasta do pet e o visual inteiro muda sem tocar em código.
   (Deliberado: a arte do Clawd é da Anthropic. Mantenha-a local e publique
   o projeto com mascote próprio.) */
const SPRITES = {
  idle:    "idle.png",
  working: "working.png",
  done:    "done.png",
  blocked: "blocked.png",
  tools: {
    Edit: "working.png",  Write: "working.png",  MultiEdit: "working.png",
    Read: "sherlock.png", Grep:  "sherlock.png", Glob: "sherlock.png",
    Bash: "cooking.png",
  },
};

// Em ordem de preferência: sprite da tool, depois o do estado. Assim um pet
// sem sherlock.png mostra working.png no Read em vez de cair no placeholder.
function candidates(state, tool) {
  const list = [];
  if (state === "working" && tool && SPRITES.tools[tool]) list.push(SPRITES.tools[tool]);
  list.push(SPRITES[state] || SPRITES.idle);
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// Imagem
// ---------------------------------------------------------------------------

let currentKey = null;
let loadSeq = 0;
let alpha = null; // { w, h, data } da imagem atual, para o hit-test

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // sem isto o canvas fica "tainted" e getImageData lança
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function readAlpha(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

async function setImage(files) {
  const key = files.join("|");
  if (key === currentKey) return;
  currentKey = key;

  // Carregamento é assíncrono: se o estado mudar duas vezes rápido, o onload
  // da imagem ANTIGA pode chegar depois do da nova. O seq descarta o atrasado.
  const seq = ++loadSeq;

  for (const file of files) {
    try {
      const img = await loadImage(`pet://${PET}/${file}`);
      if (seq !== loadSeq) return;
      alpha = readAlpha(img);
      sprite.src = img.src;
      pet.classList.remove("placeholder");
      return;
    } catch {
      if (seq !== loadSeq) return;
    }
  }

  // Nenhuma existe. Esquece a chave para tentar de novo na próxima mudança —
  // senão um PNG adicionado depois só apareceria reiniciando o app.
  currentKey = null;
  alpha = null;
  sprite.removeAttribute("src");
  pet.classList.add("placeholder");
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let currentState = null;

function render({ state, tool }) {
  setImage(candidates(state, tool));

  // Animação só reinicia quando o ESTADO muda. Trocar de tool (Read -> Edit)
  // troca a imagem acima e deixa a animação seguir. Antes, qualquer mensagem
  // reiniciava o keyframe — e o renderer dependia do daemon nunca repetir
  // payload para o sprite não congelar no primeiro frame.
  if (state === currentState) return;
  currentState = state;

  pet.classList.remove(...STATES);
  void pet.offsetWidth; // reflow: sem ele, remover+adicionar a classe não reinicia o keyframe
  pet.classList.add(state);
}

function connect() {
  const es = new EventSource(`http://127.0.0.1:${PORT}/stream`);
  es.onmessage = (e) => render(JSON.parse(e.data));
  es.onerror = () => {
    es.close();
    render({ state: "idle", tool: null });
    setTimeout(connect, 2000); // daemon caiu ou ainda não subiu: tenta de novo
  };
}

// ---------------------------------------------------------------------------
// Mouse: clicável só onde o pet é opaco
// ---------------------------------------------------------------------------

/**
 * O cursor (coords da janela) está sobre um pixel visível do pet?
 *
 * Desfaz a transform CSS da animação (rotate/scale/translate em volta do
 * transform-origin) para achar o ponto no espaço da imagem parada. Sem isso,
 * no "blocked" que balança ±7°, o clique erraria as bordas.
 */
function hitTest(x, y) {
  const cs = getComputedStyle(pet);
  if (parseFloat(cs.opacity) < 0.05) return false; // idle/invisível: atravessa

  const w = pet.offsetWidth;
  const h = pet.offsetHeight;
  const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
  const m = cs.transform === "none" ? new DOMMatrix() : new DOMMatrix(cs.transform);
  const p = m.inverse().transformPoint({ x: x - pet.offsetLeft - ox, y: y - pet.offsetTop - oy });
  const lx = p.x + ox;
  const ly = p.y + oy;

  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
  if (!alpha) return true; // placeholder: o quadrado inteiro conta

  // object-fit: contain -> retângulo onde a imagem foi realmente desenhada
  const scale = Math.min(w / alpha.w, h / alpha.h);
  const ix = Math.floor((lx - (w - alpha.w * scale) / 2) / scale);
  const iy = Math.floor((ly - (h - alpha.h * scale) / 2) / scale);
  if (ix < 0 || iy < 0 || ix >= alpha.w || iy >= alpha.h) return false;
  return alpha.data[(iy * alpha.w + ix) * 4 + 3] > ALPHA_HIT;
}

let interactive = false;
let dragging = false;

function setInteractive(on) {
  if (on === interactive) return; // IPC só em mudança: mousemove dispara a 60Hz+
  interactive = on;
  pet.classList.toggle("interactive", on);
  window.overlay.setInteractive(on);
}

// Chega mesmo com a janela atravessável, graças ao forward:true no main.
window.addEventListener("mousemove", (e) => {
  if (!dragging) setInteractive(hitTest(e.clientX, e.clientY));
});

// Cursor saiu da janela. Não dá para detectar daqui: um movimento rápido que
// pula a borda transparente não gera nenhum evento (nem mouseout/mouseleave).
// O main vigia o cursor e já devolveu o click-through; só sincroniza o flag.
window.overlay.onMouseLeft(() => {
  interactive = false;
  pet.classList.remove("interactive");
});

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !interactive) return;
  dragging = true;
  pet.classList.add("dragging");
  window.overlay.dragStart();
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  pet.classList.remove("dragging");
  window.overlay.dragEnd();
}
window.addEventListener("mouseup", endDrag);
window.addEventListener("blur", endDrag);

connect();

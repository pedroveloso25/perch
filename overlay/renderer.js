const PORT = 4747;
const PET = "default"; // pasta em %APPDATA%/perch/pets/
const STATES = ["idle", "working", "done", "blocked"];
const ALPHA_HIT = 32; // 0-255: abaixo disso o pixel é "fundo" e o clique atravessa
const VARIANT_ROTATE_MS = 30_000; // estado longo com várias imagens: troca de vez em quando

const canvas = document.getElementById("pet");

/* Nomes de arquivo aceitos por estado, em ordem de preferência. Variações
   numeradas contam como o mesmo nome (pensando1.png, pensando-2.png...) e
   uma delas é sorteada ao entrar no estado. Acento e caixa não importam.
   O renderer não conhece nenhum arquivo específico: troque a pasta do pet e o
   visual inteiro muda sem tocar em código. (Deliberado: a arte do Clawd é da
   Anthropic. Mantenha-a local e publique o projeto com mascote próprio.) */
const NAMES = {
  idle:    ["idle", "parado"],
  working: ["working", "pensando", "trabalhando"],
  done:    ["done", "finalizado", "pronto"],
  blocked: ["blocked", "permissao", "bloqueado"],
};
const TOOL_NAMES = {
  Read: ["sherlock", "lendo"], Grep: ["sherlock", "lendo"], Glob: ["sherlock", "lendo"],
  Bash: ["cooking", "terminal"],
  Edit: ["editando"], Write: ["editando"], MultiEdit: ["editando"],
};

/* A hierarquia visual é o produto inteiro. Visão periférica registra MUDANÇA,
   não estado. Se "pensando" e "terminou" tiverem a mesma energia, você
   dessensibiliza e o overlay vira enfeite. (Opacidade e brilho ficam no CSS.)
   - idle: invisível. Nada acontecendo = nada na tela.
   - working: lento, baixa amplitude. Presente mas ignorável.
   - done: pico brusco (dois pulos) e depois sustenta. É o evento que te chama.
   - blocked: o mais agressivo. Está travado esperando VOCÊ. */
const MOODS = {
  idle:    { breathAmp: 0.02, breathHz: 0.25, swayAmp: 0,    swayHz: 0.3, bobAmp: 0, bobHz: 0.5 },
  working: { breathAmp: 0.03, breathHz: 0.38, swayAmp: 0.02, swayHz: 0.3, bobAmp: 0, bobHz: 0.5 },
  done:    { breathAmp: 0.03, breathHz: 0.5,  swayAmp: 0.03, swayHz: 0.8, bobAmp: 9, bobHz: 0.9 },
  blocked: { breathAmp: 0.02, breathHz: 0.8,  swayAmp: 0.12, swayHz: 1.6, bobAmp: 5, bobHz: 1.6 },
};

const mesh = PetMesh.create(canvas);

function resize() { mesh.resize(innerWidth, innerHeight, devicePixelRatio || 1); }
addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

let groups = new Map();  // nome base -> [arquivos]
let loaded = new Map();  // arquivo -> { s: sprite analisado, p: place() }
let analyzed = new Map(); // "arquivo:mtime" -> Promise<sprite>; sobrevive a refresh
let listKey = null;      // lista de variações em uso
let currentFile;         // undefined = nada escolhido ainda; null = placeholder
let chosenAt = 0;
let refreshSeq = 0;

function baseName(file) {
  const n = file.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const m = n.match(/^(.*?)[\s_-]*\d*\.png$/);
  return m ? m[1] : null;
}

/* Lê a pasta e o pet.json e carrega TODAS as imagens de uma vez: a janela
   precisa caber a maior delas (para não mudar de tamanho a cada estado) e a
   troca de imagem vira instantânea. A análise fica em cache por arquivo +
   mtime, então salvar o pet.json não reanalisa nada. */
async function refreshSprites() {
  const seq = ++refreshSeq;
  const [files, config] = await Promise.all([
    window.overlay.listSprites().catch(() => []),
    window.overlay.readConfig().catch(() => ({})),
  ]);
  const height = config.height > 0 ? config.height : PetMesh.DEFAULT_HEIGHT;
  const images = config.images || {};

  const results = await Promise.all(files.map(async ({ name, mtime }) => {
    const key = name + ":" + mtime;
    if (!analyzed.has(key)) analyzed.set(key, PetMesh.load("pet://" + PET + "/" + encodeURIComponent(name)));
    try {
      const s = await analyzed.get(key);
      return [name, { s, p: PetMesh.place(s, images[name], height) }];
    } catch {
      analyzed.delete(key); // falhou: tenta de novo no próximo refresh
      return null;
    }
  }));
  if (seq !== refreshSeq) return; // um refresh mais novo já começou

  loaded = new Map(results.filter(Boolean));
  groups = new Map();
  for (const name of loaded.keys()) {
    const b = baseName(name);
    if (b) groups.set(b, [...(groups.get(b) || []), name]);
  }
  fitWindow(height);
  listKey = null;
  currentFile = undefined;
  if (currentState) choose(variantsFor(currentState, currentTool), true);
}

// Quadrado laranja enquanto a pasta não tem nenhuma imagem.
let placeholderSprite = null;
function placeholder(height) {
  if (!placeholderSprite) {
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#d97757";
    g.beginPath(); g.roundRect(0, 0, 96, 96, 14); g.fill();
    g.fillStyle = "rgba(0, 0, 0, .14)";
    g.fillRect(10, 86, 86, 10);
    placeholderSprite = PetMesh.analyze(c);
  }
  return { s: placeholderSprite, p: PetMesh.place(placeholderSprite, null, height) };
}

let fallback = null;
function fitWindow(height) {
  fallback = placeholder(height);
  const size = PetMesh.windowSize(loaded.size ? [...loaded.values()] : [fallback]);
  mesh.setFootMargin(size.foot);
  window.overlay.resizeWindow(size); // o "resize" da janela chama mesh.resize
}

// Em ordem: sprite da tool, depois o do estado, depois "pensando", depois
// qualquer imagem. Um pet só com pensando*.png já funciona em todo estado.
function variantsFor(state, tool) {
  const pick = (names) => names.flatMap((n) => groups.get(n) || []);
  if (state === "working" && TOOL_NAMES[tool]) {
    const list = pick(TOOL_NAMES[tool]);
    if (list.length) return list;
  }
  for (const s of [state, "working"]) {
    const list = pick(NAMES[s]);
    if (list.length) return list;
  }
  return [...groups.values()].flat();
}

// Mesma lista de antes: mantém a imagem (trocar de tool não pode piscar o
// pet). Lista nova ou force: sorteia, evitando repetir a atual.
function choose(list, force = false) {
  const key = list.join("|");
  if (!force && key === listKey && currentFile !== undefined) return;
  listKey = key;
  const others = list.filter((f) => f !== currentFile);
  const pool = others.length ? others : list;
  showFile(pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
}

function showFile(file) {
  currentFile = file;
  chosenAt = Date.now();
  const item = (file && loaded.get(file)) || fallback;
  if (item) mesh.setSprite(item.s, item.p);
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let currentState = null;
let currentTool = null;

function render({ state, tool }) {
  const changed = state !== currentState;
  currentState = state;
  currentTool = tool;
  choose(variantsFor(state, tool), changed);

  // Comportamento de entrada (pulos do done) só quando o ESTADO muda. Trocar
  // de tool (Read -> Edit) só troca a imagem acima e deixa a animação seguir.
  if (!changed) return;
  canvas.classList.remove(...STATES);
  canvas.classList.add(state);
  mesh.setMood(MOODS[state] || MOODS.idle);
  if (state === "done") mesh.hop(2);
  wake();
}

setInterval(() => {
  if (currentState && currentState !== "idle" && !dragging && Date.now() - chosenAt > VARIANT_ROTATE_MS) {
    const list = variantsFor(currentState, currentTool);
    if (list.length > 1) choose(list, true);
  }
}, 5000);

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
// Laço de animação: dorme em idle (o pet está invisível, não há o que animar)
// ---------------------------------------------------------------------------

let rafId = 0;
let last = 0;
let sleepTimer = 0;

function loop(now) {
  mesh.update((now - last) / 1000);
  last = now;
  mesh.draw();
  rafId = requestAnimationFrame(loop);
}

function wake() {
  clearTimeout(sleepTimer);
  if (!rafId) {
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  }
  // Espera o fade-out do CSS (320ms) terminar antes de parar de desenhar.
  if (currentState === "idle" && !dragging) sleepTimer = setTimeout(sleep, 600);
}

function sleep() {
  if (currentState !== "idle" || dragging) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

// ---------------------------------------------------------------------------
// Mouse: clicável só onde o pet é opaco
// ---------------------------------------------------------------------------

// O cursor (coords da janela) está sobre um pixel visível do pet? O mesh
// testa contra a malha deformada deste frame, então balanço e pulo não
// fazem o clique errar as bordas.
function hitTest(x, y) {
  if (parseFloat(getComputedStyle(canvas).opacity) < 0.05) return false; // idle/invisível: atravessa
  return mesh.hitTest(x, y, ALPHA_HIT);
}

let interactive = false;
let dragging = false;

function setInteractive(on) {
  if (on === interactive) return; // IPC só em mudança: mousemove dispara a 60Hz+
  interactive = on;
  canvas.classList.toggle("interactive", on);
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
  canvas.classList.remove("interactive");
});

let downAt = null; // onde apertou, para a cutucada se for um clique

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !interactive) return;
  dragging = true;
  downAt = { x: e.clientX, y: e.clientY };
  canvas.classList.add("dragging");
  mesh.grab(e.clientX, e.clientY);
  window.overlay.dragStart();
  wake();
});

// Quem decide se foi clique ou arraste é o main: a janela anda junto com o
// cursor, então daqui o mouse parece nunca ter saído do lugar.
async function endDrag() {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove("dragging");
  mesh.release();
  const { click } = await window.overlay.dragEnd().catch(() => ({ click: false }));
  if (click && downAt) {
    mesh.poke(downAt.x, downAt.y); // "boop"
    mesh.hop(1);
  }
  wake();
}
window.addEventListener("mouseup", endDrag);
window.addEventListener("blur", endDrag);

// A janela andou (arraste): a malha sente a aceleração e balança.
window.overlay.onMoved((p) => mesh.frameMoved(p.x, p.y, p.g));
window.overlay.onLanded((v) => mesh.impact(v));
window.overlay.onSpritesChanged(refreshSprites);

refreshSprites().then(connect);

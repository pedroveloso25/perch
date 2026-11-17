const PORT = 4747;
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
  sleep:   ["dormindo", "sleeping", "sleep"],
  walk:    ["andando", "walking", "walk"],
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
   - blocked: o mais agressivo. Está travado esperando VOCÊ.
   No ócio com o modo pet, o humor vem da atividade do cérebro (brain.js):
   parado respira, andando bamboleia, dormindo respira fundo e devagar. */
const MOODS = {
  idle:    { breathAmp: 0.02, breathHz: 0.25, swayAmp: 0,    swayHz: 0.3, bobAmp: 0, bobHz: 0.5 },
  rest:    { breathAmp: 0.025, breathHz: 0.25, swayAmp: 0.012, swayHz: 0.22, bobAmp: 0, bobHz: 0.5 },
  walk:    { breathAmp: 0.02, breathHz: 0.5,  swayAmp: 0.035, swayHz: 1.1, bobAmp: 4, bobHz: 2.2 },
  sleep:   { breathAmp: 0.055, breathHz: 0.16, swayAmp: 0,   swayHz: 0.2, bobAmp: 0, bobHz: 0.5 },
  wake:    { breathAmp: 0.04, breathHz: 0.6,  swayAmp: 0.03, swayHz: 0.7, bobAmp: 0, bobHz: 0.5 },
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
  const [{ pet, files }, config] = await Promise.all([
    window.overlay.listSprites().catch(() => ({ pet: "default", files: [] })),
    window.overlay.readConfig().catch(() => ({})),
  ]);
  const height = config.height > 0 ? config.height : PetMesh.DEFAULT_HEIGHT;
  const images = config.images || {};

  const keys = new Set(files.map(({ name, mtime }) => `${pet}/${name}:${mtime}`));
  for (const key of analyzed.keys()) if (!keys.has(key)) analyzed.delete(key); // trocou de pet ou de arquivo

  const results = await Promise.all(files.map(async ({ name, mtime }) => {
    const key = `${pet}/${name}:${mtime}`;
    if (!analyzed.has(key)) analyzed.set(key, PetMesh.load(PetMesh.url(pet, name)));
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
// No ócio com modo pet, a atividade vem antes: dormindo -> parado -> ...
function variantsFor(state, tool) {
  const pick = (names) => names.flatMap((n) => groups.get(n) || []);
  if (state === "working" && TOOL_NAMES[tool]) {
    const list = pick(TOOL_NAMES[tool]);
    if (list.length) return list;
  }
  const chain = state === "idle" && petMode && NAMES[activity] ? [activity, "idle", "working"] : [state, "working"];
  for (const s of chain) {
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
let petMode = true;        // vem do main (bandeja → "Modo pet")
let activity = "rest";     // vem do main (brain.js): rest | walk | sleep | wake

// Humor do momento: estado do Claude; no ócio com modo pet, a atividade.
function currentMood() {
  if (currentState === "idle" && petMode) return MOODS[activity] || MOODS.rest;
  return MOODS[currentState] || MOODS.idle;
}

function render({ state, tool }) {
  const changed = state !== currentState;
  currentState = state;
  currentTool = tool;
  choose(variantsFor(state, tool), changed);

  // Comportamento de entrada (pulos do done) só quando o ESTADO muda. Trocar
  // de tool (Read -> Edit) só troca a imagem acima e deixa a animação seguir.
  if (!changed) return;
  window.overlay.reportState(state); // o cérebro (main) só age no ócio
  canvas.classList.remove(...STATES);
  canvas.classList.add(state);
  mesh.setMood(currentMood());
  if (state === "done") mesh.hop(2);
  wakeLoop();
}

// Mudou a atividade do cérebro (ou o modo pet): imagem e humor do ócio.
function applyIdleLook(force) {
  document.body.classList.toggle("petmode", petMode);
  if (currentState !== "idle") return;
  choose(variantsFor(currentState, currentTool), force);
  mesh.setMood(currentMood());
  wakeLoop();
}

window.overlay.onActivity((a) => {
  const prev = activity;
  activity = a;
  if (a === "wake" && prev === "sleep" && currentState === "idle") mesh.hop(1); // espreguiça
  applyIdleLook(true);
});
window.overlay.onMode((on) => { petMode = on; applyIdleLook(true); });

setInterval(() => {
  const visible = currentState && (currentState !== "idle" || petMode);
  if (visible && !dragging && Date.now() - chosenAt > VARIANT_ROTATE_MS) {
    const list = variantsFor(currentState, currentTool);
    if (list.length > 1) choose(list, true);
  }
}, 5000);

/* Reações de outras fontes (daemon → evento SSE "reaction"): um momento de
   humor emprestado e depois volta ao que era. Pedido de permissão do Claude
   tem prioridade: ali o pet não comemora nada. */
const REACTIONS = {
  celebrate: { mood: "done", hops: 2, ms: 3000 },
  alert:     { mood: "blocked", hops: 0, ms: 4000, cls: "react-alert" },
  hello:     { mood: "wake", hops: 1, ms: 1500 },
};
let reactTimer = 0;
let reacting = false;

function react({ kind }) {
  const r = REACTIONS[kind];
  if (!r || currentState === "blocked") return;
  window.overlay.wakePet(); // dormindo, acorda
  reacting = true;
  canvas.classList.remove("react-alert");
  canvas.classList.add("react");
  if (r.cls) canvas.classList.add(r.cls);
  mesh.setMood(MOODS[r.mood]);
  if (r.hops) mesh.hop(r.hops);
  clearTimeout(reactTimer);
  reactTimer = setTimeout(() => {
    reacting = false;
    canvas.classList.remove("react", "react-alert");
    mesh.setMood(currentMood());
    wakeLoop();
  }, r.ms);
  wakeLoop();
}

function connect() {
  const es = new EventSource(`http://127.0.0.1:${PORT}/stream`);
  es.onmessage = (e) => render(JSON.parse(e.data));
  es.addEventListener("reaction", (e) => react(JSON.parse(e.data)));
  es.onerror = () => {
    es.close();
    render({ state: "idle", tool: null });
    setTimeout(connect, 2000); // daemon caiu ou ainda não subiu: tenta de novo
  };
}

// ---------------------------------------------------------------------------
// Laço de animação: para quando o pet está invisível (ócio sem modo pet)
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

function wakeLoop() {
  clearTimeout(sleepTimer);
  if (!rafId) {
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  }
  // Espera o fade-out do CSS (320ms) terminar antes de parar de desenhar.
  if (invisible()) sleepTimer = setTimeout(parkLoop, 600);
}

const invisible = () => currentState === "idle" && !petMode && !dragging && !reacting;

function parkLoop() {
  if (!invisible()) return;
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
  wakeLoop();
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
  wakeLoop();
}
window.addEventListener("mouseup", endDrag);
window.addEventListener("blur", endDrag);

// A janela andou (arraste): a malha sente a aceleração e balança.
window.overlay.onMoved((p) => mesh.frameMoved(p.x, p.y, p.g));
window.overlay.onLanded((v) => mesh.impact(v));
window.overlay.onSpritesChanged(refreshSprites);

// Modo pet e atividade atuais antes do primeiro estado, para o ócio já
// nascer com a cara certa.
window.overlay.getMode()
  .then((m) => { petMode = m.petMode; activity = m.activity; document.body.classList.toggle("petmode", petMode); })
  .catch(() => {})
  .then(refreshSprites)
  .then(connect);

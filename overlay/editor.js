/* Editor de pet, parte de gestão (Fase 3): qual pet está ativo, criar,
   importar/exportar .zip e adicionar imagens com remoção de fundo
   (bgremove.js). A calibração de tamanho e chão é do calibrate.js, carregado
   antes: este arquivo usa $, load, dirty, flash, PET_STATES e baseOf de lá. */

const MAX_IMPORT = 1024; // lado máximo da imagem gravada (o mesh reduz para 1024 de qualquer jeito)

// ---------------------------------------------------------------------------
// Pet ativo
// ---------------------------------------------------------------------------

async function refreshPets() {
  const { active, pets } = await window.overlay.listPets();
  $("petSelect").replaceChildren(...pets.map((p) => new Option(p, p)));
  $("petSelect").value = active;
}

$("petSelect").addEventListener("change", async (e) => {
  if (dirty() && !confirm("Os ajustes de tamanho deste pet não foram salvos. Trocar mesmo assim?")) {
    return refreshPets();
  }
  const r = await window.overlay.setActivePet(e.target.value);
  if (r.error) flash(r.error, true);
  refreshPets(); // o main avisa a mudança e o calibrate.js recarrega as imagens
});

function toggleNewPet(open) {
  $("newPetForm").classList.toggle("open", open);
  $("newPet").hidden = open;
  if (open) { $("newPetName").value = ""; $("newPetName").focus(); }
}
$("newPet").addEventListener("click", () => toggleNewPet(true));
$("newPetCancel").addEventListener("click", () => toggleNewPet(false));
$("newPetName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("newPetOk").click();
  if (e.key === "Escape") toggleNewPet(false);
});
$("newPetOk").addEventListener("click", async () => {
  const name = $("newPetName").value.trim();
  const r = await window.overlay.createPet(name);
  if (r.error) {
    return flash(/inválido/.test(r.error)
      ? "Nome inválido: use letras, números, espaço, - ou _ (até 40)." : r.error, true);
  }
  toggleNewPet(false);
  await refreshPets();
  flash(`Pet "${r.ok}" criado. Agora adicione imagens.`);
});

$("exportZip").addEventListener("click", async () => {
  if (dirty()) flash("Atenção: o .zip leva o que está salvo, não os ajustes pendentes.", true);
  const r = await window.overlay.exportPet();
  if (r.error) flash(r.error, true);
  else if (r.ok) flash(`Exportado: ${r.ok}`);
});

$("importZip").addEventListener("click", async () => {
  if (dirty() && !confirm("Os ajustes de tamanho deste pet não foram salvos. Importar outro pet mesmo assim?")) return;
  const r = await window.overlay.importPet();
  if (r.error) return flash(`Não deu para importar: ${r.error}`, true);
  if (r.ok) {
    await refreshPets();
    flash(`Pet "${r.ok}" importado e ativado.`);
  }
});

// ---------------------------------------------------------------------------
// Adicionar imagens
// ---------------------------------------------------------------------------

for (const [v, label] of PET_STATES) $("impState").append(new Option(label, v));

// Palpite do estado pelo nome do arquivo ("clawd-pensando.png", "done.png").
const GUESSES = [
  [/pens|work|trabalh|think/, "pensando"],
  [/perm|block|bloq|wait|esper/, "permissao"],
  [/final|done|pront|fim|celebr/, "finalizado"],
  [/dorm|sleep|zzz|soneca|cochil/, "dormindo"],
  [/andand|walk|passe/, "andando"],
  [/parad|idle/, "parado"],
  [/lend|sherlock|read|grep|lupa/, "lendo"],
  [/termin|bash|cook|cozinh/, "terminal"],
  [/edit|escrev|write/, "editando"],
];
function guessState(fileName) {
  const n = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return GUESSES.find(([re]) => re.test(n))?.[1] || null;
}

const queue = [];
let cur = null;           // { file, img: ImageData original, bg, transparent, result: ImageData }
let lastState = "pensando";

function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return flash("Nenhuma imagem entre os arquivos.", true);
  queue.push(...images);
  if (!cur) next();
  else updateCount();
}

function updateCount() {
  $("impCount").textContent = queue.length ? `(mais ${queue.length} na fila)` : "";
}

async function next() {
  const file = queue.shift();
  if (!file) {
    cur = null;
    $("import").classList.remove("open");
    return;
  }
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    flash(`Não consegui abrir ${file.name}.`, true);
    return next();
  }
  const k = Math.min(1, MAX_IMPORT / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = g.getImageData(0, 0, w, h);
  const info = BgRemove.analyze(img);

  cur = { file, img, bg: info.bg, transparent: info.transparent, result: img, removed: 0 };
  $("impName").textContent = file.name;
  $("impState").value = guessState(file.name) || lastState;
  $("impBg").checked = !info.transparent;
  updateCount();
  $("import").classList.add("open");
  process();
}

let processQueued = false;
function processSoon() {
  if (processQueued) return;
  processQueued = true;
  requestAnimationFrame(() => { processQueued = false; process(); });
}

function process() {
  if (!cur) return;
  $("impTolOut").textContent = $("impTol").value;
  const on = $("impBg").checked;
  for (const id of ["impTol", "impHoles", "impSoft"]) $(id).disabled = !on;
  if (on) {
    const r = BgRemove.remove(cur.img, {
      tolerance: +$("impTol").value,
      holes: $("impHoles").checked,
      soft: $("impSoft").checked,
      bg: cur.bg,
    });
    cur.result = new ImageData(r.data, cur.img.width, cur.img.height);
    cur.removed = r.removed;
  } else {
    cur.result = cur.img;
    cur.removed = 0;
  }
  drawPreview();
  $("impInfo").textContent = infoText();
}

function infoText() {
  const hex = "#" + cur.bg.map((v) => v.toString(16).padStart(2, "0")).join("");
  if (!$("impBg").checked) {
    return cur.transparent ? "A imagem já tem fundo transparente." : "O fundo vai junto, sem recorte.";
  }
  const pct = Math.round(cur.removed * 100);
  let tip = "";
  if (cur.removed > 0.97) tip = " Quase tudo sumiu: baixe a tolerância.";
  else if (cur.removed < 0.02) tip = " Quase nada saiu: clique numa área do fundo na prévia para escolher a cor.";
  return `Fundo ${hex}, ${pct}% da imagem removido.${tip}`;
}

function drawPreview() {
  const cv = $("impPreview");
  const dpr = devicePixelRatio || 1;
  cv.width = Math.round(cv.clientWidth * dpr);
  cv.height = Math.round(cv.clientHeight * dpr);
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  const { width: w, height: h } = cur.result;
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  src.getContext("2d").putImageData(cur.result, 0, 0);
  const k = Math.min((cv.width - 20 * dpr) / w, (cv.height - 20 * dpr) / h);
  cur.view = { k, x: (cv.width - w * k) / 2, y: (cv.height - h * k) / 2, dpr };
  g.imageSmoothingQuality = "high";
  g.drawImage(src, cur.view.x, cur.view.y, w * k, h * k);
}

// Conta-gotas: clicou no fundo da prévia = essa é a cor a remover.
$("impPreview").addEventListener("click", (e) => {
  if (!cur?.view) return;
  const { k, x, y, dpr } = cur.view;
  const ix = Math.floor((e.offsetX * dpr - x) / k), iy = Math.floor((e.offsetY * dpr - y) / k);
  const { width: w, height: h, data } = cur.img;
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
  const i = (iy * w + ix) * 4;
  cur.bg = [data[i], data[i + 1], data[i + 2]];
  $("impBg").checked = true;
  process();
});

for (const id of ["impTol", "impHoles", "impSoft", "impBg"]) $(id).addEventListener("input", processSoon);
$("impLight").addEventListener("change", (e) => $("impPreview").classList.toggle("light", e.target.checked));

/** Recorta no que sobrou opaco (com 2px de folga) e codifica em PNG. */
async function encode(result) {
  const { width: w, height: h, data } = result;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
  x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
  const full = document.createElement("canvas");
  full.width = w; full.height = h;
  full.getContext("2d").putImageData(result, 0, 0);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(full, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise((res) => out.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

$("impAdd").addEventListener("click", async () => {
  if (!cur) return;
  $("impAdd").disabled = true;
  try {
    const png = await encode(cur.result);
    if (!png) return flash("A imagem ficou vazia: baixe a tolerância.", true);
    const state = $("impState").value;
    const r = await window.overlay.addImage(state, png);
    if (r.error) return flash(r.error, true);
    lastState = state;
    flash(`${r.ok} adicionada.`);
    next(); // a pasta mudou: o main avisa e o calibrate.js recarrega
  } finally {
    $("impAdd").disabled = false;
  }
});
$("impSkip").addEventListener("click", next);
$("impCancel").addEventListener("click", () => { queue.length = 0; next(); });
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cur) $("impCancel").click();
});

$("addImages").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

// Soltar arquivos em qualquer lugar da janela. Sem preventDefault o Electron
// navegaria para o arquivo e a janela do editor viraria a imagem.
addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dropping"); });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  addFiles(e.dataTransfer.files);
});

refreshPets();

/* Calibrador de tamanho (bandeja → "Calibrar tamanho…").

   Mostra todas as imagens do pet lado a lado, apoiadas no mesmo chão e na
   escala real do overlay. O palpite inicial é o automático do mesh.js (a
   maior ilha opaca é o personagem); aqui o usuário corrige o que errar e
   salva no pet.json. Unidades do arquivo: scale = px da tela por px da
   imagem original; floor = px originais entre a base da imagem e os pés. */

const PET = "default";
const GAP = 48;          // espaço entre imagens no palco, px da tela
const PAD = 24;
const LABEL_H = 44;      // nomes embaixo do chão
const TOP_ROOM = 40;

const stage = document.getElementById("stage");
const ctx = stage.getContext("2d");
const $ = (id) => document.getElementById(id);

let items = [];          // { name, s, e: { scale, floor }, card }
let height = PetMesh.DEFAULT_HEIGHT;
let savedJson = "";
let selected = 0;
let layout = { zoom: 1, floorY: 0, slots: [] }; // recalculado em relayout()

const placeOf = (it) => PetMesh.place(it.s, it.e, height);
const autoOf = (it) => PetMesh.autoEntry(it.s, height);

// Ordem natural: pensando1, pensando2, pensando10 (e não 1, 10, 2).
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

// ---------------------------------------------------------------------------
// Carregar / salvar
// ---------------------------------------------------------------------------

async function load() {
  const [files, cfg] = await Promise.all([
    window.overlay.listSprites().catch(() => []),
    window.overlay.readConfig().catch(() => ({})),
  ]);
  height = cfg.height > 0 ? cfg.height : PetMesh.DEFAULT_HEIGHT;
  const names = files.map((f) => f.name).sort(collator.compare);
  const loaded = await Promise.all(names.map(async (name) => {
    try {
      const s = await PetMesh.load(`pet://${PET}/${encodeURIComponent(name)}`);
      return { name, s };
    } catch {
      return null;
    }
  }));
  items = loaded.filter(Boolean).map((it) => {
    const saved = cfg.images?.[it.name];
    const e = saved && saved.scale > 0 ? { scale: saved.scale, floor: saved.floor || 0 } : PetMesh.autoEntry(it.s, height);
    return { ...it, e };
  });
  selected = Math.min(selected, Math.max(0, items.length - 1));
  savedJson = serialize();
  buildCards();
  syncAll();
}

function serialize() {
  const images = {};
  for (const it of items) images[it.name] = { scale: +it.e.scale.toFixed(5), floor: +it.e.floor.toFixed(1) };
  return JSON.stringify({ height: Math.round(height), images });
}

const dirty = () => serialize() !== savedJson;

async function save() {
  const json = serialize();
  await window.overlay.saveConfig(JSON.parse(json));
  savedJson = json;
  updateStatus("Salvo. O pet já foi atualizado.");
}

// ---------------------------------------------------------------------------
// Palco
// ---------------------------------------------------------------------------

// Zoom e posições só mudam aqui (fim de um ajuste, redimensionar a janela),
// não a cada movimento: senão o palco "respira" enquanto você arrasta.
function relayout() {
  const w = stage.clientWidth, h = stage.clientHeight;
  let total = PAD * 2 + GAP * Math.max(0, items.length - 1), up = 0, down = 0;
  const ext = items.map((it) => {
    const p = placeOf(it);
    const left = p.pivot.x * p.ds, right = (it.s.w - p.pivot.x) * p.ds;
    up = Math.max(up, p.pivot.y * p.ds, height);
    down = Math.max(down, (it.s.h - p.pivot.y) * p.ds);
    total += left + right;
    return { left, right };
  });
  const zoom = Math.min(1, w / total, (h - TOP_ROOM - LABEL_H) / (up + down || 1));
  let x = Math.max(PAD, (w - total * zoom) / 2 + PAD * zoom);
  const slots = ext.map(({ left, right }) => {
    const feet = x + left * zoom;
    x += (left + right + GAP) * zoom;
    return feet;
  });
  layout = { zoom, floorY: h - LABEL_H - down * zoom, slots };
}

function rectOf(i) {
  const it = items[i], p = placeOf(it), k = p.ds * layout.zoom;
  const x = layout.slots[i] - p.pivot.x * k, y = layout.floorY - p.pivot.y * k;
  return { x, y, w: it.s.w * k, h: it.s.h * k, k };
}

function draw() {
  const dpr = devicePixelRatio || 1;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (stage.width !== Math.round(w * dpr) || stage.height !== Math.round(h * dpr)) {
    stage.width = Math.round(w * dpr);
    stage.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!items.length) return;

  const { zoom, floorY } = layout;
  ctx.fillStyle = "#1b1f2c";
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.strokeStyle = "#4a5068";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, floorY + 0.5); ctx.lineTo(w, floorY + 0.5); ctx.stroke();

  // Altura alvo: o topo dos personagens deve encostar aqui.
  const refY = Math.round(floorY - height * zoom) + 0.5;
  ctx.strokeStyle = "#ffcf6e";
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(0, refY); ctx.lineTo(w, refY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffcf6e";
  ctx.font = "12px system-ui";
  ctx.fillText(`altura alvo · ${Math.round(height)} px` + (zoom < 1 ? ` · zoom ${Math.round(zoom * 100)}%` : ""), 10, refY - 6);

  ctx.imageSmoothingQuality = "high";
  items.forEach((it, i) => {
    const r = rectOf(i);
    ctx.drawImage(it.s.canvas, r.x, r.y, r.w, r.h);

    if (i === selected) {
      // Caixa do personagem detectado: é ela que o palpite automático usa.
      const c = it.s.comp;
      ctx.strokeStyle = "#6f8dff";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(r.x + c.x0 * r.k + 0.5, r.y + c.y0 * r.k + 0.5, (c.x1 - c.x0) * r.k, (c.y1 - c.y0) * r.k);
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(111, 141, 255, .35)";
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
    ctx.fillStyle = "#ff5c7a";
    ctx.beginPath(); ctx.arc(layout.slots[i], floorY, 3.5, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = i === selected ? "#e8eaf0" : "#a3a8b8";
    ctx.textAlign = "center";
    ctx.fillText(it.name, layout.slots[i], floorY + 20);
    ctx.fillStyle = "#8a90a3";
    ctx.fillText(`${Math.round((it.e.scale / autoOf(it).scale) * 100)}% do auto`, layout.slots[i], floorY + 36);
    ctx.textAlign = "start";
  });
}

function itemAt(x, y) {
  for (let i = items.length - 1; i >= 0; i--) {
    const r = rectOf(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

function select(i) {
  if (i < 0 || i >= items.length) return;
  selected = i;
  items.forEach((it, j) => it.card.classList.toggle("sel", j === i));
  items[i].card.scrollIntoView({ block: "nearest" });
  draw();
}

function changed(i) {
  syncCard(items[i]);
  updateStatus();
  draw();
}

let relayoutTimer = 0;
function relayoutSoon() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => { relayout(); draw(); }, 250);
}

function scaleBy(i, f) {
  items[i].e.scale = Math.min(50, Math.max(1e-4, items[i].e.scale * f));
  changed(i);
  relayoutSoon();
}

let drag = null;
stage.addEventListener("pointerdown", (e) => {
  const i = itemAt(e.offsetX, e.offsetY);
  if (i < 0) return;
  select(i);
  stage.setPointerCapture(e.pointerId);
  drag = { i, y: e.offsetY, floor: items[i].e.floor };
});
stage.addEventListener("pointermove", (e) => {
  if (!drag) {
    stage.classList.toggle("over", itemAt(e.offsetX, e.offsetY) >= 0);
    return;
  }
  // Arrastar para baixo = os pés sobem dentro da imagem = imagem desce.
  const it = items[drag.i];
  it.e.floor = drag.floor + (e.offsetY - drag.y) / layout.zoom / it.e.scale;
  changed(drag.i);
});
const endDrag = () => { if (drag) { drag = null; relayout(); draw(); } };
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("wheel", (e) => {
  const i = itemAt(e.offsetX, e.offsetY);
  if (i < 0) return;
  e.preventDefault();
  if (i !== selected) select(i);
  scaleBy(i, Math.exp(-e.deltaY * 0.0012));
}, { passive: false });
stage.addEventListener("dblclick", (e) => {
  const i = itemAt(e.offsetX, e.offsetY);
  if (i >= 0) resetToAuto(i);
});

addEventListener("keydown", (e) => {
  if (!items.length || e.target.tagName === "INPUT") return;
  const it = items[selected];
  const step = e.shiftKey ? 10 : 1; // px da tela
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    it.e.floor += (e.key === "ArrowDown" ? step : -step) / it.e.scale;
    changed(selected);
    relayoutSoon();
  } else if (e.key === "+" || e.key === "=") scaleBy(selected, e.shiftKey ? 1.1 : 1.02);
  else if (e.key === "-") scaleBy(selected, e.shiftKey ? 1 / 1.1 : 1 / 1.02);
  else if (e.key === "ArrowLeft") select(selected - 1);
  else if (e.key === "ArrowRight") select(selected + 1);
  else if (e.key === "s" && e.ctrlKey) { e.preventDefault(); save(); }
});

function resetToAuto(i) {
  items[i].e = autoOf(items[i]);
  changed(i);
  relayout();
  draw();
}

// ---------------------------------------------------------------------------
// Cartões (controles finos por imagem)
// ---------------------------------------------------------------------------

function buildCards() {
  const host = $("cards");
  host.replaceChildren();
  if (!items.length) {
    host.innerHTML = `<div class="empty">Nenhum PNG na pasta do pet. Use "Abrir pasta do pet" na bandeja.</div>`;
    return;
  }
  items.forEach((it, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="top"><span class="name"></span><span class="auto"></span><button>Auto</button></div>
      <div class="row"><span>Tamanho</span><input type="range" class="size" min="-2" max="2" step="0.005"><output class="sizeOut"></output></div>
      <div class="row"><span>Chão</span><input type="range" class="floor" min="-150" max="150" step="1"><output class="floorOut"></output></div>`;
    card.querySelector(".name").textContent = it.name;
    card.querySelector(".name").title = it.name;
    card.addEventListener("pointerdown", () => { if (selected !== i) select(i); });
    card.querySelector("button").addEventListener("click", () => resetToAuto(i));
    // Tamanho em escala log: 25% a 400% do palpite automático.
    card.querySelector(".size").addEventListener("input", (e) => {
      it.e.scale = autoOf(it).scale * 2 ** +e.target.value;
      changed(i);
    });
    // Chão em px da tela (o que você vê), guardado em px da imagem original.
    card.querySelector(".floor").addEventListener("input", (e) => {
      it.e.floor = +e.target.value / it.e.scale;
      changed(i);
    });
    for (const input of card.querySelectorAll("input")) input.addEventListener("change", () => { relayout(); draw(); });
    it.card = card;
    host.append(card);
  });
}

function syncCard(it) {
  const auto = autoOf(it);
  const log = Math.log2(it.e.scale / auto.scale);
  const floorPx = it.e.floor * it.e.scale;
  it.card.querySelector(".size").value = log;
  it.card.querySelector(".sizeOut").textContent = `${Math.round(2 ** log * 100)}%`;
  it.card.querySelector(".floor").value = floorPx;
  it.card.querySelector(".floorOut").textContent = `${Math.round(floorPx)} px`;
  const isAuto = Math.abs(it.e.scale / auto.scale - 1) < 0.005 && Math.abs((it.e.floor - auto.floor) * it.e.scale) < 0.5;
  it.card.querySelector(".auto").textContent = isAuto ? "automático" : "";
}

function updateStatus(msg) {
  const d = dirty();
  $("status").textContent = msg && !d ? msg : d ? "Alterações não salvas" : "Tudo salvo";
  $("status").classList.toggle("dirty", d);
  $("save").disabled = !d;
  $("discard").disabled = !d;
  if (items.length) {
    const size = PetMesh.windowSize(items.map((it) => ({ s: it.s, p: placeOf(it) })));
    $("win").textContent = `Janela do overlay: ${size.w} × ${size.h} px.`;
  }
}

function syncAll() {
  $("height").value = height;
  $("heightOut").textContent = `${Math.round(height)} px`;
  items.forEach(syncCard);
  updateStatus();
  relayout();
  select(selected);
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

// Muda o tamanho do pet inteiro: cada imagem escala junto, então os ajustes
// relativos entre elas se mantêm.
$("height").addEventListener("input", (e) => {
  const f = +e.target.value / height;
  height = +e.target.value;
  for (const it of items) it.e.scale *= f;
  $("heightOut").textContent = `${Math.round(height)} px`;
  items.forEach(syncCard);
  updateStatus();
  relayout();
  draw();
});
$("autoAll").addEventListener("click", () => {
  for (const it of items) it.e = autoOf(it);
  syncAll();
});
$("discard").addEventListener("click", load);
$("save").addEventListener("click", save);

addEventListener("resize", () => { relayout(); draw(); });
// Imagem nova na pasta: recarrega, mas nunca por cima de ajuste não salvo.
window.overlay.onSpritesChanged(() => { if (!dirty()) load(); });

load();

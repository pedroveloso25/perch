/* Janela de configurações (bandeja → "Configurações…"). Só tela: quem valida
   e aplica é o main (cfg:set / cfg:claude em main.js). */

const $ = (id) => document.getElementById(id);
let cfg = null;

function msg(text, error = false) {
  $("msg").textContent = text;
  $("msg").classList.toggle("err", error);
}

const CLAUDE_TEXT = {
  connected: ["ok", "Conectado: o Claude Code avisa este app."],
  none: ["warn", "Não conectado: o pet não sabe quando o Claude trabalha."],
  partial: ["warn", "Conexão incompleta (faltam alguns hooks). Conecte de novo."],
  other: ["warn", "Conectado a outra cópia do perch: "],
  error: ["err", ""],
};

function render(c) {
  cfg = c;
  $("version").textContent = `versão ${c.version}${c.packaged ? "" : " · desenvolvimento"}`;
  $("petMode").checked = c.petMode;
  $("gravity").checked = c.gravity;
  $("sleepAfterMin").value = c.sleepAfterMin;
  $("sleepOut").textContent = `${c.sleepAfterMin} min`;
  $("walkiness").value = c.walkiness;
  $("autostart").checked = c.autostart;
  $("autostart").disabled = !c.autostartAvailable;
  if (!c.autostartAvailable) $("autostartHint").textContent = "Disponível só no app instalado.";
  $("daemon").textContent = c.daemon;

  const [cls, text] = CLAUDE_TEXT[c.claude.state] || CLAUDE_TEXT.error;
  const box = $("claudeStatus");
  box.className = "status " + cls;
  box.textContent = c.claude.state === "other" ? text + c.claude.paths.join(", ")
    : c.claude.state === "error" ? c.claude.error : text;
  if (!c.nodeOk) {
    box.className = "status err";
    box.textContent += " Atenção: o comando \"node\" não foi encontrado; os hooks precisam do Node.js instalado.";
  }
  $("connect").textContent = c.claude.state === "connected" ? "Reconectar" : "Conectar ao Claude Code";
  $("disconnect").disabled = c.claude.state === "none";

  $("cli").textContent =
    `node "${c.perchCli}" celebrate\n` +
    `node "${c.perchCli}" alert\n` +
    `node "${c.perchCli}" hello\n\n` +
    `# exemplo: npm test && node "${c.perchCli}" celebrate || node "${c.perchCli}" alert`;
}

async function set(patch) {
  const r = await window.overlay.setConfig(patch);
  if (r.error) return msg(r.error, true);
  render(r.ok);
  msg("Salvo.");
}

$("petMode").addEventListener("change", (e) => set({ petMode: e.target.checked }));
$("gravity").addEventListener("change", (e) => set({ gravity: e.target.checked }));
$("walkiness").addEventListener("change", (e) => set({ walkiness: e.target.value }));
$("autostart").addEventListener("change", (e) => set({ autostart: e.target.checked }));
$("sleepAfterMin").addEventListener("input", (e) => { $("sleepOut").textContent = `${e.target.value} min`; });
$("sleepAfterMin").addEventListener("change", (e) => set({ sleepAfterMin: +e.target.value }));

async function claude(action) {
  const r = await window.overlay.claudeHooks(action);
  if (r.error) return msg(r.error, true);
  render(r.ok.snapshot);
  msg((action === "connect" ? "Conectado." : "Desconectado.")
    + (r.ok.backup ? ` Backup do arquivo anterior: ${r.ok.backup}` : ""));
}
$("connect").addEventListener("click", () => claude("connect"));
$("disconnect").addEventListener("click", () => claude("disconnect"));
$("showClaude").addEventListener("click", () => window.overlay.openThing("claude"));
$("openEditor").addEventListener("click", () => window.overlay.openThing("editor"));
$("openPets").addEventListener("click", () => window.overlay.openThing("pets"));

window.overlay.getConfig().then(render);

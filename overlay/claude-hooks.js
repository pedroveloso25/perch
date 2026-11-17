/**
 * Liga/desliga o perch nos hooks do Claude Code (~/.claude/settings.json).
 *
 * O arquivo é do usuário e tem outras coisas (modelo, outros hooks, talvez
 * credenciais): as funções daqui só tocam nas entradas do perch e devolvem
 * um objeto NOVO; quem grava (main.js) faz backup antes. Puro, testado em
 * claude-hooks.test.js.
 *
 * Uma entrada é "do perch" quando o comando roda um notify.js que mora numa
 * pasta chamada perch (o repo .../perch/hooks/notify.js ou o app instalado
 * .../Perch/resources/hooks/notify.js). Assim, conectar troca hooks antigos
 * apontando para outro lugar em vez de duplicar, e o notify.js de outro
 * projeto nunca é tocado.
 */

// Evento do Claude Code -> argumento do notify.js (e matcher, quando tem).
const EVENTS = {
  UserPromptSubmit: { arg: "working" },
  PreToolUse: { arg: "working", matcher: ".*" },
  PostToolUse: { arg: "tool-done", matcher: ".*" },
  Notification: { arg: "blocked" },
  Stop: { arg: "stop" },
  SessionEnd: { arg: "end" },
};

const PERCH_CMD = /[\\/]perch[\\/](?:[^"]*[\\/])?notify\.js"?\s+[a-z-]+\s*$/i;
const isPerchHook = (h) => h && h.type === "command" && typeof h.command === "string" && PERCH_CMD.test(h.command);

/** Caminho com barra normal: o Node aceita no Windows e o JSON fica sem escape. */
const slash = (p) => p.replace(/\\/g, "/");
const commandFor = (notifyPath, arg) => `node "${slash(notifyPath)}" ${arg}`;

/** Caminho do notify.js usado pelas entradas do perch, ou null. */
function perchPathIn(cmd) {
  const m = cmd.match(/"([^"]+notify\.js)"/) || cmd.match(/(\S+notify\.js)/);
  return m ? slash(m[1]) : null;
}

/**
 * @returns { state: "connected" | "other" | "partial" | "none", paths }
 *   connected: os 6 eventos apontam para notifyPath;
 *   other: há hooks do perch, mas para outro caminho (ex.: o repo);
 *   partial: só alguns eventos.
 */
function status(settings, notifyPath) {
  const want = slash(notifyPath).toLowerCase();
  const paths = new Set();
  let ours = 0;
  for (const [event, { arg }] of Object.entries(EVENTS)) {
    let found = false;
    for (const group of settings?.hooks?.[event] || [])
      for (const h of group?.hooks || [])
        if (isPerchHook(h)) {
          const p = perchPathIn(h.command);
          if (p) paths.add(p);
          if (p && p.toLowerCase() === want && h.command.trim().endsWith(" " + arg)) found = true;
        }
    if (found) ours++;
  }
  const all = Object.keys(EVENTS).length;
  const state = ours === all ? "connected" : paths.size === 0 ? "none"
    : [...paths].some((p) => p.toLowerCase() !== want) ? "other" : "partial";
  return { state, paths: [...paths] };
}

/** Tira as entradas do perch (grupos e eventos que ficarem vazios somem). */
function uninstall(settings) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (!out.hooks || typeof out.hooks !== "object") return out;
  for (const event of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[event])) continue;
    out.hooks[event] = out.hooks[event]
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isPerchHook(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (out.hooks[event].length === 0) delete out.hooks[event];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

/** Remove qualquer hook do perch e adiciona os 6 apontando para notifyPath. */
function install(settings, notifyPath) {
  const out = uninstall(settings);
  out.hooks = out.hooks || {};
  for (const [event, { arg, matcher }] of Object.entries(EVENTS)) {
    const group = {
      ...(matcher ? { matcher } : {}),
      // async: o Claude não espera o hook; timeout curto: daemon fora do ar não trava nada.
      hooks: [{ type: "command", command: commandFor(notifyPath, arg), async: true, timeout: 5 }],
    };
    out.hooks[event] = [...(out.hooks[event] || []), group];
  }
  return out;
}

module.exports = { EVENTS, status, install, uninstall, isPerchHook, commandFor };

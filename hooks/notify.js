/**
 * Ponte hook -> daemon.
 *
 * Uso:  node notify.js <working|tool-done|blocked|stop|end|ping>
 *
 * Lê o JSON que o Claude Code entrega no stdin (session_id, tool_name, ...)
 * e faz POST no daemon.
 *
 * Por que um script em vez de curl direto no settings.json:
 * no Windows o comando do hook passa pelo cmd, e escapar JSON inline
 * (aspas duplas dentro de aspas duplas) é uma fonte infinita de bug silencioso.
 * Aqui o JSON nunca toca a linha de comando.
 */

const http = require("http");

const PORT = Number(process.env.PERCH_PORT || 4747);
const event = process.argv[2];

if (!event) process.exit(0);

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let hook = {};
  try {
    hook = JSON.parse(raw || "{}");
  } catch {
    /* stdin vazio ou malformado: segue com defaults */
  }

  // O hook Notification também dispara para "Claude está esperando seu input"
  // (~60s depois do Stop). Isso não é bloqueio: o turno já acabou. Só pedido
  // de permissão / pergunta ao usuário vira "blocked".
  if (event === "blocked" && !needsUserAction(hook)) process.exit(0);

  const payload = JSON.stringify({
    session_id: hook.session_id || "default",
    event,
    tool: hook.tool_name || null,
  });

  const req = http.request(
    {
      host: "127.0.0.1",
      port: PORT,
      path: "/event",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 300,
    },
    (res) => res.resume()
  );

  // Fire-and-forget. O daemon estar fora do ar NUNCA pode degradar o Claude:
  // qualquer erro aqui é engolido e o processo sai com 0.
  req.on("error", () => process.exit(0));
  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });

  req.end(payload);
});

function needsUserAction(hook) {
  if (hook.notification_type) {
    return hook.notification_type === "permission_prompt" ||
      hook.notification_type === "elicitation_dialog";
  }
  // Versões do Claude Code sem notification_type: cai para o texto.
  return !/waiting for your input/i.test(hook.message || "");
}

// Rede de segurança: se o stdin nunca fechar, não deixa o processo pendurado.
setTimeout(() => process.exit(0), 1000).unref();

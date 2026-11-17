/**
 * perch-daemon — barramento de estado local.
 *
 * Recebe eventos (POST /event) e transmite para o overlay via SSE (GET /stream):
 * - sessões (hooks do Claude Code ou qualquer fonte com session_id): estado
 *   derivado, regras em state.js;
 * - reações ({"event":"react","kind":...}, ver reactions.js): repassadas
 *   como evento SSE "reaction", sem mexer no estado. É o ponto de entrada
 *   para outras fontes (scripts, CI, timers) — hooks/perch.js.
 *
 * Roda de dois jeitos: dentro do app (o main do overlay chama startDaemon;
 * é o caso do app instalado) ou sozinho, `node server.js`, para
 * desenvolvimento. Se a porta já estiver ocupada por outro daemon, o app usa
 * esse e não sobe outro.
 *
 * Zero dependências. Node 18+.
 */

const http = require("http");
const { createState } = require("./state");
const { createReactions } = require("./reactions");

const PORT = Number(process.env.PERCH_PORT || 4747);
const SWEEP_MS = 5_000;

function defaultLog(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

/**
 * Sobe o daemon. Resolve com { server, close } ao começar a ouvir; rejeita
 * com o erro do listen (EADDRINUSE = já existe um daemon nessa porta).
 */
function startDaemon({ port = PORT, log = defaultLog } = {}) {
  const state = createState();
  const reactions = createReactions();
  let lastBroadcast = null;
  const clients = new Set();

  function broadcast() {
    const payload = state.derive();
    const serialized = JSON.stringify(payload);

    // Só emite em mudança real. Sem isso, PreToolUse de um loop de edições
    // manda dezenas de mensagens idênticas por segundo para o renderer.
    // (O renderer não depende mais disso para animar certo — é economia.)
    if (serialized === lastBroadcast) return;
    lastBroadcast = serialized;

    const frame = `data: ${serialized}\n\n`;
    for (const res of clients) {
      res.write(frame);
    }
    log(`state -> ${payload.state}${payload.tool ? ` (${payload.tool})` : ""}`);
  }

  function broadcastReaction(reaction) {
    const frame = `event: reaction\ndata: ${JSON.stringify(reaction)}\n\n`;
    for (const res of clients) res.write(frame);
    log(`reação ${reaction.kind} (fonte: ${reaction.source})`);
  }

  const server = http.createServer((req, res) => {
    // O overlay carrega de file:// e consome http://127.0.0.1 — sem este header
    // o EventSource falha silenciosamente por CORS.
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Headers": "content-type" });
      return res.end();
    }

    if (req.method === "GET" && req.url === "/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.add(res);
      res.write(`data: ${JSON.stringify(state.derive())}\n\n`); // snapshot inicial
      log(`overlay conectado (${clients.size} ativo(s))`);

      req.on("close", () => {
        clients.delete(res);
        log(`overlay desconectou (${clients.size} ativo(s))`);
      });
      return;
    }

    if (req.method === "GET" && req.url === "/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(state.derive()));
    }

    if (req.method === "POST" && req.url === "/event") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 10_000) req.destroy(); // guarda contra payload absurdo
      });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body || "{}");
          const r = reactions.handle(msg);
          if (r) {
            if (r.reaction) broadcastReaction(r.reaction);
            return res.writeHead(r.ok ? 204 : 400).end();
          }
          const ok = state.handle(msg);
          if (ok) broadcast();
          res.writeHead(ok ? 204 : 400).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }

    res.writeHead(404).end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1 e não 0.0.0.0: isto não tem autenticação nenhuma e não deve
    // aceitar conexão de fora da máquina.
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      log(`perch-daemon ouvindo em http://127.0.0.1:${port}`);

      // Varredura de TTL + expiração do "done".
      const sweep = setInterval(() => {
        const { expired, changed } = state.sweep();
        for (const id of expired) log(`sessão ${id.slice(0, 8)} expirou por TTL`);
        if (changed) broadcast();
      }, SWEEP_MS);

      resolve({
        server,
        close() {
          clearInterval(sweep);
          for (const res of clients) res.end();
          server.close();
        },
      });
    });
  });
}

module.exports = { startDaemon, PORT };

if (require.main === module) {
  startDaemon().catch((err) => {
    console.error(err.code === "EADDRINUSE"
      ? `porta ${PORT} ocupada: já tem um daemon rodando (o app Perch sobe o dele)`
      : err.message);
    process.exit(1);
  });
}

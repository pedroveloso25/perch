/**
 * perch-daemon — barramento de estado local.
 *
 * Recebe eventos dos hooks do Claude Code (POST /event) e transmite o estado
 * derivado para o overlay via SSE (GET /stream).
 *
 * As regras de transição moram em state.js; aqui é só HTTP e relógio.
 *
 * Zero dependências. Node 18+.
 */

const http = require("http");
const { createState } = require("./state");

const PORT = Number(process.env.PERCH_PORT || 4747);
const SWEEP_MS = 5_000;

const state = createState();
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

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

// Varredura de TTL + expiração do "done".
setInterval(() => {
  const { expired, changed } = state.sweep();
  for (const id of expired) log(`sessão ${id.slice(0, 8)} expirou por TTL`);
  if (changed) broadcast();
}, SWEEP_MS);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

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
        const ok = state.handle(JSON.parse(body || "{}"));
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

// 127.0.0.1 e não 0.0.0.0: isto não tem autenticação nenhuma e não deve
// aceitar conexão de fora da máquina.
server.listen(PORT, "127.0.0.1", () => {
  log(`perch-daemon ouvindo em http://127.0.0.1:${PORT}`);
});

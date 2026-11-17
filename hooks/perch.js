#!/usr/bin/env node
/**
 * Chama o pet de qualquer script — uma "fonte de evento" que não é o Claude.
 *
 *   node perch.js celebrate      comemora (dois pulos)
 *   node perch.js alert          chama atenção (balança e brilha uns segundos)
 *   node perch.js hello          um pulinho
 *
 * Opcional: --source nome  (aparece no log do daemon).
 *
 * Exemplos:
 *   npm test && node perch.js celebrate || node perch.js alert
 *   npm run build; node perch.js hello
 *
 * Sai sempre com 0 e em no máximo ~300ms: o pet fora do ar nunca pode
 * atrapalhar o script que chamou (mesma regra dos hooks, ver notify.js).
 */

const http = require("http");

const PORT = Number(process.env.PERCH_PORT || 4747);
const args = process.argv.slice(2);
const kind = args.find((a) => !a.startsWith("--"));
const si = args.indexOf("--source");
const source = si >= 0 ? args[si + 1] : "cli";

if (!kind) {
  console.error("uso: node perch.js <celebrate|alert|hello> [--source nome]");
  process.exit(0);
}

const payload = JSON.stringify({ event: "react", kind, source });
const req = http.request(
  {
    host: "127.0.0.1",
    port: PORT,
    path: "/event",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    timeout: 300,
  },
  (res) => {
    if (res.statusCode === 400) console.error(`perch: tipo de reação desconhecido: ${kind}`);
    res.resume();
    res.on("end", () => process.exit(0));
  }
);
req.on("error", () => process.exit(0));
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.end(payload);

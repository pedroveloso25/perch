/**
 * Reações: o jeito de QUALQUER fonte de evento (script de build, CI, timer,
 * outra IDE) chamar o pet, sem mexer no estado das sessões do Claude.
 *
 *   POST /event  {"event":"react","kind":"celebrate","source":"build"}
 *
 * Uma reação é instantânea: o daemon repassa ao overlay (evento SSE
 * "reaction") e esquece. Quem decide a cara de cada uma é o renderer.
 * Puro e com relógio injetado, como state.js (testes em reactions.test.js).
 */

const KINDS = ["celebrate", "alert", "hello"];
const MIN_GAP_MS = 500; // um loop de script não vira metralhadora de pulos

function createReactions({ now = Date.now, minGapMs = MIN_GAP_MS } = {}) {
  let last = -Infinity;

  return {
    /**
     * @returns null se a mensagem não é uma reação (segue para state.js);
     *   { ok: false } se é reação inválida; { ok: true, reaction } se aceita,
     *   com reaction = null quando descartada pelo intervalo mínimo.
     */
    handle(msg) {
      if (!msg || msg.event !== "react") return null;
      if (!KINDS.includes(msg.kind)) return { ok: false };
      const source = typeof msg.source === "string" ? msg.source.slice(0, 40) : "desconhecida";
      const t = now();
      if (t - last < minGapMs) return { ok: true, reaction: null };
      last = t;
      return { ok: true, reaction: { kind: msg.kind, source } };
    },
  };
}

module.exports = { createReactions, KINDS };

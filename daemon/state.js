/**
 * Lógica de estado do daemon, sem HTTP e sem relógio global.
 *
 * Separado do server.js para ser testável: `now` é injetado, então os testes
 * controlam o tempo sem setTimeout nem fake timers.
 */

// Quanto tempo uma sessão sobrevive sem receber nenhum evento novo.
// Existe porque Ctrl+C / crash do terminal NÃO dispara o hook Stop:
// sem TTL o pet ficaria "pensando" para sempre.
const SESSION_TTL_MS = 120_000;

// TTL enquanto uma tool está rodando. Um `npm run build` de 5 minutos não
// dispara nenhum hook no meio: com o TTL curto a sessão expirava e o pet
// sumia com o Claude ainda trabalhando. PostToolUse devolve ao TTL curto.
const TOOL_TTL_MS = 15 * 60_000;

// Quanto tempo o estado "done" fica visível antes de decair para idle.
const DONE_HOLD_MS = 8_000;

function createState({ now = Date.now } = {}) {
  /**
   * sessions: session_id -> {
   *   status: 'working'|'blocked', tool: string|null, toolRunning: boolean, ts: number
   * }
   *
   * É um Map e não um booleano de propósito: com dois terminais abertos, o Stop
   * do primeiro não pode apagar a animação enquanto o segundo ainda trabalha.
   */
  const sessions = new Map();
  let doneUntil = 0; // timestamp até quando o estado "done" vale

  /**
   * Precedência: blocked > working > done > idle.
   *
   * blocked ganha de working porque é o único estado que exige ação sua agora.
   * Se duas sessões estão rodando e uma pede permissão, você precisa ver "pede
   * permissão", não "trabalhando".
   */
  function derive() {
    let blocked = false;
    let working = false;
    let tool = null;
    let newestWorking = 0;

    for (const s of sessions.values()) {
      if (s.status === "blocked") {
        blocked = true;
      } else if (s.status === "working") {
        working = true;
        if (s.ts > newestWorking) {
          newestWorking = s.ts;
          tool = s.tool;
        }
      }
    }

    if (blocked) return { state: "blocked", tool: null, sessions: sessions.size };
    if (working) return { state: "working", tool, sessions: sessions.size };
    if (now() < doneUntil) return { state: "done", tool: null, sessions: 0 };
    return { state: "idle", tool: null, sessions: 0 };
  }

  /** Retorna false para evento desconhecido. */
  function handle({ session_id, event, tool }) {
    const id = session_id || "default";
    const t = now();

    switch (event) {
      case "working":
        // PreToolUse manda tool_name; UserPromptSubmit não. Só o primeiro
        // significa "tem processo rodando que pode demorar".
        sessions.set(id, { status: "working", tool: tool || null, toolRunning: !!tool, ts: t });
        doneUntil = 0; // trabalho novo cancela o "done" pendente
        break;

      case "tool-done": {
        // PostToolUse: a tool acabou mas o turno continua. Mantém o tool para
        // o sprite não piscar entre uma tool e outra.
        const s = sessions.get(id);
        if (s) {
          s.toolRunning = false;
          s.ts = t;
        }
        break;
      }

      case "blocked":
        sessions.set(id, { status: "blocked", tool: null, toolRunning: false, ts: t });
        doneUntil = 0;
        break;

      case "stop": {
        // Só celebra se a sessão estava ativa E era a última. Stop de uma
        // sessão que já expirou (ou nunca trabalhou) não é "terminou".
        const existed = sessions.delete(id);
        if (existed && sessions.size === 0) doneUntil = t + DONE_HOLD_MS;
        break;
      }

      case "end":
        // SessionEnd: o terminal fechou. Nunca celebra — normalmente chega
        // logo depois de um Stop, e celebrar de novo seria um "done" duplo.
        sessions.delete(id);
        break;

      case "ping":
        // renova TTL sem mudar status
        if (sessions.has(id)) sessions.get(id).ts = t;
        break;

      default:
        return false;
    }
    return true;
  }

  /**
   * Varredura periódica: expira sessões por TTL e o "done" vencido.
   * Retorna os ids expirados e se o estado derivado pode ter mudado.
   */
  function sweep() {
    const t = now();
    const expired = [];

    for (const [id, s] of sessions) {
      const ttl = s.toolRunning ? TOOL_TTL_MS : SESSION_TTL_MS;
      if (t - s.ts > ttl) {
        sessions.delete(id);
        expired.push(id);
      }
    }

    // se o "done" acabou de vencer, precisa reemitir para virar idle
    let doneExpired = false;
    if (doneUntil && t >= doneUntil) {
      doneUntil = 0;
      doneExpired = true;
    }

    return { expired, changed: expired.length > 0 || doneExpired };
  }

  return { derive, handle, sweep };
}

module.exports = { createState, SESSION_TTL_MS, TOOL_TTL_MS, DONE_HOLD_MS };

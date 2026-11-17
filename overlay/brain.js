/**
 * Cérebro do pet (Fase 4): o que ele faz quando ninguém pede nada.
 *
 *   parado ──(um tempo)──► passeia pela barra ──(chegou)──► parado
 *     │                                                       │
 *     └────(você ficou ausente / tela bloqueada)──► dorme ◄───┘
 *                                                    │
 *          (você voltou, clicou nele, o Claude trabalhou) ──► acorda ──► parado
 *
 * Só manda no ócio e com o "modo pet" ligado. Trabalhando, pedindo permissão
 * ou comemorando, quem manda é o estado do Claude (renderer.js → MOODS) e o
 * cérebro fica em "rest", sem andar.
 *
 * Puro: sem Electron e sem relógio. O main chama update() num timer com as
 * entradas do momento e executa a decisão (andar = mover a janela; o resto é
 * aparência, decidida pelo renderer). Testado em brain.test.js.
 */

const DEFAULTS = {
  sleepAfter: 120,      // s sem mexer no computador para dormir
  restMin: 6, restMax: 20, // s parado antes de decidir de novo
  walkChance: 0.6,      // ao fim do descanso: passear (senão descansa mais)
  walkSpeed: 70,        // DIP/s
  minWalk: 80,          // DIP: passeio curto demais parece tremida
  wakeTime: 1.6,        // s do "acordando" (espreguiça) antes de voltar ao normal
};

function createBrain(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = o.rng || Math.random;
  let activity = "rest";  // rest | walk | sleep | wake
  let timer = 0;          // s restantes na atividade atual (rest, wake)
  let target = null;      // x de destino do passeio
  let woken = false;      // clique pediu para acordar

  const restTime = () => o.restMin + rng() * (o.restMax - o.restMin);
  const go = (a, t = 0) => { activity = a; timer = t; if (a !== "walk") target = null; };
  go("rest", restTime());

  return {
    get activity() { return activity; },
    get target() { return target; },

    /** Clique no pet: dormindo, acorda; senão, dá uma pausa no passeio. */
    poke() {
      if (activity === "sleep") woken = true;
      else if (activity === "walk") go("rest", restTime());
    },

    /**
     * @param dt segundos desde a última chamada
     * @param s { active: modo pet ligado E Claude ocioso,
     *            userIdle: s sem input do usuário, locked: tela bloqueada,
     *            free: no chão e solto (não está sendo arrastado nem caindo),
     *            x, minX, maxX: posição dos pés e limites do chão }
     * @returns { activity, target } — target só no passeio
     */
    update(dt, s) {
      const away = s.locked || s.userIdle >= o.sleepAfter;

      if (!s.active) {
        // Claude trabalhando (ou modo pet desligado): sem passeio e sem sono.
        if (activity !== "rest") go("rest", restTime());
        woken = false;
        return { activity, target };
      }

      if (activity === "sleep") {
        // Acorda com você de volta (qualquer input) ou com um clique.
        if (woken || (!s.locked && s.userIdle < 2)) { woken = false; go("wake", o.wakeTime); }
        return { activity, target };
      }
      woken = false;

      if (away && s.free) {
        go("sleep");
        return { activity, target };
      }

      timer -= dt;
      if (activity === "wake" && timer <= 0) go("rest", restTime());
      else if (activity === "walk") {
        if (!s.free) go("rest", restTime()); // pegaram no colo no meio do passeio
        else if (Math.abs(s.x - target) < 2) go("rest", restTime());
      } else if (activity === "rest" && timer <= 0) {
        const room = s.maxX - s.minX;
        if (s.free && room >= o.minWalk * 1.5 && rng() < o.walkChance) {
          // Destino aleatório, longe o bastante para valer a caminhada.
          let t = s.x;
          for (let i = 0; i < 8 && Math.abs(t - s.x) < o.minWalk; i++) t = s.minX + rng() * room;
          if (Math.abs(t - s.x) >= o.minWalk) { go("walk"); target = t; }
          else go("rest", restTime());
        } else {
          go("rest", restTime());
        }
      }
      return { activity, target };
    },

    /** Ajustes da tela de Configurações (sleepAfter, walkChance, restMin/Max...). */
    configure(next) {
      for (const k of Object.keys(DEFAULTS)) if (Number.isFinite(next?.[k])) o[k] = next[k];
    },

    /** Um passo de caminhada: nova posição x, sem passar do destino. */
    walkStep(x, dt) {
      if (activity !== "walk" || target == null) return x;
      const d = target - x;
      const step = o.walkSpeed * dt;
      return Math.abs(d) <= step ? target : x + Math.sign(d) * step;
    },
  };
}

/**
 * Trecho do chão onde o pet pode passear: a "casa" (onde ele foi solto por
 * último) ± radius, cortado pelos limites da tela. Casa fora da tela vira o
 * ponto mais próximo dentro dela. radius = Infinity: o chão inteiro.
 */
function roamBounds(home, radius, minX, maxX) {
  if (!Number.isFinite(home) || !(radius < Infinity)) return { minX, maxX };
  const h = Math.min(maxX, Math.max(minX, home));
  return { minX: Math.max(minX, h - radius), maxX: Math.min(maxX, h + radius) };
}

module.exports = { createBrain, roamBounds, DEFAULTS };

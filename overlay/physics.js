/**
 * Física do pet na tela (gravidade, arremesso, paredes, chão), sem Electron
 * e sem relógio: o main chama step(dt, área) num timer e move a janela para
 * onde o corpo estiver. Separado para ser testável (physics.test.js).
 *
 * Coordenadas de tela em DIP. (x, y) é o ponto dos PÉS, não o canto da
 * janela: o tamanho da janela muda com as imagens do pet, os pés não.
 */

const DEFAULTS = {
  gravity: 2500,    // DIP/s², o mesmo do pulo dentro da malha (mesh.js)
  bounce: 0.18,     // quique no chão: só um "tum", não uma bola
  wallBounce: 0.5,
  friction: 8,      // 1/s, deslizando no chão depois de um arremesso
  restSpeed: 150,   // pouso abaixo disto não quica
  stopSpeed: 20,
  maxThrow: 2500,
};

function createBody(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const b = { x: 0, y: 0, vx: 0, vy: 0 };

  return {
    get x() { return b.x; },
    get y() { return b.y; },
    get vx() { return b.vx; },
    get vy() { return b.vy; },

    place(x, y) {
      b.x = x; b.y = y; b.vx = 0; b.vy = 0;
    },

    throw(vx, vy) {
      const v = Math.hypot(vx, vy);
      const k = v > o.maxThrow ? o.maxThrow / v : 1;
      b.vx = vx * k; b.vy = vy * k;
    },

    /**
     * @param area workArea do monitor ({x, y, width, height}); a base é o chão
     *   (topo da barra de tarefas).
     * @param extent { side, up } — meia largura e altura do pet a partir dos
     *   pés: as bordas da tela param o corpo visível, não o ponto dos pés.
     * @returns impact: velocidade de pouso neste passo (0 se não pousou);
     *   airborne: no ar (a malha descontará a gravidade); resting: parado no chão.
     */
    step(dt, area, { side = 0, up = 0 } = {}) {
      const floor = area.y + area.height;
      const minX = area.x + side, maxX = area.x + area.width - side;
      let impact = 0;

      if (!(b.y >= floor && b.vy === 0)) b.vy += o.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (minX > maxX) { b.x = area.x + area.width / 2; b.vx = 0; } // pet mais largo que a tela
      else if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * o.wallBounce; }
      else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * o.wallBounce; }

      // Teto: a cabeça não sai por cima da tela num arremesso forte.
      const ceil = Math.min(area.y + up, floor);
      if (b.y < ceil) { b.y = ceil; if (b.vy < 0) b.vy = 0; }

      if (b.y >= floor) {
        b.y = floor;
        if (b.vy > 0) {
          impact = b.vy;
          b.vy = b.vy > o.restSpeed ? -b.vy * o.bounce : 0;
        }
      }

      const onFloor = b.y === floor && b.vy === 0;
      if (onFloor) {
        b.vx *= Math.exp(-o.friction * dt);
        if (Math.abs(b.vx) < o.stopSpeed) b.vx = 0;
      }
      return { impact, airborne: b.y < floor, resting: onFloor && b.vx === 0 };
    },
  };
}

/**
 * Velocidade de arremesso a partir das últimas amostras do cursor durante o
 * arraste ([{ t (ms), x, y }], mais antiga primeiro). Usa só a janela final
 * (~100ms): o que conta é o gesto de soltar, não o arraste inteiro.
 */
function releaseVelocity(samples, windowMs = 100) {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last.t - s.t <= windowMs) { first = s; break; }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

module.exports = { createBody, releaseVelocity, DEFAULTS };

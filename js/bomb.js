/**
 * js/bomb.js
 * ---------------------------------------------------------
 * Bomb constants, rendering, and pure helper functions.
 * The actual bomb LIFECYCLE (spawn timer, pickup/throw
 * arbitration, explosion resolution) is host-authoritative
 * and lives in game.js, which calls these helpers.
 *
 * WHY HOST-AUTHORITATIVE: if every client independently
 * decided "this bomb is mine" or "this explosion killed
 * player X", different clients could disagree (race
 * conditions). Having ONE client (the room host) be the
 * single source of truth for bomb state avoids desync.
 * (Known limitation: if the host disconnects, bomb spawning
 * pauses until we add host-migration in a later phase.)
 * ---------------------------------------------------------
 */

const BOMB_SPAWN_INTERVAL_MS = 3000;
const PICKUP_RADIUS_PX = 55;
const EXPLOSION_RADIUS_PX = 100;
const THROW_SPEED_PX_PER_SEC = 650;
const THROW_MAX_RANGE_PX = 300;
const RESPAWN_DELAY_MS = 3000;
const SHIELD_DURATION_MS = 2000;
const MAX_CONCURRENT_BOMBS = 20;

function generateBombId() {
  return (crypto.randomUUID ? crypto.randomUUID() : "bomb-" + Date.now() + "-" + Math.random());
}

/**
 * Raycast from (fromX, fromY) in the given facing direction,
 * stepping until we hit an obstacle or reach max range.
 * Returns the landing point + travel distance.
 */
function computeThrowTarget(fromX, fromY, facing, obstacles) {
  const dir = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[facing] || { x: 0, y: 1 };

  const step = 8;
  let x = fromX, y = fromY, traveled = 0;

  while (traveled < THROW_MAX_RANGE_PX) {
    const nextX = x + dir.x * step;
    const nextY = y + dir.y * step;

    if (
      nextX < 20 || nextX > WORLD_SIZE - 20 ||
      nextY < 20 || nextY > WORLD_SIZE - 20 ||
      collidesWithAnyObstacle(nextX, nextY, 10, obstacles)
    ) {
      break;
    }
    x = nextX; y = nextY; traveled += step;
  }

  return { x, y, distance: Math.max(traveled, step) };
}

function drawBomb(ctx, bomb) {
  const wobble = Math.sin(performance.now() / 150) * 2;
  ctx.save();
  ctx.translate(bomb.x, bomb.y + wobble);
  ctx.font = "28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("💣", 0, 0);
  ctx.restore();
}

function drawExplosion(ctx, explosion, elapsedMs) {
  const progress = Math.min(1, elapsedMs / 500); // 500ms animation
  const radius = EXPLOSION_RADIUS_PX * progress;
  const alpha = 1 - progress;

  ctx.save();
  ctx.globalAlpha = alpha;
  const gradient = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, radius);
  gradient.addColorStop(0, "#fff3b0");
  gradient.addColorStop(0.4, "#ff9f1c");
  gradient.addColorStop(1, "rgba(255,60,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

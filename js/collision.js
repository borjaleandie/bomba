/**
 * js/collision.js
 * ---------------------------------------------------------
 * Arena definitions (walls/boxes/rocks/trees), spawn points,
 * and collision detection. Shared world size for all arenas
 * keeps the rendering/camera math simple.
 * ---------------------------------------------------------
 */

const WORLD_SIZE = 900;
const PLAYER_RADIUS = 16;

// obstacle "type" only affects how it's drawn (see game.js render)
const ARENAS = {
  arena1: {
    name: "Arena 1",
    obstacles: [
      { x: 0, y: 0, w: WORLD_SIZE, h: 20, type: "wall" },
      { x: 0, y: WORLD_SIZE - 20, w: WORLD_SIZE, h: 20, type: "wall" },
      { x: 0, y: 0, w: 20, h: WORLD_SIZE, type: "wall" },
      { x: WORLD_SIZE - 20, y: 0, w: 20, h: WORLD_SIZE, type: "wall" },

      { x: 150, y: 150, w: 60, h: 60, type: "box" },
      { x: 690, y: 150, w: 60, h: 60, type: "box" },
      { x: 150, y: 690, w: 60, h: 60, type: "box" },
      { x: 690, y: 690, w: 60, h: 60, type: "box" },
      { x: 420, y: 420, w: 60, h: 60, type: "rock" },
      { x: 300, y: 420, w: 40, h: 40, type: "tree" },
      { x: 560, y: 420, w: 40, h: 40, type: "tree" },
      { x: 420, y: 260, w: 40, h: 40, type: "tree" },
      { x: 420, y: 600, w: 40, h: 40, type: "tree" },
    ],
    spawnPoints: [
      { x: 80, y: 80 }, { x: 820, y: 80 }, { x: 80, y: 820 }, { x: 820, y: 820 },
      { x: 450, y: 80 }, { x: 450, y: 820 }, { x: 80, y: 450 }, { x: 820, y: 450 },
      { x: 250, y: 550 }, { x: 650, y: 350 },
    ],
    bombSpawnZones: [
      { x: 220, y: 220, w: 460, h: 60 },
      { x: 220, y: 620, w: 460, h: 60 },
      { x: 220, y: 220, w: 60, h: 460 },
      { x: 620, y: 220, w: 60, h: 460 },
    ],
  },

  arena2: {
    name: "Arena 2",
    obstacles: [
      { x: 0, y: 0, w: WORLD_SIZE, h: 20, type: "wall" },
      { x: 0, y: WORLD_SIZE - 20, w: WORLD_SIZE, h: 20, type: "wall" },
      { x: 0, y: 0, w: 20, h: WORLD_SIZE, type: "wall" },
      { x: WORLD_SIZE - 20, y: 0, w: 20, h: WORLD_SIZE, type: "wall" },

      { x: 100, y: 400, w: 200, h: 30, type: "building" },
      { x: 600, y: 400, w: 200, h: 30, type: "building" },
      { x: 400, y: 100, w: 30, h: 200, type: "building" },
      { x: 400, y: 600, w: 30, h: 200, type: "building" },
      { x: 435, y: 435, w: 30, h: 30, type: "rock" },
    ],
    spawnPoints: [
      { x: 60, y: 60 }, { x: 840, y: 60 }, { x: 60, y: 840 }, { x: 840, y: 840 },
      { x: 450, y: 60 }, { x: 450, y: 840 }, { x: 60, y: 450 }, { x: 840, y: 450 },
      { x: 200, y: 200 }, { x: 700, y: 700 },
    ],
    bombSpawnZones: [
      { x: 60, y: 60, w: 780, h: 300 },
      { x: 60, y: 540, w: 780, h: 300 },
    ],
  },

  arena3: {
    name: "Arena 3",
    obstacles: [
      { x: 0, y: 0, w: WORLD_SIZE, h: 20, type: "wall" },
      { x: 0, y: WORLD_SIZE - 20, w: WORLD_SIZE, h: 20, type: "wall" },
      { x: 0, y: 0, w: 20, h: WORLD_SIZE, type: "wall" },
      { x: WORLD_SIZE - 20, y: 0, w: 20, h: WORLD_SIZE, type: "wall" },

      { x: 250, y: 250, w: 50, h: 50, type: "rock" },
      { x: 600, y: 250, w: 50, h: 50, type: "rock" },
      { x: 250, y: 600, w: 50, h: 50, type: "rock" },
      { x: 600, y: 600, w: 50, h: 50, type: "rock" },
      { x: 425, y: 425, w: 50, h: 50, type: "box" },
      { x: 150, y: 425, w: 40, h: 40, type: "tree" },
      { x: 710, y: 425, w: 40, h: 40, type: "tree" },
    ],
    spawnPoints: [
      { x: 70, y: 70 }, { x: 830, y: 70 }, { x: 70, y: 830 }, { x: 830, y: 830 },
      { x: 450, y: 70 }, { x: 450, y: 830 }, { x: 70, y: 450 }, { x: 830, y: 450 },
      { x: 330, y: 150 }, { x: 570, y: 750 },
    ],
    bombSpawnZones: [
      { x: 60, y: 350, w: 780, h: 200 },
    ],
  },
};

function getArena(mapKey) {
  return ARENAS[mapKey] || ARENAS.arena1;
}

/**
 * Circle (player) vs axis-aligned rectangle (obstacle) collision.
 */
function circleRectCollides(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (radius * radius);
}

function collidesWithAnyObstacle(x, y, radius, obstacles) {
  for (const rect of obstacles) {
    if (circleRectCollides(x, y, radius, rect)) return true;
  }
  return false;
}

/**
 * Attempts to move from (x,y) toward (nextX,nextY), sliding
 * along walls instead of just stopping dead. Returns the
 * resolved {x, y}.
 */
function resolveMovement(x, y, nextX, nextY, radius, obstacles) {
  let resultX = x;
  let resultY = y;

  // Try X movement alone
  if (!collidesWithAnyObstacle(nextX, y, radius, obstacles)) {
    resultX = nextX;
  }
  // Try Y movement alone
  if (!collidesWithAnyObstacle(resultX, nextY, radius, obstacles)) {
    resultY = nextY;
  }

  // Clamp to world bounds
  resultX = Math.max(radius, Math.min(WORLD_SIZE - radius, resultX));
  resultY = Math.max(radius, Math.min(WORLD_SIZE - radius, resultY));

  return { x: resultX, y: resultY };
}

/**
 * Find a random point inside one of the arena's designated
 * bomb-spawn zones that isn't on top of an obstacle or too
 * close to any current player position.
 */
function findSafeBombSpawn(mapKey, playerPositions, minDistanceFromPlayers = 70) {
  const arena = getArena(mapKey);
  for (let attempt = 0; attempt < 30; attempt++) {
    const zone = arena.bombSpawnZones[Math.floor(Math.random() * arena.bombSpawnZones.length)];
    const x = zone.x + Math.random() * zone.w;
    const y = zone.y + Math.random() * zone.h;

    if (collidesWithAnyObstacle(x, y, 14, arena.obstacles)) continue;

    const tooClose = playerPositions.some((p) => {
      const dx = p.x - x, dy = p.y - y;
      return Math.sqrt(dx * dx + dy * dy) < minDistanceFromPlayers;
    });
    if (tooClose) continue;

    return { x, y };
  }
  // fallback: center of first zone
  const zone = arena.bombSpawnZones[0];
  return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
}
/**
 * Calculate how far a bomb can travel in the direction
 * the player is facing.
 *
 * The bomb can travel up to maxDistance, but stops before
 * hitting an obstacle.
 */
function computeThrowTarget(
  fromX,
  fromY,
  facing,
  obstacles,
  maxDistance = 500
) {

  let directionX = 0;
  let directionY = 0;


  // -------------------------------------------------------
  // Facing stored as a string
  // -------------------------------------------------------

  if (
    typeof facing === "string"
  ) {

    const direction =
      facing.toLowerCase();


    if (
      direction === "left"
    ) {

      directionX = -1;
      directionY = 0;

    }
    else if (
      direction === "right"
    ) {

      directionX = 1;
      directionY = 0;

    }
    else if (
      direction === "up"
    ) {

      directionX = 0;
      directionY = -1;

    }
    else if (
      direction === "down"
    ) {

      directionX = 0;
      directionY = 1;

    }

  }


  // -------------------------------------------------------
  // Facing stored as an object
  // -------------------------------------------------------

  if (
    typeof facing === "object" &&
    facing !== null
  ) {

    directionX =
      Number(facing.x) || 0;

    directionY =
      Number(facing.y) || 0;

  }


  // -------------------------------------------------------
  // No valid direction
  // -------------------------------------------------------

  if (
    directionX === 0 &&
    directionY === 0
  ) {

    return {
      x: fromX,
      y: fromY,
      distance: 0
    };

  }


  // -------------------------------------------------------
  // Normalize direction
  // -------------------------------------------------------

  const length =
    Math.hypot(
      directionX,
      directionY
    );


  directionX /=
    length;

  directionY /=
    length;


  // -------------------------------------------------------
  // Step through the throw path.
  //
  // Smaller steps make sure the bomb does not pass
  // through a wall or obstacle.
  // -------------------------------------------------------

  const STEP = 5;

  let lastSafeX =
    fromX;

  let lastSafeY =
    fromY;

  let travelled =
    0;


  while (
    travelled <
    maxDistance
  ) {

    travelled =
      Math.min(
        travelled + STEP,
        maxDistance
      );


    const testX =
      fromX +
      directionX *
      travelled;


    const testY =
      fromY +
      directionY *
      travelled;


    // -----------------------------------------------------
    // Keep bomb inside arena
    // -----------------------------------------------------

    if (
      testX < 14 ||
      testX >
        WORLD_SIZE - 14 ||
      testY < 14 ||
      testY >
        WORLD_SIZE - 14
    ) {

      break;

    }


    // -----------------------------------------------------
    // Check obstacle collision
    //
    // Bomb radius = 10
    // -----------------------------------------------------

    if (
      collidesWithAnyObstacle(
        testX,
        testY,
        10,
        obstacles
      )
    ) {

      break;

    }


    lastSafeX =
      testX;

    lastSafeY =
      testY;

  }


  return {

    x:
      lastSafeX,

    y:
      lastSafeY,

    distance:
      Math.hypot(
        lastSafeX -
          fromX,

        lastSafeY -
          fromY
      )

  };
}
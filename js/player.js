/**
 * js/player.js
 * ---------------------------------------------------------
 * Player game-entity: position, facing, simple walk/idle
 * animation, and canvas rendering — reusing the SAME
 * renderCharacterSVG() from character.js so the character
 * looks identical to the lobby/profile preview.
 * ---------------------------------------------------------
 */

// Cache of pre-rendered character images, keyed by a signature
// of their customization, so we don't re-rasterize SVG every frame.
const _characterImageCache = {};

function characterSignature(character) {
  return [character.body, character.body_color, character.hair, character.hair_color,
          character.shirt, character.shirt_color, character.pants, character.pants_color,
          character.shoes, character.shoes_color, character.accessory].join("|");
}

function getCharacterImage(character) {
  const key = characterSignature(character);
  if (_characterImageCache[key]) return _characterImageCache[key];

  const svg = renderCharacterSVG(character);
  const img = new Image();
  img.loaded = false;
  img.onload = () => { img.loaded = true; };
  img.src = "data:image/svg+xml," + encodeURIComponent(svg);

  _characterImageCache[key] = img;
  return img;
}

const MOVE_SPEED = 220; // pixels per second

class Player {
  constructor({ userId, username, character, x, y, color, isLocal }) {
    this.userId = userId;
    this.username = username;
    this.character = character;
    this.color = color;
    this.isLocal = isLocal;

    this.x = x;
    this.y = y;

    // For remote players: where they're actually headed, per the
    // last network update. We lerp this.x/this.y toward these each
    // frame for smooth motion despite ~10Hz network updates.
    this.targetX = x;
    this.targetY = y;

    this.facing = "down"; // 'up' | 'down' | 'left' | 'right'
    this.isMoving = false;
    this.eliminated = false;
    this.hasShield = false; // used in later phase (respawn protection)

    this.image = getCharacterImage(character);
  }

  /** Local player only: apply input + collision each frame. */
  updateLocal(inputVector, dt, arena) {
    this.isMoving = Math.abs(inputVector.x) > 0.05 || Math.abs(inputVector.y) > 0.05;

    if (this.isMoving) {
      if (Math.abs(inputVector.x) > Math.abs(inputVector.y)) {
        this.facing = inputVector.x > 0 ? "right" : "left";
      } else {
        this.facing = inputVector.y > 0 ? "down" : "up";
      }

      const nextX = this.x + inputVector.x * MOVE_SPEED * dt;
      const nextY = this.y + inputVector.y * MOVE_SPEED * dt;
      const resolved = resolveMovement(this.x, this.y, nextX, nextY, PLAYER_RADIUS, arena.obstacles);
      this.x = resolved.x;
      this.y = resolved.y;
    }
  }

  /** Remote player: smoothly interpolate toward last known network position. */
  updateRemote(dt) {
    const lerpFactor = Math.min(1, dt * 10);
    this.x += (this.targetX - this.x) * lerpFactor;
    this.y += (this.targetY - this.y) * lerpFactor;
    this.isMoving = Math.hypot(this.targetX - this.x, this.targetY - this.y) > 1;
  }

  applyNetworkUpdate(payload) {
    this.targetX = payload.x;
    this.targetY = payload.y;
    this.facing = payload.facing;
  }

  draw(ctx) {
    const bobOffset = this.isMoving ? Math.sin(performance.now() / 110) * 3 : 0;
    const w = 40, h = 54;

    ctx.save();
    ctx.translate(this.x, this.y + bobOffset);

    // shadow
    ctx.beginPath();
    ctx.ellipse(0, h / 2 - 4, 16, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();

    if (this.hasShield) {
      ctx.beginPath();
      ctx.arc(0, -4, 30, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(100,200,255,0.8)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (this.facing === "left") ctx.scale(-1, 1);

    if (this.image.loaded) {
      ctx.drawImage(this.image, -w / 2, -h / 2 - 6, w, h);
    } else {
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 14, 16, 0, Math.PI * 2);
      ctx.fillStyle = this.character.body_color || "#f1c27d";
      ctx.fill();
    }

    ctx.restore();

    // Username label (drawn upright regardless of facing)
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeText(this.username, this.x, this.y - h / 2 - 14 + bobOffset);
    ctx.fillText(this.username, this.x, this.y - h / 2 - 14 + bobOffset);
  }
}

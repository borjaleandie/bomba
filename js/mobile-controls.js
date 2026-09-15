/**
 * js/mobile-controls.js
 * ---------------------------------------------------------
 * Virtual joystick (touch/mouse via Pointer Events, works on
 * both mobile and desktop) + WASD/arrow-key fallback for
 * desktop browsers. Exposes getMovementVector() returning a
 * normalized {x, y} in range [-1, 1].
 * ---------------------------------------------------------
 */

function createJoystick(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `<div class="joy-base"><div class="joy-knob"></div></div>`;
  const base = container.querySelector(".joy-base");
  const knob = container.querySelector(".joy-knob");

  const state = { x: 0, y: 0, active: false };
  let centerX = 0, centerY = 0, maxDist = 0;

  function start(e) {
    const rect = base.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    maxDist = rect.width / 2;
    state.active = true;
    base.setPointerCapture(e.pointerId);
    move(e);
  }

  function move(e) {
    if (!state.active) return;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.min(Math.hypot(dx, dy), maxDist);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * dist;
    const ky = Math.sin(angle) * dist;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    state.x = maxDist ? kx / maxDist : 0;
    state.y = maxDist ? ky / maxDist : 0;
  }

  function end() {
    state.active = false;
    state.x = 0;
    state.y = 0;
    knob.style.transform = "translate(0,0)";
  }

  base.addEventListener("pointerdown", start);
  base.addEventListener("pointermove", move);
  base.addEventListener("pointerup", end);
  base.addEventListener("pointercancel", end);

  return state;
}

// ---- Keyboard fallback (desktop) ----
const _keyState = { up: false, down: false, left: false, right: false };

function initKeyboardControls() {
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "w", "W"].includes(e.key)) _keyState.up = true;
    if (["ArrowDown", "s", "S"].includes(e.key)) _keyState.down = true;
    if (["ArrowLeft", "a", "A"].includes(e.key)) _keyState.left = true;
    if (["ArrowRight", "d", "D"].includes(e.key)) _keyState.right = true;
  });
  window.addEventListener("keyup", (e) => {
    if (["ArrowUp", "w", "W"].includes(e.key)) _keyState.up = false;
    if (["ArrowDown", "s", "S"].includes(e.key)) _keyState.down = false;
    if (["ArrowLeft", "a", "A"].includes(e.key)) _keyState.left = false;
    if (["ArrowRight", "d", "D"].includes(e.key)) _keyState.right = false;
  });
}

function getKeyboardVector() {
  let x = (_keyState.right ? 1 : 0) - (_keyState.left ? 1 : 0);
  let y = (_keyState.down ? 1 : 0) - (_keyState.up ? 1 : 0);
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

/**
 * Combined movement vector: joystick takes priority if the
 * user's finger is actively on it, otherwise fall back to
 * keyboard (useful for desktop testing/play).
 */
function getMovementVector(joystickState) {
  if (joystickState.active) return { x: joystickState.x, y: joystickState.y };
  return getKeyboardVector();
}

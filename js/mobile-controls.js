/**
 * js/mobile-controls.js
 * ---------------------------------------------------------
 * BOMB ARENA MOBILE CONTROLS
 *
 * LEFT JOYSTICK:
 *   Movement
 *
 * RIGHT JOYSTICK:
 *   Aim / throw direction
 *
 * THROW BUTTON:
 *   Throws the bomb in the current aim direction
 *
 * DESKTOP:
 *   WASD / Arrow keys = movement
 *   Mouse / keyboard can still be used by game.js
 * ---------------------------------------------------------
 */


/* =========================================================
   JOYSTICK CREATOR
   ========================================================= */

function createJoystick(containerId) {
    const container = document.getElementById(containerId);

    if (!container) {
        console.warn("Joystick container not found:", containerId);

        return {
            x: 0,
            y: 0,
            active: false
        };
    }

    container.innerHTML = `
        <div class="joy-base">
            <div class="joy-knob"></div>
        </div>
    `;

    const base = container.querySelector(".joy-base");
    const knob = container.querySelector(".joy-knob");

    const state = {
        x: 0,
        y: 0,
        active: false
    };

    let centerX = 0;
    let centerY = 0;
    let maxDist = 0;

    function start(e) {
        e.preventDefault();

        const rect = base.getBoundingClientRect();

        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;

        maxDist = rect.width / 2;

        state.active = true;

        try {
            base.setPointerCapture(e.pointerId);
        } catch (_) {}

        move(e);
    }

    function move(e) {
        if (!state.active) return;

        e.preventDefault();

        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;

        const distance = Math.min(
            Math.hypot(dx, dy),
            maxDist
        );

        if (distance === 0) {
            state.x = 0;
            state.y = 0;

            knob.style.transform = "translate(0px, 0px)";
            return;
        }

        const angle = Math.atan2(dy, dx);

        const kx = Math.cos(angle) * distance;
        const ky = Math.sin(angle) * distance;

        knob.style.transform =
            `translate(${kx}px, ${ky}px)`;

        state.x = maxDist ? kx / maxDist : 0;
        state.y = maxDist ? ky / maxDist : 0;
    }

    function end(e) {
        if (e) {
            try {
                base.releasePointerCapture(e.pointerId);
            } catch (_) {}
        }

        state.active = false;
        state.x = 0;
        state.y = 0;

        knob.style.transform = "translate(0px, 0px)";
    }

    base.addEventListener("pointerdown", start);
    base.addEventListener("pointermove", move);
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
    base.addEventListener("pointerleave", (e) => {
        /*
         * Do NOT end here.
         *
         * On mobile the finger can move outside the joystick
         * while pointer capture is active.
         */
    });

    return state;
}


/* =========================================================
   AIM JOYSTICK
   ========================================================= */

function createAimJoystick(containerId) {

    const container = document.getElementById(containerId);

    if (!container) {
        console.warn("Aim joystick container not found:", containerId);

        return {
            x: 1,
            y: 0,
            active: false
        };
    }

    container.innerHTML = `
        <div class="aim-base">

            <div class="aim-direction">
                ➤
            </div>

            <div class="aim-knob"></div>

        </div>
    `;

    const base = container.querySelector(".aim-base");
    const knob = container.querySelector(".aim-knob");

    const state = {
        x: 1,
        y: 0,
        active: false
    };

    let centerX = 0;
    let centerY = 0;
    let maxDist = 0;

    function start(e) {

        e.preventDefault();

        const rect = base.getBoundingClientRect();

        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;

        maxDist = rect.width / 2;

        state.active = true;

        try {
            base.setPointerCapture(e.pointerId);
        } catch (_) {}

        move(e);
    }

    function move(e) {

        if (!state.active) return;

        e.preventDefault();

        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;

        const distance = Math.min(
            Math.hypot(dx, dy),
            maxDist
        );

        /*
         * Ignore tiny accidental movements.
         */
        if (distance < 8) {
            return;
        }

        const angle = Math.atan2(dy, dx);

        const kx = Math.cos(angle) * distance;
        const ky = Math.sin(angle) * distance;

        /*
         * Normalized aim direction.
         */
        state.x = Math.cos(angle);
        state.y = Math.sin(angle);

        /*
         * Move joystick knob.
         */
        knob.style.transform =
            `translate(${kx}px, ${ky}px)`;

        /*
         * Rotate visible aim arrow.
         */
        const degrees = angle * 180 / Math.PI;

        const direction =
            base.querySelector(".aim-direction");

        if (direction) {
            direction.style.transform =
                `translate(-50%, -50%) rotate(${degrees}deg)`;
        }
    }

    function end(e) {

        if (e) {
            try {
                base.releasePointerCapture(e.pointerId);
            } catch (_) {}
        }

        /*
         * IMPORTANT:
         * Keep the last aim direction.
         *
         * This means the player can release the aim joystick
         * and then press THROW.
         */

        state.active = false;

        /*
         * Put knob back in center.
         */
        knob.style.transform =
            "translate(0px, 0px)";
    }

    base.addEventListener("pointerdown", start);
    base.addEventListener("pointermove", move);
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);

    return state;
}


/* =========================================================
   THROW BUTTON
   ========================================================= */

function createThrowButton(buttonId, callback) {

    const button = document.getElementById(buttonId);

    if (!button) {
        console.warn("Throw button not found:", buttonId);
        return;
    }

    /*
     * Prevent browser scrolling/zooming while touching.
     */
    button.style.touchAction = "none";

    function throwBomb(e) {

        e.preventDefault();
        e.stopPropagation();

        if (typeof callback === "function") {
            callback();
        }
    }

    /*
     * Pointer events work on both:
     * - mobile
     * - desktop
     */
    button.addEventListener(
        "pointerdown",
        throwBomb
    );

    /*
     * Prevent normal click from causing double throw.
     */
    button.addEventListener(
        "click",
        (e) => {
            e.preventDefault();
        }
    );
}


/* =========================================================
   KEYBOARD CONTROLS
   ========================================================= */

const _keyState = {
    up: false,
    down: false,
    left: false,
    right: false
};


function initKeyboardControls() {

    window.addEventListener("keydown", (e) => {

        if (
            ["ArrowUp", "w", "W"].includes(e.key)
        ) {
            _keyState.up = true;
        }

        if (
            ["ArrowDown", "s", "S"].includes(e.key)
        ) {
            _keyState.down = true;
        }

        if (
            ["ArrowLeft", "a", "A"].includes(e.key)
        ) {
            _keyState.left = true;
        }

        if (
            ["ArrowRight", "d", "D"].includes(e.key)
        ) {
            _keyState.right = true;
        }
    });


    window.addEventListener("keyup", (e) => {

        if (
            ["ArrowUp", "w", "W"].includes(e.key)
        ) {
            _keyState.up = false;
        }

        if (
            ["ArrowDown", "s", "S"].includes(e.key)
        ) {
            _keyState.down = false;
        }

        if (
            ["ArrowLeft", "a", "A"].includes(e.key)
        ) {
            _keyState.left = false;
        }

        if (
            ["ArrowRight", "d", "D"].includes(e.key)
        ) {
            _keyState.right = false;
        }
    });
}


/* =========================================================
   KEYBOARD MOVEMENT VECTOR
   ========================================================= */

function getKeyboardVector() {

    let x =
        (_keyState.right ? 1 : 0) -
        (_keyState.left ? 1 : 0);

    let y =
        (_keyState.down ? 1 : 0) -
        (_keyState.up ? 1 : 0);

    const length = Math.hypot(x, y);

    if (length > 1) {
        x /= length;
        y /= length;
    }

    return {
        x,
        y
    };
}


/* =========================================================
   COMBINED MOVEMENT
   ========================================================= */

function getMovementVector(joystickState) {

    if (
        joystickState &&
        joystickState.active
    ) {
        return {
            x: joystickState.x,
            y: joystickState.y
        };
    }

    return getKeyboardVector();
}


/* =========================================================
   AIM VECTOR
   ========================================================= */

function getAimVector(aimJoystickState) {

    /*
     * If the player is currently using the aim joystick,
     * return its direction.
     */
    if (
        aimJoystickState &&
        typeof aimJoystickState.x === "number" &&
        typeof aimJoystickState.y === "number"
    ) {
        return {
            x: aimJoystickState.x,
            y: aimJoystickState.y
        };
    }

    /*
     * Default direction = right.
     */
    return {
        x: 1,
        y: 0
    };
}


/* =========================================================
   GLOBAL EXPORTS
   ========================================================= */

window.createJoystick = createJoystick;

window.createAimJoystick = createAimJoystick;

window.createThrowButton = createThrowButton;

window.initKeyboardControls = initKeyboardControls;

window.getKeyboardVector = getKeyboardVector;

window.getMovementVector = getMovementVector;

window.getAimVector = getAimVector;


console.log(
    "mobile-controls.js loaded successfully."
);
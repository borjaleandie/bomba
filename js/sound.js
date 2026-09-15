/**
 * js/sound.js
 * ---------------------------------------------------------
 * Lightweight sound effects using the Web Audio API — no
 * external audio files to download/license. Each effect is a
 * tiny synthesized tone. Preference (on/off) is stored in
 * localStorage since it's a simple per-device UI setting, not
 * game data that needs to sync across devices.
 * ---------------------------------------------------------
 */

const SOUND_PREF_KEY = "bombArena_soundEnabled";
let _audioCtx = null;

function getAudioContext() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

// Mobile browsers require a real user gesture before audio can play.
function unlockAudioOnFirstInteraction() {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();
  };
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

function isSoundEnabled() {
  return localStorage.getItem(SOUND_PREF_KEY) !== "off";
}

function setSoundEnabled(enabled) {
  localStorage.setItem(SOUND_PREF_KEY, enabled ? "on" : "off");
}

/**
 * Plays a short tone. sweepTo (optional) glides the frequency,
 * useful for "whoosh" (throw) or "boom" (explosion) style effects.
 */
function playTone({ freq, duration = 0.15, type = "sine", volume = 0.15, sweepTo = null }) {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return; // not unlocked yet, silently skip

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* ignore audio errors, never break gameplay */ }
}

function playNoiseBurst(duration = 0.3, volume = 0.2) {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;

    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    noise.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  } catch (e) { /* ignore */ }
}

const SOUND_EFFECTS = {
  pickup: () => playTone({ freq: 500, sweepTo: 800, duration: 0.12, type: "square", volume: 0.12 }),
  throw: () => playTone({ freq: 300, sweepTo: 120, duration: 0.2, type: "sawtooth", volume: 0.12 }),
  explosion: () => playNoiseBurst(0.35, 0.25),
  eliminate: () => playTone({ freq: 220, sweepTo: 60, duration: 0.4, type: "sawtooth", volume: 0.18 }),
  respawn: () => playTone({ freq: 400, sweepTo: 900, duration: 0.3, type: "sine", volume: 0.14 }),
  countdown: () => playTone({ freq: 600, duration: 0.1, type: "square", volume: 0.12 }),
  go: () => playTone({ freq: 700, sweepTo: 1100, duration: 0.25, type: "square", volume: 0.16 }),
  victory: () => {
    // simple three-note fanfare
    [523, 659, 784].forEach((freq, i) => {
      setTimeout(() => playTone({ freq, duration: 0.25, type: "triangle", volume: 0.16 }), i * 140);
    });
  },
  chat: () => playTone({ freq: 900, duration: 0.08, type: "sine", volume: 0.08 }),
};

function playSound(name) {
  const fn = SOUND_EFFECTS[name];
  if (fn) fn();
}

unlockAudioOnFirstInteraction();

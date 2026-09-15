/**
 * js/respawn.js
 * ---------------------------------------------------------
 * Respawn point selection + the on-screen respawn countdown
 * UI ("RESPAWNING... 3 2 1 GO!"), reused by game.js.
 * ---------------------------------------------------------
 */

function getRandomSafeSpawnPoint(arena) {
  const points = arena.spawnPoints;
  return points[Math.floor(Math.random() * points.length)];
}

/**
 * Drives the elimination + respawn countdown overlay.
 * @param {object} els - { overlay, title, number }
 * @param {function} onComplete - called once countdown reaches GO!
 */
function runRespawnCountdown(els, onComplete) {
  els.overlay.classList.remove("hidden");
  els.title.textContent = "💥 ELIMINATED!";
  els.number.textContent = "RESPAWNING...";

  let n = 3;
  setTimeout(() => {
    els.title.textContent = "";
    tick();
  }, 700);

  function tick() {
    els.number.textContent = n;
    const interval = setInterval(() => {
      n--;
      if (n > 0) {
        els.number.textContent = n;
      } else {
        els.number.textContent = "GO!";
        clearInterval(interval);
        setTimeout(() => {
          els.overlay.classList.add("hidden");
          onComplete();
        }, 500);
      }
    }, 1000);
  }
}

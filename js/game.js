/**
 * js/game.js
 * ---------------------------------------------------------
 * Main game loop: movement, bomb lifecycle, elimination/respawn,
 * live score tracking, and the round timer that ends the round
 * and hands off to results.html.
 * ---------------------------------------------------------
 */

let canvas, ctx;
let logicalWidth = 0, logicalHeight = 0;
let currentUser, currentProfile;
let room, arena, roundId;
let myPlayer;
let otherPlayers = {};
let gameChannel = null;
let joystickState = null;
let lastFrameTime = 0;
let lastBroadcastTime = 0;
const BROADCAST_INTERVAL_MS = 80;

let isHost = false;
let bombs = {};
let explosions = [];
let myCarriedBombId = null;
let bombSpawnTimer = null;

let roundEndsAtMs = 0;
let roundEnded = false;
let timerDisplayInterval = null;
let chatChannel = null;
let chatMounted = false;

const myScore = { kills: 0, deaths: 0, bombsPickedUp: 0, bombsThrown: 0, hits: 0 };

async function initGame() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const { data: profile } = await window.supabaseClient
    .from("profiles").select("username").eq("id", currentUser.id).single();
  currentProfile = profile;

  const params = new URLSearchParams(window.location.search);
  const code = (params.get("code") || "").toUpperCase();
  if (!code) { window.location.href = "index.html"; return; }

  room = await getRoomByCode(code);
  if (!room) { window.location.href = "index.html"; return; }
  if (!room.current_round_id) { alert("This room has no active round."); window.location.href = "index.html"; return; }

  roundId = room.current_round_id;
  arena = getArena(room.map);
  isHost = room.host_id === currentUser.id;

  roundEndsAtMs = new Date(room.started_at).getTime() + room.round_duration_seconds * 1000;

  document.getElementById("roomCodeLabel").textContent = room.room_code;
  document.getElementById("mapLabel").textContent = arena.name;

  await ensurePlayerScoreRow(roundId, currentUser.id);

  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  joystickState = createJoystick("joystickZone");
  initKeyboardControls();

  await setupPlayers();
  setupChannel();
  setupActionButtons();
  setupChatToggle();
  startTimerDisplay();

  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  logicalWidth = window.innerWidth;
  logicalHeight = window.innerHeight;
  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  canvas.style.width = logicalWidth + "px";
  canvas.style.height = logicalHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel coordinates from here on
}

async function setupPlayers() {
  const players = await fetchRoomPlayers(room.id);
  players.forEach((p, index) => {
    const spawn = arena.spawnPoints[index % arena.spawnPoints.length];
    const playerObj = new Player({
      userId: p.user_id,
      username: p.username,
      character: p.character || { body: "body_1", body_color: "#f1c27d", hair: "bald", hair_color: "#000", shirt: "shirt_1", shirt_color: "#3498db", pants: "pants_1", pants_color: "#2c3e50", shoes: "shoes_1", shoes_color: "#111", accessory: "none" },
      x: spawn.x, y: spawn.y, color: p.color,
      isLocal: p.user_id === currentUser.id,
    });
    if (p.user_id === currentUser.id) myPlayer = playerObj;
    else otherPlayers[p.user_id] = playerObj;
  });
}

// =========================================================
// REALTIME CHANNEL
// =========================================================
function setupChannel() {
  gameChannel = window.supabaseClient.channel(`game:${room.id}`, {
    config: { presence: { key: currentUser.id } },
  });

  gameChannel
    .on("broadcast", { event: "move" }, ({ payload }) => {
      if (payload.userId === currentUser.id) return;
      const p = otherPlayers[payload.userId];
      if (p) { p.applyNetworkUpdate(payload); p.hasShield = payload.hasShield; }
    })
    .on("broadcast", { event: "bomb_spawn" }, ({ payload }) => applyBombSpawn(payload))
    .on("broadcast", { event: "bomb_state" }, ({ payload }) => applyBombState(payload))
    .on("broadcast", { event: "bomb_remove" }, ({ payload }) => { delete bombs[payload.bombId]; })
    .on("broadcast", { event: "player_eliminated" }, ({ payload }) => handleEliminationBroadcast(payload))
    .on("broadcast", { event: "player_respawn" }, ({ payload }) => handleRespawnBroadcast(payload))
    .on("broadcast", { event: "bomb_pickup_request" }, ({ payload }) => { if (isHost) hostHandlePickupRequest(payload); })
    .on("broadcast", { event: "bomb_throw_request" }, ({ payload }) => { if (isHost) hostHandleThrowRequest(payload); })
    .subscribe(async (status) => {
      updateConnectionBanner(status);
      if (status === "SUBSCRIBED") {
        await gameChannel.track({ user_id: currentUser.id });
        broadcastPosition(true);
        if (isHost && !roundEnded) startBombSpawnLoop();
      }
    });
}

function broadcastPosition(force) {
  const now = performance.now();
  if (!force && now - lastBroadcastTime < BROADCAST_INTERVAL_MS) return;
  lastBroadcastTime = now;

  gameChannel.send({
    type: "broadcast",
    event: "move",
    payload: {
      userId: currentUser.id, x: myPlayer.x, y: myPlayer.y,
      facing: myPlayer.facing, isMoving: myPlayer.isMoving, hasShield: myPlayer.hasShield,
    },
  });
}

// =========================================================
// BOMB LIFECYCLE (host-authoritative)
// =========================================================
function startBombSpawnLoop() {
  bombSpawnTimer = setInterval(() => {
    if (roundEnded) return;
    if (Object.keys(bombs).length >= MAX_CONCURRENT_BOMBS) return;

    const playerPositions = [myPlayer, ...Object.values(otherPlayers)].map((p) => ({ x: p.x, y: p.y }));
    const spot = findSafeBombSpawn(room.map, playerPositions);
    const bomb = { id: generateBombId(), x: spot.x, y: spot.y, state: "idle" };

    applyBombSpawn(bomb);
    gameChannel.send({ type: "broadcast", event: "bomb_spawn", payload: bomb });
  }, BOMB_SPAWN_INTERVAL_MS);
}

function applyBombSpawn(bomb) { bombs[bomb.id] = { ...bomb }; }

function applyBombState(payload) {
  const bomb = bombs[payload.bombId];
  if (!bomb) return;
  Object.assign(bomb, payload.changes);
  if (payload.changes.state === "exploding") {
    explosions.push({ x: bomb.x, y: bomb.y, startTime: performance.now() });
    playSound("explosion");
  }
}

function requestPickup(bombId) {
  if (roundEnded) return;
  playSound("pickup");
  myScore.bombsPickedUp++;
  pushMyScore(roundId, currentUser.id, myScore);

  const payload = { bombId, userId: currentUser.id };
  if (isHost) hostHandlePickupRequest(payload);
  else gameChannel.send({ type: "broadcast", event: "bomb_pickup_request", payload });
}

function requestThrow(bombId) {
  if (roundEnded) return;
  playSound("throw");
  myScore.bombsThrown++;
  pushMyScore(roundId, currentUser.id, myScore);

  const payload = { bombId, userId: currentUser.id, facing: myPlayer.facing, fromX: myPlayer.x, fromY: myPlayer.y };
  if (isHost) hostHandleThrowRequest(payload);
  else gameChannel.send({ type: "broadcast", event: "bomb_throw_request", payload });
}

function hostHandlePickupRequest({ bombId, userId }) {
  const bomb = bombs[bombId];
  if (!bomb || bomb.state !== "idle") return;
  const changes = { state: "carried", carriedBy: userId };
  applyBombState({ bombId, changes });
  gameChannel.send({ type: "broadcast", event: "bomb_state", payload: { bombId, changes } });
  if (userId === currentUser.id) myCarriedBombId = bombId;
}

function hostHandleThrowRequest({ bombId, userId, facing, fromX, fromY }) {
  const bomb = bombs[bombId];
  if (!bomb || bomb.state !== "carried" || bomb.carriedBy !== userId) return;

  const target = computeThrowTarget(fromX, fromY, facing, arena.obstacles);
  const travelMs = (target.distance / THROW_SPEED_PX_PER_SEC) * 1000;
  const changes = { state: "thrown", thrownBy: userId, x: fromX, y: fromY, targetX: target.x, targetY: target.y, startTime: performance.now(), travelMs };

  applyBombState({ bombId, changes });
  gameChannel.send({ type: "broadcast", event: "bomb_state", payload: { bombId, changes } });
  if (userId === currentUser.id) myCarriedBombId = null;

  setTimeout(() => hostResolveExplosion(bombId), travelMs);
}

function hostResolveExplosion(bombId) {
  const bomb = bombs[bombId];
  if (!bomb || bomb.state !== "thrown") return;

  const explodeChanges = { state: "exploding", x: bomb.targetX, y: bomb.targetY };
  applyBombState({ bombId, changes: explodeChanges });
  gameChannel.send({ type: "broadcast", event: "bomb_state", payload: { bombId, changes: explodeChanges } });

  if (!roundEnded) {
    const allPlayers = { [currentUser.id]: myPlayer, ...otherPlayers };
    Object.entries(allPlayers).forEach(([userId, p]) => {
      if (p.eliminated || p.hasShield) return;
      const dist = Math.hypot(p.x - bomb.targetX, p.y - bomb.targetY);
      if (dist <= EXPLOSION_RADIUS_PX) {
        const elimPayload = { targetUserId: userId, attackerUserId: bomb.thrownBy };
        handleEliminationBroadcast(elimPayload);
        gameChannel.send({ type: "broadcast", event: "player_eliminated", payload: elimPayload });
      }
    });
  }

  setTimeout(() => {
    delete bombs[bombId];
    gameChannel.send({ type: "broadcast", event: "bomb_remove", payload: { bombId } });
  }, 550);
}

// =========================================================
// ELIMINATION + RESPAWN + SCORING
// =========================================================
function handleEliminationBroadcast({ targetUserId, attackerUserId }) {
  // Credit the attacker's kill (runs on every client, but only
  // the matching one's `currentUser.id` check actually applies it)
  if (attackerUserId === currentUser.id && attackerUserId !== targetUserId) {
    myScore.kills++;
    myScore.hits++;
    pushMyScore(roundId, currentUser.id, myScore);
  }

  if (targetUserId === currentUser.id) {
    if (myPlayer.eliminated) return;
    myPlayer.eliminated = true;
    myPlayer.hasShield = false;
    myCarriedBombId = null;
    playSound("eliminate");

    myScore.deaths++;
    pushMyScore(roundId, currentUser.id, myScore);

    if (!roundEnded) {
      runRespawnCountdown(
        { overlay: document.getElementById("eliminationOverlay"), title: document.getElementById("elimTitle"), number: document.getElementById("elimNumber") },
        () => respawnLocalPlayer()
      );
    }
  } else {
    const p = otherPlayers[targetUserId];
    if (p) p.eliminated = true;
  }
}

function respawnLocalPlayer() {
  if (roundEnded) return;
  playSound("respawn");
  const spawn = getRandomSafeSpawnPoint(arena);
  myPlayer.x = spawn.x; myPlayer.y = spawn.y;
  myPlayer.eliminated = false;
  myPlayer.hasShield = true;

  broadcastPosition(true);
  gameChannel.send({ type: "broadcast", event: "player_respawn", payload: { userId: currentUser.id, x: spawn.x, y: spawn.y } });

  setTimeout(() => { myPlayer.hasShield = false; }, SHIELD_DURATION_MS);
}

function handleRespawnBroadcast({ userId, x, y }) {
  const p = otherPlayers[userId];
  if (!p) return;
  p.eliminated = false; p.hasShield = true;
  p.x = p.targetX = x; p.y = p.targetY = y;
  setTimeout(() => { p.hasShield = false; }, SHIELD_DURATION_MS);
}

// =========================================================
// ACTION BUTTONS
// =========================================================
function setupActionButtons() {
  const pickupBtn = document.getElementById("pickupBtn");
  const throwBtn = document.getElementById("throwBtn");

  pickupBtn.addEventListener("click", () => {
    const nearest = findNearestIdleBomb();
    if (nearest) requestPickup(nearest.id);
  });
  throwBtn.addEventListener("click", () => {
    if (myCarriedBombId) requestThrow(myCarriedBombId);
  });
}

function findNearestIdleBomb() {
  if (myCarriedBombId || myPlayer.eliminated || roundEnded) return null;
  let nearest = null, nearestDist = Infinity;
  Object.values(bombs).forEach((b) => {
    if (b.state !== "idle") return;
    const dist = Math.hypot(b.x - myPlayer.x, b.y - myPlayer.y);
    if (dist < PICKUP_RADIUS_PX && dist < nearestDist) { nearest = b; nearestDist = dist; }
  });
  return nearest;
}

function updateActionButtonsUI() {
  const pickupBtn = document.getElementById("pickupBtn");
  const throwBtn = document.getElementById("throwBtn");
  const bombReadyHud = document.getElementById("bombReadyHud");

  pickupBtn.style.opacity = findNearestIdleBomb() ? "1" : "0.4";
  const canThrow = !!myCarriedBombId && !roundEnded;
  throwBtn.style.opacity = canThrow ? "1" : "0.4";
  bombReadyHud.classList.toggle("hidden", !canThrow);
}

// =========================================================
// CHAT OVERLAY (mounted lazily, doesn't pause the game loop)
// =========================================================
function setupChatToggle() {
  const toggleBtn = document.getElementById("chatToggleBtn");
  const panel = document.getElementById("chatOverlayPanel");

  toggleBtn.addEventListener("click", () => {
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    if (opening && !chatMounted) {
      chatMounted = true;
      chatChannel = mountChatPanel(panel, {
        roomId: room.id, userId: currentUser.id, username: currentProfile.username,
      });
    }
  });
}

// =========================================================
// ROUND TIMER + END OF ROUND
// =========================================================
function startTimerDisplay() {
  timerDisplayInterval = setInterval(() => {
    const remainingMs = Math.max(0, roundEndsAtMs - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    document.getElementById("timerLabel").textContent = `${mm}:${ss}`;

    if (remainingMs <= 0 && !roundEnded) {
      onRoundEnd();
    }
  }, 250);
}

async function onRoundEnd() {
  if (roundEnded) return;
  roundEnded = true;

  if (bombSpawnTimer) clearInterval(bombSpawnTimer);
  document.getElementById("pickupBtn").disabled = true;
  document.getElementById("throwBtn").disabled = true;
  document.getElementById("roundEndOverlay").classList.remove("hidden");

  if (isHost) {
    await finalizeRoundAsHost(room.id, roundId);
  }
  await waitForRoundResultsAndRedirect(roundId);
}

// =========================================================
// MAIN LOOP
// =========================================================
function loop(timestamp) {
  const dt = lastFrameTime ? Math.min(0.05, (timestamp - lastFrameTime) / 1000) : 0;
  lastFrameTime = timestamp;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  if (!myPlayer.eliminated && !roundEnded) {
    const input = getMovementVector(joystickState);
    myPlayer.updateLocal(input, dt, arena);
  }
  broadcastPosition(false);

  Object.values(otherPlayers).forEach((p) => p.updateRemote(dt));

  Object.values(bombs).forEach((b) => {
    if (b.state === "thrown") {
      const elapsed = performance.now() - b.startTime;
      const t = Math.min(1, elapsed / b.travelMs);
      b.renderX = b.x + (b.targetX - b.x) * t;
      b.renderY = b.y + (b.targetY - b.y) * t;
    }
  });

  updateActionButtonsUI();
}

function render() {
  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  const scale = Math.min(logicalWidth / WORLD_SIZE, logicalHeight / WORLD_SIZE);
  const offsetX = (logicalWidth - WORLD_SIZE * scale) / 2;
  const offsetY = (logicalHeight - WORLD_SIZE * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#1c2e1c";
  ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
  drawGroundGrid();
  drawObstacles();

  Object.values(bombs).forEach((b) => {
    if (b.state === "idle") drawBomb(ctx, b);
    if (b.state === "thrown") drawBomb(ctx, { x: b.renderX ?? b.x, y: b.renderY ?? b.y });
  });

  const all = [myPlayer, ...Object.values(otherPlayers)].filter((p) => !p.eliminated).sort((a, b) => a.y - b.y);
  all.forEach((p) => p.draw(ctx));

  Object.values(bombs).forEach((b) => {
    if (b.state !== "carried") return;
    const carrier = b.carriedBy === currentUser.id ? myPlayer : otherPlayers[b.carriedBy];
    if (carrier) drawBomb(ctx, { x: carrier.x + 20, y: carrier.y - 30 });
  });

  const now = performance.now();
  explosions = explosions.filter((e) => now - e.startTime < 500);
  explosions.forEach((e) => drawExplosion(ctx, e, now - e.startTime));

  ctx.restore();
}

function drawGroundGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_SIZE; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_SIZE); ctx.stroke(); }
  for (let y = 0; y <= WORLD_SIZE; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_SIZE, y); ctx.stroke(); }
}

const OBSTACLE_COLORS = { wall: "#555b6e", box: "#8a5a2f", rock: "#6b6f76", tree: "#2f8f4e", building: "#4a4e63" };

function drawObstacles() {
  arena.obstacles.forEach((o) => {
    ctx.fillStyle = OBSTACLE_COLORS[o.type] || "#666";
    if (o.type === "rock" || o.type === "tree") {
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    }
  });
}

window.addEventListener("beforeunload", () => {
  if (bombSpawnTimer) clearInterval(bombSpawnTimer);
  if (timerDisplayInterval) clearInterval(timerDisplayInterval);
  if (gameChannel) window.supabaseClient.removeChannel(gameChannel);
  if (chatChannel) window.supabaseClient.removeChannel(chatChannel);
});

initGame();

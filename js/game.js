/**
 * js/game.js
 * ---------------------------------------------------------
 * Main game loop:
 * - Loads the active room/round
 * - Player movement
 * - Bomb lifecycle
 * - Elimination / respawn
 * - Live score tracking
 * - Round timer
 * - Results handoff
 * ---------------------------------------------------------
 */

let canvas, ctx;
let logicalWidth = 0, logicalHeight = 0;

let currentUser = null;
let currentProfile = null;

let room = null;
let arena = null;
let roundId = null;

let myPlayer = null;
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

const myScore = {
  kills: 0,
  deaths: 0,
  bombsPickedUp: 0,
  bombsThrown: 0,
  hits: 0
};


// =========================================================
// GAME INITIALIZATION
// =========================================================

async function initGame() {

  try {

    console.log("=================================");
    console.log("BOMB ARENA - INITIALIZING GAME");
    console.log("=================================");


    // -----------------------------------------------------
    // Authentication
    // -----------------------------------------------------

    currentUser = await requireAuth();

    if (!currentUser) {
      console.error("No authenticated user.");
      return;
    }

    console.log(
      "Logged in user:",
      currentUser.id
    );


    // -----------------------------------------------------
    // Load profile
    // -----------------------------------------------------

    const {
      data: profiles,
      error: profileError
    } = await window.supabaseClient
      .from("profiles")
      .select("username")
      .eq("id", currentUser.id)
      .limit(1);

    if (profileError) {

      console.error(
        "Profile loading error:",
        profileError
      );

      throw profileError;
    }

    currentProfile =
      profiles?.[0] || {
        username: "Player"
      };


    // -----------------------------------------------------
    // Get room code from URL
    // -----------------------------------------------------

    const params =
      new URLSearchParams(
        window.location.search
      );

    const code =
      (params.get("code") || "")
        .trim()
        .toUpperCase();

    if (!code) {

      console.error(
        "No room code in URL."
      );

      alert(
        "No game room was specified."
      );

      window.location.href =
        "index.html";

      return;
    }

    console.log(
      "Room code:",
      code
    );


    // -----------------------------------------------------
    // Load room
    // -----------------------------------------------------

    room =
      await getRoomByCode(code);

    if (!room) {

      console.error(
        "Room not found:",
        code
      );

      alert(
        "Game room not found."
      );

      window.location.href =
        "index.html";

      return;
    }

    console.log(
      "Loaded room:",
      room
    );


    // -----------------------------------------------------
    // Verify room is playing
    // -----------------------------------------------------

    if (
      room.status !== "playing"
    ) {

      console.warn(
        "Room is not playing. Current status:",
        room.status
      );

      alert(
        `This room is not currently playing. Status: ${room.status}`
      );

      window.location.href =
        "lobby.html?code=" +
        encodeURIComponent(
          room.room_code
        );

      return;
    }


    // -----------------------------------------------------
    // VERIFY / WAIT FOR ACTIVE ROUND
    // -----------------------------------------------------
    //
    // The host creates the round when Start Game is clicked.
    //
    // If the game page loads before current_round_id has
    // appeared in the database, we wait for it instead of
    // immediately showing:
    //
    // "This room has no active round."
    //
    // IMPORTANT:
    // - Host attempts to create/repair the round ONCE.
    // - Other players simply wait.
    // - We then repeatedly reload the room from Supabase.
    // -----------------------------------------------------

    console.log(
      "Checking for active game round..."
    );


    const MAX_ROUND_WAIT_MS =
      10000;

    const ROUND_CHECK_INTERVAL_MS =
      300;


    // -----------------------------------------------------
    // Host attempt
    // -----------------------------------------------------
    //
    // Only call beginStartSequence once.
    //
    // This prevents accidentally creating multiple rounds
    // while the database update is still being detected.
    // -----------------------------------------------------

    if (
      !room.current_round_id &&
      room.host_id === currentUser.id
    ) {

      console.log(
        "Current user is host."
      );

      console.log(
        "Attempting to create/activate game round..."
      );


      try {

        const startedRoom =
          await beginStartSequence(
            room.id
          );


        if (startedRoom) {

          console.log(
            "Start sequence completed:",
            startedRoom
          );

        }


      } catch (startError) {

        console.error(
          "Could not start/repair game round:",
          startError
        );

        // -------------------------------------------------
        // Do NOT immediately redirect.
        //
        // The database may still be updating, so we give
        // the room a chance to appear with current_round_id.
        // -------------------------------------------------

      }

    }


    // -----------------------------------------------------
    // Wait for current_round_id
    // -----------------------------------------------------

    const roundWaitStartedAt =
      Date.now();


    while (
      !room.current_round_id
    ) {

      // ---------------------------------------------------
      // Reload room from Supabase
      // ---------------------------------------------------

      try {

        const refreshedRoom =
          await getRoomByCode(
            room.room_code
          );


        if (refreshedRoom) {

          room =
            refreshedRoom;


          console.log(
            "Room after reload:",
            room
          );

        }

      } catch (reloadError) {

        console.error(
          "Could not reload room:",
          reloadError
        );

      }


      // ---------------------------------------------------
      // Check if current_round_id now exists
      // ---------------------------------------------------

      if (
        room &&
        room.current_round_id
      ) {

        console.log(
          "================================="
        );

        console.log(
          "ACTIVE ROUND FOUND"
        );

        console.log(
          "Round ID:",
          room.current_round_id
        );

        console.log(
          "================================="
        );

        break;
      }


      // ---------------------------------------------------
      // Timeout
      // ---------------------------------------------------

      if (
        Date.now() -
          roundWaitStartedAt >=
        MAX_ROUND_WAIT_MS
      ) {

        console.error(
          "Timed out waiting for active round.",
          room
        );


        alert(
          "The game round could not be started. " +
          "Please return to the lobby and try again."
        );


        window.location.href =
          "lobby.html?code=" +
          encodeURIComponent(
            room.room_code
          );


        return;
      }


      // ---------------------------------------------------
      // Wait before checking again
      // ---------------------------------------------------

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            ROUND_CHECK_INTERVAL_MS
          )
      );

    }


    // -----------------------------------------------------
    // FINAL ACTIVE ROUND CHECK
    // -----------------------------------------------------

    if (
      !room.current_round_id
    ) {

      console.error(
        "No active round after waiting:",
        room
      );

      alert(
        "This room has no active round."
      );

      window.location.href =
        "lobby.html?code=" +
        encodeURIComponent(
          room.room_code
        );

      return;
    }


    // -----------------------------------------------------
    // Save active round ID
    // -----------------------------------------------------

    roundId =
      room.current_round_id;


    console.log(
      "Active round:",
      roundId
    );


    // -----------------------------------------------------
    // Get active round
    // -----------------------------------------------------

    const {
      data: rounds,
      error: roundError
    } = await window.supabaseClient
      .from("game_rounds")
      .select("*")
      .eq(
        "id",
        roundId
      )
      .limit(1);

    if (roundError) {

      console.error(
        "Round loading error:",
        roundError
      );

      throw roundError;
    }

    if (
      !rounds ||
      rounds.length === 0
    ) {

      console.error(
        "Round does not exist:",
        roundId
      );

      alert(
        "The active game round could not be found."
      );

      window.location.href =
        "index.html";

      return;
    }

    const round =
      rounds[0];

    console.log(
      "Active round data:",
      round
    );


    // -----------------------------------------------------
    // Verify round status
    // -----------------------------------------------------

    if (
      round.status !== "playing"
    ) {

      console.warn(
        "Round is not playing:",
        round.status
      );

      alert(
        `The game round is not active. Status: ${round.status}`
      );

      window.location.href =
        "lobby.html?code=" +
        encodeURIComponent(
          room.room_code
        );

      return;
    }


    // -----------------------------------------------------
    // Load arena
    // -----------------------------------------------------

    arena =
      getArena(room.map);

    if (!arena) {

      throw new Error(
        "Could not load the selected arena."
      );
    }


    // -----------------------------------------------------
    // Host check
    // -----------------------------------------------------

    isHost =
      room.host_id ===
      currentUser.id;


    console.log(
      "Is host:",
      isHost
    );


    // -----------------------------------------------------
    // Determine round start time
    // -----------------------------------------------------

    const roomStartedAt =
      room.started_at;

    const roundStartedAt =
      round.started_at ||
      roomStartedAt;

    if (!roundStartedAt) {

      throw new Error(
        "The game round has no start time."
      );
    }


    // -----------------------------------------------------
    // Round timer
    // -----------------------------------------------------

    roundEndsAtMs =
      new Date(
        roundStartedAt
      ).getTime() +
      Number(
        room.round_duration_seconds
      ) * 1000;


    // -----------------------------------------------------
    // HUD
    // -----------------------------------------------------

    document
      .getElementById(
        "roomCodeLabel"
      )
      .textContent =
      room.room_code;

    document
      .getElementById(
        "mapLabel"
      )
      .textContent =
      arena.name;


    // -----------------------------------------------------
    // Ensure score row
    // -----------------------------------------------------

    await ensurePlayerScoreRow(
      roundId,
      currentUser.id
    );


    // -----------------------------------------------------
    // Canvas
    // -----------------------------------------------------

    canvas =
      document.getElementById(
        "gameCanvas"
      );

    if (!canvas) {

      throw new Error(
        "Game canvas was not found."
      );
    }

    ctx =
      canvas.getContext("2d");

    resizeCanvas();

    window.addEventListener(
      "resize",
      resizeCanvas
    );


    // -----------------------------------------------------
    // Controls
    // -----------------------------------------------------

    joystickState =
      createJoystick(
        "joystickZone"
      );

    initKeyboardControls();


    // -----------------------------------------------------
    // Players
    // -----------------------------------------------------

    await setupPlayers();


    if (!myPlayer) {

      throw new Error(
        "Your player could not be created."
      );
    }


    // -----------------------------------------------------
    // Realtime
    // -----------------------------------------------------

    setupChannel();


    // -----------------------------------------------------
    // Buttons
    // -----------------------------------------------------

    setupActionButtons();


    // -----------------------------------------------------
    // Chat
    // -----------------------------------------------------

    setupChatToggle();


    // -----------------------------------------------------
    // Timer
    // -----------------------------------------------------

    startTimerDisplay();


    console.log(
      "================================="
    );

    console.log(
      "BOMB ARENA READY!"
    );

    console.log(
      "Round:",
      roundId
    );

    console.log(
      "Map:",
      arena.name
    );

    console.log(
      "================================="
    );


    // -----------------------------------------------------
    // Start game loop
    // -----------------------------------------------------

    requestAnimationFrame(
      loop
    );

  } catch (error) {

    console.error(
      "GAME INITIALIZATION ERROR:",
      error
    );

    alert(
      "Could not start the game:\n\n" +
      (
        error?.message ||
        "Unknown error"
      )
    );

  }
}


// =========================================================
// CANVAS
// =========================================================

function resizeCanvas() {

  const dpr =
    window.devicePixelRatio || 1;

  logicalWidth =
    window.innerWidth;

  logicalHeight =
    window.innerHeight;

  canvas.width =
    logicalWidth * dpr;

  canvas.height =
    logicalHeight * dpr;

  canvas.style.width =
    logicalWidth + "px";

  canvas.style.height =
    logicalHeight + "px";

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );
}


// =========================================================
// SETUP PLAYERS
// =========================================================

async function setupPlayers() {

  const players =
    await fetchRoomPlayers(
      room.id
    );

  if (
    !players ||
    players.length === 0
  ) {

    throw new Error(
      "No players were found in this room."
    );
  }


  players.forEach(
    (p, index) => {

      const spawn =
        arena.spawnPoints[
          index %
          arena.spawnPoints.length
        ];


      const playerObj =
        new Player({

          userId:
            p.user_id,

          username:
            p.username ||
            "Player",

          character:
            p.character ||
            {
              body: "body_1",
              body_color: "#f1c27d",
              hair: "hair_1",
              hair_color: "#2b1b0e",
              shirt: "shirt_1",
              shirt_color: "#3498db",
              pants: "pants_1",
              pants_color: "#333333",
              shoes: "shoes_1",
              shoes_color: "#222222",
              accessory: "none"
            },

          x:
            spawn.x,

          y:
            spawn.y,

          color:
            p.color,

          isLocal:
            p.user_id ===
            currentUser.id

        });


      if (
        p.user_id ===
        currentUser.id
      ) {

        myPlayer =
          playerObj;

      } else {

        otherPlayers[
          p.user_id
        ] =
          playerObj;

      }

    }
  );
}


// =========================================================
// REALTIME CHANNEL
// =========================================================

function setupChannel() {

  gameChannel =
    window.supabaseClient.channel(
      `game:${room.id}`,
      {
        config: {
          presence: {
            key:
              currentUser.id
          }
        }
      }
    );


  gameChannel

    // -----------------------------------------------------
    // Movement
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "move"
      },
      ({ payload }) => {

        if (
          payload.userId ===
          currentUser.id
        ) {
          return;
        }

        const p =
          otherPlayers[
            payload.userId
          ];

        if (p) {

          p.applyNetworkUpdate(
            payload
          );

          p.hasShield =
            payload.hasShield;

        }

      }
    )


    // -----------------------------------------------------
    // Bomb spawn
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "bomb_spawn"
      },
      ({ payload }) => {

        applyBombSpawn(
          payload
        );

      }
    )


    // -----------------------------------------------------
    // Bomb state
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "bomb_state"
      },
      ({ payload }) => {

        applyBombState(
          payload
        );

      }
    )


    // -----------------------------------------------------
    // Bomb remove
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "bomb_remove"
      },
      ({ payload }) => {

        delete bombs[
          payload.bombId
        ];

      }
    )


    // -----------------------------------------------------
    // Player eliminated
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "player_eliminated"
      },
      ({ payload }) => {

        handleEliminationBroadcast(
          payload
        );

      }
    )


    // -----------------------------------------------------
    // Player respawn
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "player_respawn"
      },
      ({ payload }) => {

        handleRespawnBroadcast(
          payload
        );

      }
    )


    // -----------------------------------------------------
    // Bomb pickup
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "bomb_pickup_request"
      },
      ({ payload }) => {

        if (isHost) {

          hostHandlePickupRequest(
            payload
          );

        }

      }
    )


    // -----------------------------------------------------
    // Bomb throw
    // -----------------------------------------------------

    .on(
      "broadcast",
      {
        event: "bomb_throw_request"
      },
      ({ payload }) => {

        if (isHost) {

          hostHandleThrowRequest(
            payload
          );

        }

      }
    )


    // -----------------------------------------------------
    // Subscribe
    // -----------------------------------------------------

    .subscribe(
      async (status) => {

        console.log(
          "Game realtime status:",
          status
        );

        updateConnectionBanner(
          status
        );


        if (
          status ===
          "SUBSCRIBED"
        ) {

          await gameChannel.track({
            user_id:
              currentUser.id
          });


          broadcastPosition(
            true
          );


          if (
            isHost &&
            !roundEnded
          ) {

            startBombSpawnLoop();

          }

        }

      }
    );
}


// =========================================================
// POSITION BROADCAST
// =========================================================

function broadcastPosition(
  force = false
) {

  if (
    !gameChannel ||
    !myPlayer
  ) {
    return;
  }

  const now =
    performance.now();

  if (
    !force &&
    now -
      lastBroadcastTime <
    BROADCAST_INTERVAL_MS
  ) {
    return;
  }

  lastBroadcastTime =
    now;


  gameChannel.send({

    type:
      "broadcast",

    event:
      "move",

    payload: {

      userId:
        currentUser.id,

      x:
        myPlayer.x,

      y:
        myPlayer.y,

      facing:
        myPlayer.facing,

      isMoving:
        myPlayer.isMoving,

      hasShield:
        myPlayer.hasShield

    }

  });
}


// =========================================================
// BOMB LIFECYCLE
// =========================================================

function startBombSpawnLoop() {

  if (bombSpawnTimer) {
    clearInterval(
      bombSpawnTimer
    );
  }


  bombSpawnTimer =
    setInterval(
      () => {

        if (
          roundEnded ||
          !myPlayer
        ) {
          return;
        }

        if (
          Object.keys(
            bombs
          ).length >=
          MAX_CONCURRENT_BOMBS
        ) {
          return;
        }


        const playerPositions =
          [
            myPlayer,
            ...Object.values(
              otherPlayers
            )
          ]
            .filter(Boolean)
            .map(
              p => ({
                x: p.x,
                y: p.y
              })
            );


        const spot =
          findSafeBombSpawn(
            room.map,
            playerPositions
          );


        const bomb = {

          id:
            generateBombId(),

          x:
            spot.x,

          y:
            spot.y,

          state:
            "idle"

        };


        applyBombSpawn(
          bomb
        );


        gameChannel.send({

          type:
            "broadcast",

          event:
            "bomb_spawn",

          payload:
            bomb

        });

      },

      BOMB_SPAWN_INTERVAL_MS
    );
}


function applyBombSpawn(
  bomb
) {

  if (!bomb?.id) {
    return;
  }

  bombs[
    bomb.id
  ] = {
    ...bomb
  };
}


function applyBombState(
  payload
) {

  if (
    !payload?.bombId
  ) {
    return;
  }

  const bomb =
    bombs[
      payload.bombId
    ];

  if (!bomb) {
    return;
  }


  Object.assign(
    bomb,
    payload.changes
  );


  if (
    payload.changes?.state ===
    "exploding"
  ) {

    explosions.push({

      x:
        bomb.x,

      y:
        bomb.y,

      startTime:
        performance.now()

    });


    playSound(
      "explosion"
    );

  }
}


// =========================================================
// PICKUP
// =========================================================

function requestPickup(
  bombId
) {

  if (
    roundEnded ||
    !bombId
  ) {
    return;
  }


  playSound(
    "pickup"
  );


  myScore.bombsPickedUp++;


  pushMyScore(
    roundId,
    currentUser.id,
    myScore
  );


  const payload = {

    bombId,

    userId:
      currentUser.id

  };


  if (isHost) {

    hostHandlePickupRequest(
      payload
    );

  } else {

    gameChannel.send({

      type:
        "broadcast",

      event:
        "bomb_pickup_request",

      payload

    });

  }
}


// =========================================================
// THROW
// =========================================================

function requestThrow(
  bombId
) {

  if (
    roundEnded ||
    !bombId
  ) {
    return;
  }


  playSound(
    "throw"
  );


  myScore.bombsThrown++;


  pushMyScore(
    roundId,
    currentUser.id,
    myScore
  );


  const payload = {

    bombId,

    userId:
      currentUser.id,

    facing:
      myPlayer.facing,

    fromX:
      myPlayer.x,

    fromY:
      myPlayer.y

  };


  if (isHost) {

    hostHandleThrowRequest(
      payload
    );

  } else {

    gameChannel.send({

      type:
        "broadcast",

      event:
        "bomb_throw_request",

      payload

    });

  }
}


// =========================================================
// HOST PICKUP
// =========================================================

function hostHandlePickupRequest({
  bombId,
  userId
}) {

  const bomb =
    bombs[bombId];

  if (
    !bomb ||
    bomb.state !==
      "idle"
  ) {
    return;
  }


  const changes = {

    state:
      "carried",

    carriedBy:
      userId

  };


  applyBombState({

    bombId,

    changes

  });


  gameChannel.send({

    type:
      "broadcast",

    event:
      "bomb_state",

    payload: {

      bombId,

      changes

    }

  });


  if (
    userId ===
    currentUser.id
  ) {

    myCarriedBombId =
      bombId;

  }
}


// =========================================================
// HOST THROW
// =========================================================
// LONG DISTANCE THROW FIX
//
// Bomb can travel up to 500 pixels.
// If an obstacle is closer, the bomb stops safely
// before the obstacle.
// =========================================================

function hostHandleThrowRequest({
  bombId,
  userId,
  facing,
  fromX,
  fromY
}) {

  const bomb =
    bombs[bombId];


  if (
    !bomb ||
    bomb.state !==
      "carried" ||
    bomb.carriedBy !==
      userId
  ) {
    return;
  }


  // -------------------------------------------------------
  // THROW SETTINGS
  // -------------------------------------------------------

  const MAX_THROW_DISTANCE =
    500;

  const MIN_THROW_DISTANCE =
    40;


  // -------------------------------------------------------
  // Get the normal collision target first.
  //
  // This keeps the existing collision.js behavior.
  // -------------------------------------------------------

  let collisionTarget =
    computeThrowTarget(
      fromX,
      fromY,
      facing,
      arena.obstacles
    );


  if (
    !collisionTarget ||
    !Number.isFinite(
      collisionTarget.x
    ) ||
    !Number.isFinite(
      collisionTarget.y
    )
  ) {

    collisionTarget = {

      x:
        fromX,

      y:
        fromY,

      distance:
        0

    };

  }


  // -------------------------------------------------------
  // Determine direction
  // -------------------------------------------------------

  let directionX = 0;
  let directionY = 0;


  // -------------------------------------------------------
  // Facing as a string
  // -------------------------------------------------------

  if (
    typeof facing ===
    "string"
  ) {

    const direction =
      facing.toLowerCase();


    if (
      direction ===
        "left"
    ) {

      directionX =
        -1;

      directionY =
        0;

    }
    else if (
      direction ===
        "right"
    ) {

      directionX =
        1;

      directionY =
        0;

    }
    else if (
      direction ===
        "up"
    ) {

      directionX =
        0;

      directionY =
        -1;

    }
    else if (
      direction ===
        "down"
    ) {

      directionX =
        0;

      directionY =
        1;

    }

  }


  // -------------------------------------------------------
  // Facing as an object
  // Example:
  // { x: 1, y: 0 }
  // -------------------------------------------------------

  if (
    typeof facing ===
      "object" &&
    facing !== null
  ) {

    const fx =
      Number(
        facing.x
      );

    const fy =
      Number(
        facing.y
      );


    if (
      Number.isFinite(fx) &&
      Number.isFinite(fy) &&
      (
        fx !== 0 ||
        fy !== 0
      )
    ) {

      directionX =
        fx;

      directionY =
        fy;

    }

  }


  // -------------------------------------------------------
  // If facing wasn't recognized, use the direction
  // from the collision target.
  // -------------------------------------------------------

  if (
    directionX === 0 &&
    directionY === 0
  ) {

    const dx =
      collisionTarget.x -
      fromX;

    const dy =
      collisionTarget.y -
      fromY;


    const collisionDistance =
      Math.hypot(
        dx,
        dy
      );


    if (
      collisionDistance >
      0
    ) {

      directionX =
        dx /
        collisionDistance;

      directionY =
        dy /
        collisionDistance;

    }

  }


  // -------------------------------------------------------
  // Calculate target
  // -------------------------------------------------------

  let targetX =
    fromX;

  let targetY =
    fromY;


  const directionLength =
    Math.hypot(
      directionX,
      directionY
    );


  if (
    directionLength >
    0
  ) {

    directionX /=
      directionLength;

    directionY /=
      directionLength;


    // -----------------------------------------------------
    // Default target = maximum throw distance
    // -----------------------------------------------------

    targetX =
      fromX +
      directionX *
      MAX_THROW_DISTANCE;

    targetY =
      fromY +
      directionY *
      MAX_THROW_DISTANCE;


    // -----------------------------------------------------
    // If an obstacle is closer than the maximum distance,
    // stop before the obstacle.
    // -----------------------------------------------------

    if (
      Number.isFinite(
        collisionTarget.distance
      ) &&
      collisionTarget.distance >
        0 &&
      collisionTarget.distance <
        MAX_THROW_DISTANCE
    ) {

      const safeDistance =
        Math.max(
          MIN_THROW_DISTANCE,
          collisionTarget.distance -
            10
        );


      targetX =
        fromX +
        directionX *
        safeDistance;

      targetY =
        fromY +
        directionY *
        safeDistance;

    }

  }
  else {

    // -----------------------------------------------------
    // Fallback to existing collision target
    // -----------------------------------------------------

    targetX =
      collisionTarget.x;

    targetY =
      collisionTarget.y;

  }


  // -------------------------------------------------------
  // Keep target inside the game world.
  // -------------------------------------------------------

  if (
    typeof WORLD_SIZE ===
    "number"
  ) {

    targetX =
      Math.max(
        0,
        Math.min(
          WORLD_SIZE,
          targetX
        )
      );

    targetY =
      Math.max(
        0,
        Math.min(
          WORLD_SIZE,
          targetY
        )
      );

  }


  // -------------------------------------------------------
  // Calculate actual throw distance
  // -------------------------------------------------------

  const throwDistance =
    Math.hypot(
      targetX -
        fromX,

      targetY -
        fromY
    );


  // -------------------------------------------------------
  // Calculate travel time.
  // -------------------------------------------------------

  const travelMs =
    Math.max(
      100,
      (
        throwDistance /
        THROW_SPEED_PX_PER_SEC
      ) * 1000
    );


  // -------------------------------------------------------
  // Bomb state
  // -------------------------------------------------------

  const changes = {

    state:
      "thrown",

    thrownBy:
      userId,

    x:
      fromX,

    y:
      fromY,

    targetX:
      targetX,

    targetY:
      targetY,

    startTime:
      performance.now(),

    travelMs:
      travelMs

  };


  // -------------------------------------------------------
  // Apply locally
  // -------------------------------------------------------

  applyBombState({

    bombId,

    changes

  });


  // -------------------------------------------------------
  // Broadcast to all players
  // -------------------------------------------------------

  gameChannel.send({

    type:
      "broadcast",

    event:
      "bomb_state",

    payload: {

      bombId,

      changes

    }

  });


  // -------------------------------------------------------
  // Remove carried bomb from local player
  // -------------------------------------------------------

  if (
    userId ===
    currentUser.id
  ) {

    myCarriedBombId =
      null;

  }


  // -------------------------------------------------------
  // Debug
  // -------------------------------------------------------

  console.log(
    "================================="
  );

  console.log(
    "BOMB THROW"
  );

  console.log(
    "Start:",
    fromX,
    fromY
  );

  console.log(
    "Target:",
    targetX,
    targetY
  );

  console.log(
    "Distance:",
    Math.round(
      throwDistance
    ),
    "px"
  );

  console.log(
    "Travel time:",
    Math.round(
      travelMs
    ),
    "ms"
  );

  console.log(
    "================================="
  );


  // -------------------------------------------------------
  // Resolve explosion after travel
  // -------------------------------------------------------

  setTimeout(
    () =>
      hostResolveExplosion(
        bombId
      ),
    travelMs
  );
}


// =========================================================
// HOST EXPLOSION
// =========================================================

function hostResolveExplosion(
  bombId
) {

  const bomb =
    bombs[bombId];

  if (
    !bomb ||
    bomb.state !==
      "thrown"
  ) {
    return;
  }


  const explodeChanges = {

    state:
      "exploding",

    x:
      bomb.targetX,

    y:
      bomb.targetY

  };


  applyBombState({

    bombId,

    changes:
      explodeChanges

  });


  gameChannel.send({

    type:
      "broadcast",

    event:
      "bomb_state",

    payload: {

      bombId,

      changes:
        explodeChanges

    }

  });


  if (!roundEnded) {

    const allPlayers = {

      [currentUser.id]:
        myPlayer,

      ...otherPlayers

    };


    Object.entries(
      allPlayers
    ).forEach(
      ([userId, p]) => {

        if (
          !p ||
          p.eliminated ||
          p.hasShield
        ) {
          return;
        }


        const dist =
          Math.hypot(
            p.x -
              bomb.targetX,

            p.y -
              bomb.targetY
          );


        if (
          dist <=
          EXPLOSION_RADIUS_PX
        ) {

          const elimPayload = {

            targetUserId:
              userId,

            attackerUserId:
              bomb.thrownBy

          };


          handleEliminationBroadcast(
            elimPayload
          );


          gameChannel.send({

            type:
              "broadcast",

            event:
              "player_eliminated",

            payload:
              elimPayload

          });

        }

      }
    );

  }


  setTimeout(
    () => {

      delete bombs[
        bombId
      ];


      gameChannel.send({

        type:
          "broadcast",

        event:
          "bomb_remove",

        payload: {
          bombId
        }

      });

    },

    550
  );
}


// =========================================================
// ELIMINATION
// =========================================================

function handleEliminationBroadcast({
  targetUserId,
  attackerUserId
}) {

  // -------------------------------------------------------
  // Kill credit
  // -------------------------------------------------------

  if (
    attackerUserId ===
      currentUser.id &&
    attackerUserId !==
      targetUserId
  ) {

    myScore.kills++;
    myScore.hits++;


    pushMyScore(
      roundId,
      currentUser.id,
      myScore
    );

  }


  // -------------------------------------------------------
  // Local player eliminated
  // -------------------------------------------------------

  if (
    targetUserId ===
    currentUser.id
  ) {

    if (
      myPlayer.eliminated
    ) {
      return;
    }


    myPlayer.eliminated =
      true;

    myPlayer.hasShield =
      false;

    myCarriedBombId =
      null;


    playSound(
      "eliminate"
    );


    myScore.deaths++;


    pushMyScore(
      roundId,
      currentUser.id,
      myScore
    );


    if (!roundEnded) {

      runRespawnCountdown(

        {
          overlay:
            document.getElementById(
              "eliminationOverlay"
            ),

          title:
            document.getElementById(
              "elimTitle"
            ),

          number:
            document.getElementById(
              "elimNumber"
            )
        },

        () =>
          respawnLocalPlayer()

      );

    }


  } else {

    const p =
      otherPlayers[
        targetUserId
      ];

    if (p) {
      p.eliminated =
        true;
    }

  }
}


// =========================================================
// RESPAWN
// =========================================================

function respawnLocalPlayer() {

  if (
    roundEnded ||
    !myPlayer
  ) {
    return;
  }


  playSound(
    "respawn"
  );


  const spawn =
    getRandomSafeSpawnPoint(
      arena
    );


  myPlayer.x =
    spawn.x;

  myPlayer.y =
    spawn.y;

  myPlayer.eliminated =
    false;

  myPlayer.hasShield =
    true;


  broadcastPosition(
    true
  );


  gameChannel.send({

    type:
      "broadcast",

    event:
      "player_respawn",

    payload: {

      userId:
        currentUser.id,

      x:
        spawn.x,

      y:
        spawn.y

    }

  });


  setTimeout(
    () => {

      if (
        myPlayer &&
        !myPlayer.eliminated
      ) {
        myPlayer.hasShield =
          false;
      }

    },

    SHIELD_DURATION_MS
  );
}


function handleRespawnBroadcast({
  userId,
  x,
  y
}) {

  const p =
    otherPlayers[
      userId
    ];

  if (!p) {
    return;
  }


  p.eliminated =
    false;

  p.hasShield =
    true;

  p.x =
    p.targetX =
    x;

  p.y =
    p.targetY =
    y;


  setTimeout(
    () => {

      if (p) {
        p.hasShield =
          false;
      }

    },

    SHIELD_DURATION_MS
  );
}


// =========================================================
// ACTION BUTTONS
// =========================================================

function setupActionButtons() {

  const pickupBtn =
    document.getElementById(
      "pickupBtn"
    );

  const throwBtn =
    document.getElementById(
      "throwBtn"
    );


  pickupBtn.addEventListener(
    "click",
    () => {

      const nearest =
        findNearestIdleBomb();

      if (nearest) {

        requestPickup(
          nearest.id
        );

      }

    }
  );


  throwBtn.addEventListener(
    "click",
    () => {

      if (
        myCarriedBombId
      ) {

        requestThrow(
          myCarriedBombId
        );

      }

    }
  );
}


// =========================================================
// FIND NEAREST BOMB
// =========================================================

function findNearestIdleBomb() {

  if (
    myCarriedBombId ||
    myPlayer?.eliminated ||
    roundEnded
  ) {
    return null;
  }


  let nearest = null;
  let nearestDist =
    Infinity;


  Object.values(
    bombs
  ).forEach(
    b => {

      if (
        b.state !==
        "idle"
      ) {
        return;
      }


      const dist =
        Math.hypot(
          b.x -
            myPlayer.x,

          b.y -
            myPlayer.y
        );


      if (
        dist <
          PICKUP_RADIUS_PX &&
        dist <
          nearestDist
      ) {

        nearest =
          b;

        nearestDist =
          dist;

      }

    }
  );


  return nearest;
}


// =========================================================
// ACTION BUTTON UI
// =========================================================

function updateActionButtonsUI() {

  const pickupBtn =
    document.getElementById(
      "pickupBtn"
    );

  const throwBtn =
    document.getElementById(
      "throwBtn"
    );

  const bombReadyHud =
    document.getElementById(
      "bombReadyHud"
    );


  if (
    !pickupBtn ||
    !throwBtn ||
    !bombReadyHud
  ) {
    return;
  }


  const nearest =
    findNearestIdleBomb();


  pickupBtn.style.opacity =
    nearest
      ? "1"
      : "0.4";


  const canThrow =
    !!myCarriedBombId &&
    !roundEnded &&
    !myPlayer?.eliminated;


  throwBtn.style.opacity =
    canThrow
      ? "1"
      : "0.4";


  bombReadyHud.classList.toggle(
    "hidden",
    !canThrow
  );
}


// =========================================================
// CHAT
// =========================================================

function setupChatToggle() {

  const toggleBtn =
    document.getElementById(
      "chatToggleBtn"
    );

  const panel =
    document.getElementById(
      "chatOverlayPanel"
    );


  if (
    !toggleBtn ||
    !panel
  ) {
    return;
  }


  toggleBtn.addEventListener(
    "click",
    () => {

      const opening =
        panel.classList.contains(
          "hidden"
        );


      panel.classList.toggle(
        "hidden"
      );


      if (
        opening &&
        !chatMounted
      ) {

        chatMounted =
          true;


        chatChannel =
          mountChatPanel(
            panel,
            {
              roomId:
                room.id,

              userId:
                currentUser.id,

              username:
                currentProfile.username

            }
          );

      }

    }
  );
}


// =========================================================
// ROUND TIMER
// =========================================================

function startTimerDisplay() {

  if (
    timerDisplayInterval
  ) {
    clearInterval(
      timerDisplayInterval
    );
  }


  timerDisplayInterval =
    setInterval(
      () => {

        const remainingMs =
          Math.max(
            0,
            roundEndsAtMs -
              Date.now()
          );


        const totalSeconds =
          Math.ceil(
            remainingMs /
              1000
          );


        const mm =
          String(
            Math.floor(
              totalSeconds /
                60
            )
          ).padStart(
            2,
            "0"
          );


        const ss =
          String(
            totalSeconds %
              60
          ).padStart(
            2,
            "0"
          );


        const timer =
          document.getElementById(
            "timerLabel"
          );


        if (timer) {

          timer.textContent =
            `${mm}:${ss}`;

        }


        if (
          remainingMs <= 0 &&
          !roundEnded
        ) {

          onRoundEnd();

        }

      },

      250
    );
}


// =========================================================
// ROUND END
// =========================================================

async function onRoundEnd() {

  if (
    roundEnded
  ) {
    return;
  }


  roundEnded =
    true;


  if (
    bombSpawnTimer
  ) {

    clearInterval(
      bombSpawnTimer
    );

    bombSpawnTimer =
      null;

  }


  const pickupBtn =
    document.getElementById(
      "pickupBtn"
    );

  const throwBtn =
    document.getElementById(
      "throwBtn"
    );

  const overlay =
    document.getElementById(
      "roundEndOverlay"
    );


  if (pickupBtn) {
    pickupBtn.disabled =
      true;
  }

  if (throwBtn) {
    throwBtn.disabled =
      true;
  }

  if (overlay) {
    overlay.classList.remove(
      "hidden"
    );
  }


  try {

    if (isHost) {

      await finalizeRoundAsHost(
        room.id,
        roundId
      );

    }


    await waitForRoundResultsAndRedirect(
      roundId
    );

  } catch (error) {

    console.error(
      "Round ending error:",
      error
    );

    alert(
      "The round ended, but the results could not be loaded."
    );

  }
}


// =========================================================
// MAIN GAME LOOP
// =========================================================

function loop(timestamp) {

  const dt =
    lastFrameTime
      ? Math.min(
          0.05,
          (
            timestamp -
            lastFrameTime
          ) / 1000
        )
      : 0;


  lastFrameTime =
    timestamp;


  update(dt);

  render();


  requestAnimationFrame(
    loop
  );
}


// =========================================================
// UPDATE
// =========================================================

function update(dt) {

  if (
    myPlayer &&
    !myPlayer.eliminated &&
    !roundEnded
  ) {

    const input =
      getMovementVector(
        joystickState
      );


    myPlayer.updateLocal(
      input,
      dt,
      arena
    );

  }


  broadcastPosition(
    false
  );


  Object.values(
    otherPlayers
  ).forEach(
    p => {

      p.updateRemote(
        dt
      );

    }
  );


  Object.values(
    bombs
  ).forEach(
    b => {

      if (
        b.state !==
        "thrown"
      ) {
        return;
      }


      const elapsed =
        performance.now() -
        b.startTime;


      const t =
        Math.min(
          1,
          elapsed /
            b.travelMs
        );


      b.renderX =
        b.x +
        (
          b.targetX -
          b.x
        ) * t;


      b.renderY =
        b.y +
        (
          b.targetY -
          b.y
        ) * t;

    }
  );


  updateActionButtonsUI();
}


// =========================================================
// RENDER
// =========================================================

function render() {

  if (
    !ctx ||
    !arena
  ) {
    return;
  }


  ctx.clearRect(
    0,
    0,
    logicalWidth,
    logicalHeight
  );


  const scale =
    Math.min(
      logicalWidth /
        WORLD_SIZE,

      logicalHeight /
        WORLD_SIZE
    );


  const offsetX =
    (
      logicalWidth -
      WORLD_SIZE *
        scale
    ) / 2;


  const offsetY =
    (
      logicalHeight -
      WORLD_SIZE *
        scale
    ) / 2;


  ctx.save();


  ctx.translate(
    offsetX,
    offsetY
  );


  ctx.scale(
    scale,
    scale
  );


  // -------------------------------------------------------
  // Ground
  // -------------------------------------------------------

  ctx.fillStyle =
    "#1c2e1c";


  ctx.fillRect(
    0,
    0,
    WORLD_SIZE,
    WORLD_SIZE
  );


  drawGroundGrid();

  drawObstacles();


  // -------------------------------------------------------
  // Bombs
  // -------------------------------------------------------

  Object.values(
    bombs
  ).forEach(
    b => {

      if (
        b.state ===
        "idle"
      ) {

        drawBomb(
          ctx,
          b
        );

      }


      if (
        b.state ===
        "thrown"
      ) {

        drawBomb(
          ctx,
          {
            x:
              b.renderX ??
              b.x,

            y:
              b.renderY ??
              b.y
          }
        );

      }

    }
  );


  // -------------------------------------------------------
  // Players
  // -------------------------------------------------------

  const allPlayers =
    [
      myPlayer,
      ...Object.values(
        otherPlayers
      )
    ]
      .filter(
        p =>
          p &&
          !p.eliminated
      )
      .sort(
        (a, b) =>
          a.y -
          b.y
      );


  allPlayers.forEach(
    p =>
      p.draw(ctx)
  );


  // -------------------------------------------------------
  // Carried bombs
  // -------------------------------------------------------

  Object.values(
    bombs
  ).forEach(
    b => {

      if (
        b.state !==
        "carried"
      ) {
        return;
      }


      const carrier =
        b.carriedBy ===
        currentUser.id

          ? myPlayer

          : otherPlayers[
              b.carriedBy
            ];


      if (carrier) {

        drawBomb(
          ctx,
          {
            x:
              carrier.x +
              20,

            y:
              carrier.y -
              30
          }
        );

      }

    }
  );


  // -------------------------------------------------------
  // Explosions
  // -------------------------------------------------------

  const now =
    performance.now();


  explosions =
    explosions.filter(
      e =>
        now -
          e.startTime <
        500
    );


  explosions.forEach(
    e =>
      drawExplosion(
        ctx,
        e,
        now -
          e.startTime
      )
  );


  ctx.restore();
}


// =========================================================
// GROUND GRID
// =========================================================

function drawGroundGrid() {

  ctx.strokeStyle =
    "rgba(255,255,255,0.04)";

  ctx.lineWidth =
    1;


  for (
    let x = 0;
    x <= WORLD_SIZE;
    x += 60
  ) {

    ctx.beginPath();

    ctx.moveTo(
      x,
      0
    );

    ctx.lineTo(
      x,
      WORLD_SIZE
    );

    ctx.stroke();

  }


  for (
    let y = 0;
    y <= WORLD_SIZE;
    y += 60
  ) {

    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      WORLD_SIZE,
      y
    );

    ctx.stroke();

  }
}


// =========================================================
// OBSTACLES
// =========================================================

const OBSTACLE_COLORS = {

  wall:
    "#555b6e",

  box:
    "#8a5a2f",

  rock:
    "#6b6f76",

  tree:
    "#2f8f4e",

  building:
    "#4a4e63"

};


function drawObstacles() {

  arena.obstacles.forEach(
    o => {

      ctx.fillStyle =
        OBSTACLE_COLORS[
          o.type
        ] ||
        "#666";


      if (
        o.type ===
          "rock" ||
        o.type ===
          "tree"
      ) {

        ctx.beginPath();


        ctx.ellipse(

          o.x +
            o.w / 2,

          o.y +
            o.h / 2,

          o.w / 2,

          o.h / 2,

          0,

          0,

          Math.PI *
            2

        );


        ctx.fill();

      } else {

        ctx.fillRect(
          o.x,
          o.y,
          o.w,
          o.h
        );


        ctx.strokeStyle =
          "rgba(0,0,0,0.25)";


        ctx.strokeRect(
          o.x,
          o.y,
          o.w,
          o.h
        );

      }

    }
  );
}


// =========================================================
// CLEANUP
// =========================================================

window.addEventListener(
  "beforeunload",
  () => {

    if (
      bombSpawnTimer
    ) {

      clearInterval(
        bombSpawnTimer
      );

    }


    if (
      timerDisplayInterval
    ) {

      clearInterval(
        timerDisplayInterval
      );

    }


    if (
      gameChannel
    ) {

      window.supabaseClient
        .removeChannel(
          gameChannel
        );

    }


    if (
      chatChannel
    ) {

      window.supabaseClient
        .removeChannel(
          chatChannel
        );

    }

  }
);


// =========================================================
// START
// =========================================================

initGame();
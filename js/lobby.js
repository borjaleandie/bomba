/**
 * js/lobby.js
 * ---------------------------------------------------------
 * Data-layer functions for the lobby page.
 *
 * Works with:
 *   profiles
 *   characters
 *   game_rooms
 *   room_players
 *   game_rounds
 *
 * IMPORTANT:
 *   - The host creates the round.
 *   - The round ID is ALWAYS saved into game_rooms.current_round_id.
 *   - The room is changed to "playing" only after the round is active.
 * ---------------------------------------------------------
 */

const PLAYER_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#84cc16",
  "#64748b"
];


// =========================================================
// AUTHENTICATION
// =========================================================

async function getLobbyUser() {
  const {
    data: { user },
    error
  } = await window.supabaseClient.auth.getUser();

  if (error) {
    console.error("Auth error:", error);
    throw new Error("Could not verify your login session.");
  }

  if (!user) {
    throw new Error("You must be logged in.");
  }

  return user;
}


// =========================================================
// FETCH ROOM PLAYERS
// =========================================================

async function fetchRoomPlayers(roomId) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const {
    data: roomPlayers,
    error
  } = await window.supabaseClient
    .from("room_players")
    .select(
      "id, user_id, is_ready, is_host, joined_at"
    )
    .eq("room_id", roomId)
    .is("left_at", null)
    .order("joined_at", {
      ascending: true
    });

  if (error) {
    console.error("Fetch room players error:", error);
    throw error;
  }

  if (!roomPlayers || roomPlayers.length === 0) {
    return [];
  }

  const userIds = roomPlayers.map(
    player => player.user_id
  );

  const [
    {
      data: profiles,
      error: profileError
    },
    {
      data: characters,
      error: characterError
    }
  ] = await Promise.all([

    window.supabaseClient
      .from("profiles")
      .select("id, username, full_name")
      .in("id", userIds),

    window.supabaseClient
      .from("characters")
      .select("*")
      .in("user_id", userIds)

  ]);

  if (profileError) {
    console.error("Fetch profiles error:", profileError);
    throw profileError;
  }

  if (characterError) {
    console.error("Fetch characters error:", characterError);
    throw characterError;
  }

  return roomPlayers.map((rp, index) => {

    const profile = profiles?.find(
      p => p.id === rp.user_id
    );

    const character = characters?.find(
      c => c.user_id === rp.user_id
    );

    return {
      ...rp,

      username:
        profile?.username ||
        profile?.full_name ||
        "Player",

      character:
        character || null,

      color:
        PLAYER_COLORS[
          index % PLAYER_COLORS.length
        ]
    };
  });
}


// =========================================================
// TOGGLE READY
// =========================================================

async function toggleReady(
  roomId,
  userId,
  newReadyState
) {
  const user = await getLobbyUser();

  if (user.id !== userId) {
    throw new Error(
      "You can only change your own ready status."
    );
  }

  const {
    data,
    error
  } = await window.supabaseClient
    .from("room_players")
    .update({
      is_ready: Boolean(newReadyState)
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .is("left_at", null)
    .select()
    .limit(1);

  if (error) {
    console.error("Toggle ready error:", error);
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(
      "You are not currently in this room."
    );
  }

  return data[0];
}


// =========================================================
// LEAVE ROOM
// =========================================================

async function leaveRoom(
  roomId,
  userId
) {
  const user = await getLobbyUser();

  if (user.id !== userId) {
    throw new Error(
      "You can only leave your own room membership."
    );
  }

  const {
    data,
    error
  } = await window.supabaseClient
    .from("room_players")
    .update({
      left_at: new Date().toISOString()
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .is("left_at", null)
    .select()
    .limit(1);

  if (error) {
    console.error("Leave room error:", error);
    throw error;
  }

  return data?.[0] || null;
}


// =========================================================
// GET ROOM
// =========================================================

async function getLobbyRoom(roomId) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const {
    data,
    error
  } = await window.supabaseClient
    .from("game_rooms")
    .select(`
      id,
      room_code,
      room_name,
      host_id,
      player_limit,
      map,
      round_duration_seconds,
      status,
      current_round_id,
      created_at,
      started_at,
      ended_at
    `)
    .eq("id", roomId)
    .limit(1);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error("Room not found.");
  }

  return data[0];
}


// =========================================================
// CREATE GAME ROUND
// =========================================================

async function createGameRound(
  roomId,
  hostId
) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  if (!hostId) {
    throw new Error("Host ID is required.");
  }

  const room = await getLobbyRoom(roomId);

  if (room.host_id !== hostId) {
    throw new Error(
      "Only the host can create the game round."
    );
  }


  // -------------------------------------------------------
  // If current_round_id already exists, verify it.
  // -------------------------------------------------------

  if (room.current_round_id) {

    const {
      data: existingRounds,
      error: existingError
    } = await window.supabaseClient
      .from("game_rounds")
      .select("*")
      .eq("id", room.current_round_id)
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    if (
      existingRounds &&
      existingRounds.length > 0
    ) {
      console.log(
        "Using existing game round:",
        existingRounds[0]
      );

      return existingRounds[0];
    }

    // current_round_id points to something that doesn't exist.
    // Clear it before creating a new round.
    await window.supabaseClient
      .from("game_rooms")
      .update({
        current_round_id: null
      })
      .eq("id", roomId)
      .eq("host_id", hostId);
  }


  // -------------------------------------------------------
  // Determine next round number.
  // -------------------------------------------------------

  const {
    count: roundCount,
    error: countError
  } = await window.supabaseClient
    .from("game_rounds")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("room_id", roomId);

  if (countError) {
    throw countError;
  }

  const roundNumber =
    (roundCount || 0) + 1;


  // -------------------------------------------------------
  // Create round.
  // -------------------------------------------------------

  const {
    data: roundRows,
    error: roundError
  } = await window.supabaseClient
    .from("game_rounds")
    .insert({
      room_id: roomId,
      round_number: roundNumber,
      status: "playing",
      started_at: new Date().toISOString()
    })
    .select()
    .limit(1);

  if (roundError) {
    console.error(
      "Create game round error:",
      roundError
    );

    throw roundError;
  }

  if (
    !roundRows ||
    roundRows.length === 0
  ) {
    throw new Error(
      "Game round was created but could not be loaded."
    );
  }

  const round = roundRows[0];


  // -------------------------------------------------------
  // CRITICAL:
  // Save the round ID into the room.
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      current_round_id: round.id
    })
    .eq("id", roomId)
    .eq("host_id", hostId)
    .select()
    .limit(1);

  if (updateError) {

    await window.supabaseClient
      .from("game_rounds")
      .delete()
      .eq("id", round.id);

    throw updateError;
  }

  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    await window.supabaseClient
      .from("game_rounds")
      .delete()
      .eq("id", round.id);

    throw new Error(
      "Could not attach the game round to the room."
    );
  }


  console.log(
    "NEW ACTIVE ROUND:",
    round.id
  );

  console.log(
    "ROOM CURRENT ROUND:",
    updatedRooms[0].current_round_id
  );

  return round;
}


// =========================================================
// START GAME
// =========================================================

async function beginStartSequence(
  roomId
) {
  const user = await getLobbyUser();

  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const room = await getLobbyRoom(roomId);


  // -------------------------------------------------------
  // Check host.
  // -------------------------------------------------------

  if (room.host_id !== user.id) {
    throw new Error(
      "Only the host can start the game."
    );
  }


  // -------------------------------------------------------
  // Already playing.
  // -------------------------------------------------------

  if (room.status === "playing") {

    // Make sure the active round still exists.
    if (!room.current_round_id) {
      throw new Error(
        "Room is marked playing but has no current round."
      );
    }

    return room;
  }


  // -------------------------------------------------------
  // Already starting.
  // -------------------------------------------------------

  if (room.status === "starting") {

    // Make sure current_round_id exists.
    if (!room.current_round_id) {

      const round = await createGameRound(
        roomId,
        user.id
      );

      return await getLobbyRoom(roomId);
    }

    return room;
  }


  // -------------------------------------------------------
  // Must be waiting.
  // -------------------------------------------------------

  if (room.status !== "waiting") {
    throw new Error(
      `This room cannot be started right now. Current status: ${room.status}`
    );
  }


  // -------------------------------------------------------
  // Get active players.
  // -------------------------------------------------------

  const {
    data: players,
    error: playersError
  } = await window.supabaseClient
    .from("room_players")
    .select(`
      id,
      user_id,
      is_ready,
      is_host
    `)
    .eq("room_id", roomId)
    .is("left_at", null);

  if (playersError) {
    throw playersError;
  }

  if (!players || players.length < 2) {
    throw new Error(
      "At least 2 players are required to start the game."
    );
  }


  // -------------------------------------------------------
  // Check all ready.
  // -------------------------------------------------------

  const allReady =
    players.every(
      player => player.is_ready === true
    );

  if (!allReady) {

    const notReady =
      players.filter(
        player => !player.is_ready
      ).length;

    throw new Error(
      `${notReady} player${
        notReady === 1 ? "" : "s"
      } ${
        notReady === 1 ? "is" : "are"
      } not ready.`
    );
  }


  // =======================================================
  // CREATE AND ATTACH ROUND
  // =======================================================

  const round =
    await createGameRound(
      roomId,
      user.id
    );


  // -------------------------------------------------------
  // Change waiting → starting.
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      status: "starting",
      current_round_id: round.id
    })
    .eq("id", roomId)
    .eq("host_id", user.id)
    .eq("status", "waiting")
    .select()
    .limit(1);

  if (updateError) {
    throw updateError;
  }


  // -------------------------------------------------------
  // Another request may have started it.
  // -------------------------------------------------------

  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    const latestRoom =
      await getLobbyRoom(roomId);

    if (
      latestRoom.status === "starting" ||
      latestRoom.status === "playing"
    ) {

      return latestRoom;
    }

    throw new Error(
      "The room could not be started."
    );
  }


  console.log(
    "ROOM IS STARTING:",
    updatedRooms[0]
  );

  return updatedRooms[0];
}


// =========================================================
// MARK ROOM AS PLAYING
// =========================================================

async function markRoomPlaying(
  roomId
) {
  const user = await getLobbyUser();

  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  let room =
    await getLobbyRoom(roomId);


  // -------------------------------------------------------
  // Check host.
  // -------------------------------------------------------

  if (room.host_id !== user.id) {
    throw new Error(
      "Only the host can start the game."
    );
  }


  // -------------------------------------------------------
  // Already playing.
  // -------------------------------------------------------

  if (room.status === "playing") {

    if (!room.current_round_id) {
      throw new Error(
        "Room is playing but has no active round."
      );
    }

    return room;
  }


  // -------------------------------------------------------
  // Must be starting.
  // -------------------------------------------------------

  if (room.status !== "starting") {
    throw new Error(
      `Room cannot enter the game right now. Current status: ${room.status}`
    );
  }


  // -------------------------------------------------------
  // CRITICAL:
  // Make absolutely sure a round exists.
  // -------------------------------------------------------

  if (!room.current_round_id) {

    await createGameRound(
      roomId,
      user.id
    );

    room =
      await getLobbyRoom(roomId);
  }


  // -------------------------------------------------------
  // Verify round actually exists.
  // -------------------------------------------------------

  const {
    data: roundRows,
    error: roundFetchError
  } = await window.supabaseClient
    .from("game_rounds")
    .select("*")
    .eq("id", room.current_round_id)
    .limit(1);

  if (roundFetchError) {
    throw roundFetchError;
  }

  if (
    !roundRows ||
    roundRows.length === 0
  ) {
    throw new Error(
      "The room references a round that does not exist."
    );
  }

  const round = roundRows[0];


  // -------------------------------------------------------
  // Activate round.
  // -------------------------------------------------------

  if (round.status !== "playing") {

    const {
      data: activatedRounds,
      error: activateError
    } = await window.supabaseClient
      .from("game_rounds")
      .update({
        status: "playing",
        started_at:
          round.started_at ||
          new Date().toISOString()
      })
      .eq("id", room.current_round_id)
      .select()
      .limit(1);

    if (activateError) {
      throw activateError;
    }

    if (
      !activatedRounds ||
      activatedRounds.length === 0
    ) {
      throw new Error(
        "Could not activate the game round."
      );
    }
  }


  // -------------------------------------------------------
  // Change room → playing.
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      status: "playing",
      started_at:
        room.started_at ||
        new Date().toISOString(),
      current_round_id:
        room.current_round_id
    })
    .eq("id", roomId)
    .eq("host_id", user.id)
    .eq("status", "starting")
    .select()
    .limit(1);

  if (updateError) {
    throw updateError;
  }


  // -------------------------------------------------------
  // If another request changed it already.
  // -------------------------------------------------------

  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    const latestRoom =
      await getLobbyRoom(roomId);

    if (
      latestRoom.status === "playing" &&
      latestRoom.current_round_id
    ) {
      return latestRoom;
    }

    throw new Error(
      "Could not start the game."
    );
  }


  console.log(
    "ROOM IS NOW PLAYING:",
    updatedRooms[0]
  );

  return updatedRooms[0];
}
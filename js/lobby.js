/**
 * js/lobby.js
 * ---------------------------------------------------------
 * Data-layer functions for the lobby page.
 *
 * Handles:
 *   profiles
 *   characters
 *   game_rooms
 *   room_players
 *   game_rounds
 *
 * IMPORTANT:
 *   - Host creates the round.
 *   - Round ID is ALWAYS saved to game_rooms.current_round_id.
 *   - Room becomes "playing" only after the round exists.
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
    throw new Error(
      "Could not verify your login session."
    );
  }

  if (!user) {
    throw new Error(
      "You must be logged in."
    );
  }

  return user;
}


// =========================================================
// GET ROOM
// =========================================================

async function getLobbyRoom(roomId) {

  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
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
    console.error(
      "Get room error:",
      error
    );

    throw error;
  }

  if (
    !data ||
    data.length === 0
  ) {
    throw new Error(
      "Room not found."
    );
  }

  return data[0];
}


// =========================================================
// FETCH ROOM PLAYERS
// =========================================================

async function fetchRoomPlayers(roomId) {

  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
  }

  const {
    data: roomPlayers,
    error
  } = await window.supabaseClient
    .from("room_players")
    .select(`
      id,
      user_id,
      is_ready,
      is_host,
      joined_at
    `)
    .eq("room_id", roomId)
    .is("left_at", null)
    .order("joined_at", {
      ascending: true
    });

  if (error) {
    console.error(
      "Fetch room players error:",
      error
    );

    throw error;
  }

  if (
    !roomPlayers ||
    roomPlayers.length === 0
  ) {
    return [];
  }

  const userIds =
    roomPlayers.map(
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
      .select(
        "id, username, full_name"
      )
      .in("id", userIds),

    window.supabaseClient
      .from("characters")
      .select("*")
      .in("user_id", userIds)

  ]);

  if (profileError) {
    console.error(
      "Fetch profiles error:",
      profileError
    );

    throw profileError;
  }

  if (characterError) {
    console.error(
      "Fetch characters error:",
      characterError
    );

    throw characterError;
  }

  return roomPlayers.map(
    (rp, index) => {

      const profile =
        profiles?.find(
          p => p.id === rp.user_id
        );

      const character =
        characters?.find(
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

    }
  );
}


// =========================================================
// TOGGLE READY
// =========================================================

async function toggleReady(
  roomId,
  userId,
  newReadyState
) {

  const user =
    await getLobbyUser();

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
      is_ready:
        Boolean(newReadyState)
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .is("left_at", null)
    .select()
    .limit(1);

  if (error) {
    console.error(
      "Toggle ready error:",
      error
    );

    throw error;
  }

  if (
    !data ||
    data.length === 0
  ) {
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

  const user =
    await getLobbyUser();

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
      left_at:
        new Date().toISOString()
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .is("left_at", null)
    .select()
    .limit(1);

  if (error) {
    console.error(
      "Leave room error:",
      error
    );

    throw error;
  }

  return data?.[0] || null;
}


// =========================================================
// CREATE GAME ROUND
// =========================================================
// This function is now responsible for:
//
// 1. Creating game_rounds
// 2. Saving current_round_id
// 3. Making sure the round is playing
//
// It DOES NOT depend on another function to attach
// the round afterward.
// =========================================================

async function createGameRound(
  roomId,
  hostId
) {

  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
  }

  if (!hostId) {
    throw new Error(
      "Host ID is required."
    );
  }


  // -------------------------------------------------------
  // Get room
  // -------------------------------------------------------

  let room =
    await getLobbyRoom(roomId);


  // -------------------------------------------------------
  // Verify host
  // -------------------------------------------------------

  if (
    room.host_id !== hostId
  ) {
    throw new Error(
      "Only the host can create the game round."
    );
  }


  // -------------------------------------------------------
  // If current_round_id already exists,
  // verify that the round really exists.
  // -------------------------------------------------------

  if (
    room.current_round_id
  ) {

    const {
      data: existingRounds,
      error: existingError
    } = await window.supabaseClient
      .from("game_rounds")
      .select(
        "id, room_id, round_number, status, started_at"
      )
      .eq(
        "id",
        room.current_round_id
      )
      .eq(
        "room_id",
        roomId
      )
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    if (
      existingRounds &&
      existingRounds.length > 0
    ) {

      const existingRound =
        existingRounds[0];

      // If the round exists, make sure it is playing.
      if (
        existingRound.status !== "playing"
      ) {

        const {
          data: activated,
          error: activateError
        } = await window.supabaseClient
          .from("game_rounds")
          .update({
            status: "playing",
            started_at:
              existingRound.started_at ||
              new Date().toISOString()
          })
          .eq(
            "id",
            existingRound.id
          )
          .select()
          .limit(1);

        if (activateError) {
          throw activateError;
        }

        if (
          activated &&
          activated.length > 0
        ) {
          return activated[0];
        }
      }

      return existingRound;
    }


    // -----------------------------------------------------
    // Broken current_round_id.
    // Clear it.
    // -----------------------------------------------------

    const {
      error: clearError
    } = await window.supabaseClient
      .from("game_rooms")
      .update({
        current_round_id: null
      })
      .eq(
        "id",
        roomId
      )
      .eq(
        "host_id",
        hostId
      );

    if (clearError) {
      throw clearError;
    }

    room =
      await getLobbyRoom(roomId);
  }


  // -------------------------------------------------------
  // Get next round number
  // -------------------------------------------------------

  const {
    count: roundCount,
    error: countError
  } = await window.supabaseClient
    .from("game_rounds")
    .select(
      "id",
      {
        count: "exact",
        head: true
      }
    )
    .eq(
      "room_id",
      roomId
    );

  if (countError) {
    throw countError;
  }

  const roundNumber =
    (roundCount || 0) + 1;


  // -------------------------------------------------------
  // Create round
  // -------------------------------------------------------

  const {
    data: roundRows,
    error: roundError
  } = await window.supabaseClient
    .from("game_rounds")
    .insert({

      room_id:
        roomId,

      round_number:
        roundNumber,

      status:
        "playing",

      started_at:
        new Date().toISOString()

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

  const round =
    roundRows[0];


  // -------------------------------------------------------
  // CRITICAL:
  //
  // Attach round to room.
  // Also change room to PLAYING.
  //
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({

      current_round_id:
        round.id,

      status:
        "playing",

      started_at:
        new Date().toISOString()

    })
    .eq(
      "id",
      roomId
    )
    .eq(
      "host_id",
      hostId
    )
    .select()
    .limit(1);


  // -------------------------------------------------------
  // If room update failed, delete the round.
  // -------------------------------------------------------

  if (updateError) {

    console.error(
      "Attach round to room error:",
      updateError
    );

    await window.supabaseClient
      .from("game_rounds")
      .delete()
      .eq(
        "id",
        round.id
      );

    throw updateError;
  }


  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    await window.supabaseClient
      .from("game_rounds")
      .delete()
      .eq(
        "id",
        round.id
      );

    throw new Error(
      "Could not attach the game round to the room."
    );
  }


  const updatedRoom =
    updatedRooms[0];


  // -------------------------------------------------------
  // FINAL VERIFICATION
  // -------------------------------------------------------

  if (
    updatedRoom.current_round_id !==
    round.id
  ) {

    throw new Error(
      "Round was created but current_round_id was not saved."
    );

  }


  if (
    updatedRoom.status !==
    "playing"
  ) {

    throw new Error(
      "Round exists but room was not changed to playing."
    );

  }


  console.log(
    "================================"
  );

  console.log(
    "NEW ROUND CREATED:",
    round.id
  );

  console.log(
    "ROOM:",
    updatedRoom.id
  );

  console.log(
    "ROOM STATUS:",
    updatedRoom.status
  );

  console.log(
    "CURRENT ROUND:",
    updatedRoom.current_round_id
  );

  console.log(
    "================================"
  );


  return round;
}


// =========================================================
// BEGIN START SEQUENCE
// =========================================================
// Kept for compatibility with other code.
//
// The actual host start is handled by startGame().
// =========================================================

async function beginStartSequence(
  roomId
) {

  const user =
    await getLobbyUser();

  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
  }

  const room =
    await getLobbyRoom(roomId);


  // -------------------------------------------------------
  // Host only
  // -------------------------------------------------------

  if (
    room.host_id !== user.id
  ) {
    throw new Error(
      "Only the host can start the game."
    );
  }


  // -------------------------------------------------------
  // If already playing
  // -------------------------------------------------------

  if (
    room.status === "playing"
  ) {

    if (
      !room.current_round_id
    ) {

      await createGameRound(
        roomId,
        user.id
      );

      return await getLobbyRoom(
        roomId
      );
    }

    return room;
  }


  // -------------------------------------------------------
  // If starting
  // -------------------------------------------------------

  if (
    room.status === "starting"
  ) {

    if (
      !room.current_round_id
    ) {

      await createGameRound(
        roomId,
        user.id
      );
    }

    return await getLobbyRoom(
      roomId
    );
  }


  // -------------------------------------------------------
  // Must be waiting
  // -------------------------------------------------------

  if (
    room.status !== "waiting"
  ) {

    throw new Error(
      `This room cannot be started right now. Current status: ${room.status}`
    );

  }


  // -------------------------------------------------------
  // Get active players
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
    .eq(
      "room_id",
      roomId
    )
    .is(
      "left_at",
      null
    );

  if (playersError) {
    throw playersError;
  }


  if (
    !players ||
    players.length < 2
  ) {

    throw new Error(
      "At least 2 players are required to start the game."
    );

  }


  // -------------------------------------------------------
  // Everyone ready
  // -------------------------------------------------------

  const allReady =
    players.every(
      player =>
        player.is_ready === true
    );


  if (!allReady) {

    const notReady =
      players.filter(
        player =>
          !player.is_ready
      ).length;

    throw new Error(
      `${notReady} player${
        notReady === 1
          ? ""
          : "s"
      } ${
        notReady === 1
          ? "is"
          : "are"
      } not ready.`
    );

  }


  // -------------------------------------------------------
  // Create and attach round.
  //
  // createGameRound() also changes the room to PLAYING.
  // -------------------------------------------------------

  await createGameRound(
    roomId,
    user.id
  );


  return await getLobbyRoom(
    roomId
  );
}


// =========================================================
// MARK ROOM PLAYING
// =========================================================
// Kept for compatibility.
//
// It now only verifies the room.
// It does NOT try to create another round.
// =========================================================

async function markRoomPlaying(
  roomId
) {

  const user =
    await getLobbyUser();

  const room =
    await getLobbyRoom(
      roomId
    );


  if (
    room.host_id !== user.id
  ) {

    throw new Error(
      "Only the host can start the game."
    );

  }


  if (
    room.status !== "playing"
  ) {

    throw new Error(
      `Room is not playing. Current status: ${room.status}`
    );

  }


  if (
    !room.current_round_id
  ) {

    throw new Error(
      "Room is playing but has no active round."
    );

  }


  // -------------------------------------------------------
  // Verify round
  // -------------------------------------------------------

  const {
    data: rounds,
    error
  } = await window.supabaseClient
    .from("game_rounds")
    .select(
      "id, room_id, status, started_at"
    )
    .eq(
      "id",
      room.current_round_id
    )
    .eq(
      "room_id",
      roomId
    )
    .limit(1);


  if (error) {
    throw error;
  }


  if (
    !rounds ||
    rounds.length === 0
  ) {

    throw new Error(
      "Room references a round that does not exist."
    );

  }


  if (
    rounds[0].status !== "playing"
  ) {

    throw new Error(
      "The active round is not playing."
    );

  }


  return room;
}


// =========================================================
// START GAME
// =========================================================
// THIS is the function used by lobby.html.
//
// It does everything in the correct order:
//
// 1. Authenticate
// 2. Verify host
// 3. Verify players
// 4. Verify ready
// 5. Create game_rounds
// 6. Save current_round_id
// 7. Set room = playing
// 8. Verify everything
// =========================================================

async function startGame(
  roomId
) {

  const user =
    await getLobbyUser();


  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
  }


  const room =
    await getLobbyRoom(
      roomId
    );


  // -------------------------------------------------------
  // Host check
  // -------------------------------------------------------

  if (
    room.host_id !== user.id
  ) {

    throw new Error(
      "Only the host can start the game."
    );

  }


  // -------------------------------------------------------
  // If already playing, don't create another round.
  // -------------------------------------------------------

  if (
    room.status === "playing"
  ) {

    if (
      !room.current_round_id
    ) {

      throw new Error(
        "Room is already marked as playing but has no active round."
      );

    }


    return await verifyActiveRound(
      room
    );

  }


  // -------------------------------------------------------
  // Room must be waiting.
  // -------------------------------------------------------

  if (
    room.status !== "waiting"
  ) {

    throw new Error(
      `This room cannot be started right now. Current status: ${room.status}`
    );

  }


  // -------------------------------------------------------
  // Get active players
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
    .eq(
      "room_id",
      roomId
    )
    .is(
      "left_at",
      null
    );


  if (playersError) {
    throw playersError;
  }


  // -------------------------------------------------------
  // Minimum players
  // -------------------------------------------------------

  if (
    !players ||
    players.length < 2
  ) {

    throw new Error(
      "At least 2 players are required to start the game."
    );

  }


  // -------------------------------------------------------
  // Everyone ready
  // -------------------------------------------------------

  const allReady =
    players.every(
      player =>
        player.is_ready === true
    );


  if (!allReady) {

    const notReady =
      players.filter(
        player =>
          !player.is_ready
      ).length;

    throw new Error(
      `${notReady} player${
        notReady === 1
          ? ""
          : "s"
      } ${
        notReady === 1
          ? "is"
          : "are"
      } not ready.`
    );

  }


  // -------------------------------------------------------
  // CREATE ROUND
  //
  // This automatically:
  //   - creates game_rounds
  //   - sets current_round_id
  //   - changes room to playing
  // -------------------------------------------------------

  await createGameRound(
    roomId,
    user.id
  );


  // -------------------------------------------------------
  // Load final room state
  // -------------------------------------------------------

  const finalRoom =
    await getLobbyRoom(
      roomId
    );


  // -------------------------------------------------------
  // FINAL CHECK
  // -------------------------------------------------------

  if (
    finalRoom.status !==
    "playing"
  ) {

    throw new Error(
      "The round was created but the room is not playing."
    );

  }


  if (
    !finalRoom.current_round_id
  ) {

    throw new Error(
      "The round was created but current_round_id is missing."
    );

  }


  // -------------------------------------------------------
  // Verify actual round
  // -------------------------------------------------------

  return await verifyActiveRound(
    finalRoom
  );
}


// =========================================================
// VERIFY ACTIVE ROUND
// =========================================================

async function verifyActiveRound(
  room
) {

  if (!room) {
    throw new Error(
      "Room data is missing."
    );
  }


  if (
    room.status !== "playing"
  ) {

    throw new Error(
      "Room is not currently playing."
    );

  }


  if (
    !room.current_round_id
  ) {

    throw new Error(
      "This room has no active round."
    );

  }


  const {
    data: rounds,
    error
  } = await window.supabaseClient
    .from("game_rounds")
    .select(`
      id,
      room_id,
      round_number,
      status,
      started_at
    `)
    .eq(
      "id",
      room.current_round_id
    )
    .eq(
      "room_id",
      room.id
    )
    .limit(1);


  if (error) {

    console.error(
      "Verify round error:",
      error
    );

    throw error;

  }


  if (
    !rounds ||
    rounds.length === 0
  ) {

    throw new Error(
      "The room points to a round that does not exist."
    );

  }


  const round =
    rounds[0];


  if (
    round.status !== "playing"
  ) {

    throw new Error(
      `The active round has status "${round.status}", not "playing".`
    );

  }


  console.log(
    "================================"
  );

  console.log(
    "ACTIVE ROUND VERIFIED"
  );

  console.log(
    "ROOM:",
    room.id
  );

  console.log(
    "ROOM STATUS:",
    room.status
  );

  console.log(
    "ROUND:",
    round.id
  );

  console.log(
    "ROUND STATUS:",
    round.status
  );

  console.log(
    "================================"
  );


  return room;
}
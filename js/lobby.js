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
 *   - The RPC start_game_round creates/activates the round.
 *   - The round ID MUST be saved into game_rooms.current_round_id.
 *   - The room MUST NOT be considered successfully started
 *     unless current_round_id exists.
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
    console.error("Get room error:", error);
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error("Room not found.");
  }

  return data[0];
}


// =========================================================
// GET CURRENT ROUND
// =========================================================

async function getCurrentGameRound(roomId) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const room = await getLobbyRoom(roomId);

  if (!room.current_round_id) {
    return null;
  }

  const {
    data,
    error
  } = await window.supabaseClient
    .from("game_rounds")
    .select("*")
    .eq("id", room.current_round_id)
    .eq("room_id", roomId)
    .limit(1);

  if (error) {
    console.error("Get current round error:", error);
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
}


// =========================================================
// CREATE / START GAME ROUND
// =========================================================
//
// IMPORTANT:
// This is the ONLY createGameRound() function.
//
// The Supabase RPC is responsible for:
//   1. Creating the game round
//   2. Setting the round status
//   3. Saving the round ID into game_rooms.current_round_id
//   4. Setting the room status appropriately
//
// We verify everything after the RPC returns.
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

  const user = await getLobbyUser();

  if (!user || user.id !== hostId) {
    throw new Error(
      "Only the host can start the game."
    );
  }

  const room = await getLobbyRoom(roomId);

  if (room.host_id !== hostId) {
    throw new Error(
      "Only the host can start the game."
    );
  }

  console.log("================================");
  console.log("STARTING GAME");
  console.log("ROOM ID:", roomId);
  console.log("HOST ID:", hostId);
  console.log("ROOM STATUS:", room.status);
  console.log("CURRENT ROUND:", room.current_round_id);
  console.log("================================");


  // -------------------------------------------------------
  // If a valid current round already exists, use it.
  // -------------------------------------------------------

  if (room.current_round_id) {

    const existingRound =
      await getCurrentGameRound(roomId);

    if (existingRound) {

      console.log(
        "Existing round found:",
        existingRound.id
      );

      return existingRound;
    }

    // current_round_id was invalid.
    console.warn(
      "current_round_id points to a missing round. Clearing it."
    );

    const {
      error: clearError
    } = await window.supabaseClient
      .from("game_rooms")
      .update({
        current_round_id: null
      })
      .eq("id", roomId)
      .eq("host_id", hostId);

    if (clearError) {
      throw clearError;
    }
  }


  // -------------------------------------------------------
  // Call Supabase RPC.
  // -------------------------------------------------------

  const {
    data,
    error
  } = await window.supabaseClient
    .rpc("start_game_round", {
      p_room_id: roomId
    });

  if (error) {
    console.error(
      "START GAME RPC ERROR:",
      error
    );

    throw new Error(
      error.message ||
      "Could not start the game."
    );
  }


  // -------------------------------------------------------
  // Get round returned by RPC.
  // -------------------------------------------------------

  const round =
    Array.isArray(data)
      ? data[0]
      : data;

  console.log(
    "RPC RETURNED:",
    data
  );


  if (!round || !round.id) {
    throw new Error(
      "Game round was not created."
    );
  }


  console.log(
    "GAME ROUND CREATED:",
    round.id
  );


  // -------------------------------------------------------
  // IMPORTANT:
  // Re-read the room after RPC.
  // -------------------------------------------------------

  const updatedRoom =
    await getLobbyRoom(roomId);

  console.log(
    "UPDATED ROOM:",
    updatedRoom
  );


  // -------------------------------------------------------
  // CRITICAL CHECK #1
  // -------------------------------------------------------

  if (!updatedRoom.current_round_id) {

    console.error(
      "RPC created a round but current_round_id is NULL.",
      {
        roomId,
        roundId: round.id,
        room: updatedRoom
      }
    );

    throw new Error(
      "Game round was created, but the room current_round_id was not saved."
    );
  }


  // -------------------------------------------------------
  // CRITICAL CHECK #2
  // -------------------------------------------------------

  if (
    updatedRoom.current_round_id !== round.id
  ) {

    console.error(
      "Round ID mismatch.",
      {
        returnedRound: round.id,
        roomRound: updatedRoom.current_round_id
      }
    );

    throw new Error(
      "Room current_round_id does not match the created round."
    );
  }


  // -------------------------------------------------------
  // Verify the round exists in the database.
  // -------------------------------------------------------

  const {
    data: roundRows,
    error: roundError
  } = await window.supabaseClient
    .from("game_rounds")
    .select("*")
    .eq("id", round.id)
    .eq("room_id", roomId)
    .limit(1);

  if (roundError) {
    throw roundError;
  }

  if (
    !roundRows ||
    roundRows.length === 0
  ) {
    throw new Error(
      "The created game round could not be found."
    );
  }


  const verifiedRound =
    roundRows[0];


  // -------------------------------------------------------
  // If RPC returned a round that is not playing,
  // activate it before allowing the room to continue.
  // -------------------------------------------------------

  if (verifiedRound.status !== "playing") {

    const {
      data: activatedRounds,
      error: activateError
    } = await window.supabaseClient
      .from("game_rounds")
      .update({
        status: "playing",
        started_at:
          verifiedRound.started_at ||
          new Date().toISOString()
      })
      .eq("id", verifiedRound.id)
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
  // Re-read room one final time.
  // -------------------------------------------------------

  const finalRoom =
    await getLobbyRoom(roomId);


  // -------------------------------------------------------
  // FINAL SAFETY CHECK
  // -------------------------------------------------------

  if (!finalRoom.current_round_id) {
    throw new Error(
      "Game cannot start because current_round_id is missing."
    );
  }

  if (
    finalRoom.current_round_id !== verifiedRound.id
  ) {
    throw new Error(
      "Game room and game round IDs do not match."
    );
  }


  // -------------------------------------------------------
  // If the RPC didn't change the room to playing,
  // safely change it now because the round is verified.
  // -------------------------------------------------------

  if (finalRoom.status !== "playing") {

    const {
      data: playingRooms,
      error: playingError
    } = await window.supabaseClient
      .from("game_rooms")
      .update({
        status: "playing",
        started_at:
          finalRoom.started_at ||
          new Date().toISOString(),
        current_round_id:
          finalRoom.current_round_id
      })
      .eq("id", roomId)
      .eq("host_id", hostId)
      .select()
      .limit(1);

    if (playingError) {
      throw playingError;
    }

    if (
      !playingRooms ||
      playingRooms.length === 0
    ) {
      throw new Error(
        "Could not change the room to playing."
      );
    }

    console.log(
      "ROOM CHANGED TO PLAYING:",
      playingRooms[0]
    );
  }


  console.log("================================");
  console.log("GAME STARTED SUCCESSFULLY");
  console.log("ROOM:", roomId);
  console.log("ROUND:", verifiedRound.id);
  console.log(
    "CURRENT ROUND:",
    finalRoom.current_round_id
  );
  console.log("================================");


  return verifiedRound;
}


// =========================================================
// START GAME
// =========================================================

async function beginStartSequence(
  roomId
) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const user =
    await getLobbyUser();

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
  // ROOM IS ALREADY PLAYING
  // -------------------------------------------------------

  if (room.status === "playing") {

    // Healthy playing room.
    if (room.current_round_id) {

      const round =
        await getCurrentGameRound(roomId);

      if (round) {
        return room;
      }
    }


    // -----------------------------------------------------
    // IMPORTANT:
    // The room is playing but current_round_id is NULL.
    //
    // This repairs the exact broken state you showed.
    // -----------------------------------------------------

    console.warn(
      "Room is playing but current_round_id is missing."
    );

    console.log(
      "Attempting to repair room by starting a round..."
    );


    const repairedRound =
      await createGameRound(
        roomId,
        user.id
      );


    room =
      await getLobbyRoom(roomId);


    if (
      !room.current_round_id ||
      room.current_round_id !== repairedRound.id
    ) {
      throw new Error(
        "Could not repair the room. current_round_id is still missing."
      );
    }


    return room;
  }


  // -------------------------------------------------------
  // ROOM IS STARTING
  // -------------------------------------------------------

  if (room.status === "starting") {

    if (room.current_round_id) {

      const round =
        await getCurrentGameRound(roomId);

      if (round) {

        // Make sure round is playing.
        if (round.status !== "playing") {

          const {
            error: activateError
          } = await window.supabaseClient
            .from("game_rounds")
            .update({
              status: "playing",
              started_at:
                round.started_at ||
                new Date().toISOString()
            })
            .eq("id", round.id);

          if (activateError) {
            throw activateError;
          }
        }


        // Change room to playing.
        const {
          data: playingRooms,
          error: playingError
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

        if (playingError) {
          throw playingError;
        }

        if (
          playingRooms &&
          playingRooms.length > 0
        ) {
          return playingRooms[0];
        }

        return await getLobbyRoom(roomId);
      }
    }


    // No valid round.
    const round =
      await createGameRound(
        roomId,
        user.id
      );

    room =
      await getLobbyRoom(roomId);

    if (
      !room.current_round_id ||
      room.current_round_id !== round.id
    ) {
      throw new Error(
        "Round was created but could not be attached to the room."
      );
    }

    return room;
  }


  // -------------------------------------------------------
  // MUST BE WAITING
  // -------------------------------------------------------

  if (room.status !== "waiting") {
    throw new Error(
      `This room cannot be started right now. Current status: ${room.status}`
    );
  }


  // -------------------------------------------------------
  // GET ACTIVE PLAYERS
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
  // CHECK ALL READY
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


  // -------------------------------------------------------
  // CREATE ROUND
  // -------------------------------------------------------
  //
  // The RPC handles the actual transition.
  //
  // We DO NOT manually change waiting → starting here.
  //
  // This prevents the old flow from fighting with the RPC.
  // -------------------------------------------------------

  const round =
    await createGameRound(
      roomId,
      user.id
    );


  // -------------------------------------------------------
  // FINAL ROOM CHECK
  // -------------------------------------------------------

  room =
    await getLobbyRoom(roomId);


  if (!room.current_round_id) {
    throw new Error(
      "Game started but current_round_id is missing."
    );
  }


  if (
    room.current_round_id !== round.id
  ) {
    throw new Error(
      "Game started but the room points to a different round."
    );
  }


  if (room.status !== "playing") {
    throw new Error(
      `Round exists but room status is ${room.status}.`
    );
  }


  console.log(
    "FINAL STARTED ROOM:",
    room
  );


  return room;
}


// =========================================================
// MARK ROOM AS PLAYING
// =========================================================
//
// Kept for compatibility with existing lobby/game code.
//
// If another JS file calls markRoomPlaying(), this function
// verifies the round before allowing the room to become
// "playing".
// =========================================================

async function markRoomPlaying(
  roomId
) {
  const user =
    await getLobbyUser();

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

      console.warn(
        "Room is playing without a round. Repairing..."
      );

      const round =
        await createGameRound(
          roomId,
          user.id
        );

      room =
        await getLobbyRoom(roomId);

      if (
        !room.current_round_id ||
        room.current_round_id !== round.id
      ) {
        throw new Error(
          "Could not repair the playing room."
        );
      }
    }

    return room;
  }


  // -------------------------------------------------------
  // If waiting, use the normal start sequence.
  // -------------------------------------------------------

  if (room.status === "waiting") {
    return await beginStartSequence(roomId);
  }


  // -------------------------------------------------------
  // Starting state.
  // -------------------------------------------------------

  if (room.status !== "starting") {
    throw new Error(
      `Room cannot enter the game right now. Current status: ${room.status}`
    );
  }


  // -------------------------------------------------------
  // Make sure current_round_id exists.
  // -------------------------------------------------------

  if (!room.current_round_id) {

    const round =
      await createGameRound(
        roomId,
        user.id
      );

    room =
      await getLobbyRoom(roomId);

    if (
      !room.current_round_id ||
      room.current_round_id !== round.id
    ) {
      throw new Error(
        "Round was created but current_round_id is missing."
      );
    }
  }


  // -------------------------------------------------------
  // Verify round.
  // -------------------------------------------------------

  const round =
    await getCurrentGameRound(roomId);

  if (!round) {
    throw new Error(
      "The room references a round that does not exist."
    );
  }


  // -------------------------------------------------------
  // Activate round if necessary.
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
      .eq("id", round.id)
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
  // Change room to playing.
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
  // Another request may have changed it already.
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
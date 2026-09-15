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
    .select(
      "id, user_id, is_ready, is_host, joined_at"
    )
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
            index %
            PLAYER_COLORS.length
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
  // Check if room already has an active round
  // -------------------------------------------------------

  const {
    data: roomRows,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select(
      "id, host_id, current_round_id"
    )
    .eq("id", roomId)
    .limit(1);

  if (roomError) {
    throw roomError;
  }

  if (
    !roomRows ||
    roomRows.length === 0
  ) {
    throw new Error(
      "Room not found."
    );
  }

  const currentRoom =
    roomRows[0];


  if (
    currentRoom.host_id !== hostId
  ) {
    throw new Error(
      "Only the host can create the game round."
    );
  }


  // -------------------------------------------------------
  // If a round already exists, use it
  // -------------------------------------------------------

  if (
    currentRoom.current_round_id
  ) {

    const {
      data: existingRounds,
      error: existingError
    } = await window.supabaseClient
      .from("game_rounds")
      .select("*")
      .eq(
        "id",
        currentRoom.current_round_id
      )
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
  }


  // -------------------------------------------------------
  // Determine round number
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
        "starting",

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
  // Save round ID into room
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      current_round_id:
        round.id
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

  if (updateError) {

    // Cleanup round if room update failed
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


  console.log(
    "Game round created:",
    round
  );

  console.log(
    "Room current_round_id:",
    round.id
  );


  return round;
}


// =========================================================
// START GAME
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


  // -------------------------------------------------------
  // Get room
  // -------------------------------------------------------

  const {
    data: rooms,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select(`
      id,
      host_id,
      status,
      player_limit,
      current_round_id
    `)
    .eq("id", roomId)
    .limit(1);

  if (roomError) {
    throw roomError;
  }

  if (
    !rooms ||
    rooms.length === 0
  ) {
    throw new Error(
      "Room not found."
    );
  }

  const room =
    rooms[0];


  // -------------------------------------------------------
  // Check host
  // -------------------------------------------------------

  if (
    room.host_id !== user.id
  ) {
    throw new Error(
      "Only the host can start the game."
    );
  }


  // -------------------------------------------------------
  // Already starting
  // -------------------------------------------------------

  if (
    room.status === "starting"
  ) {

    console.log(
      "Room is already starting."
    );

    return room;

  }


  // -------------------------------------------------------
  // Already playing
  // -------------------------------------------------------

  if (
    room.status === "playing"
  ) {

    console.log(
      "Room is already playing."
    );

    return room;

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
  // Check all ready
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


  // =======================================================
  // CREATE ROUND BEFORE STARTING
  // =======================================================

  const round =
    await createGameRound(
      roomId,
      user.id
    );


  // -------------------------------------------------------
  // Change waiting → starting
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      status:
        "starting",

      current_round_id:
        round.id
    })
    .eq(
      "id",
      roomId
    )
    .eq(
      "host_id",
      user.id
    )
    .eq(
      "status",
      "waiting"
    )
    .select()
    .limit(1);

  if (updateError) {
    throw updateError;
  }


  // -------------------------------------------------------
  // If another request already changed status
  // -------------------------------------------------------

  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    const {
      data: latestRooms,
      error: latestError
    } = await window.supabaseClient
      .from("game_rooms")
      .select(`
        id,
        host_id,
        status,
        player_limit,
        current_round_id
      `)
      .eq(
        "id",
        roomId
      )
      .limit(1);

    if (latestError) {
      throw latestError;
    }

    const latestRoom =
      latestRooms?.[0];

    if (
      latestRoom?.status ===
      "starting"
    ) {

      return latestRoom;

    }

    throw new Error(
      "The room could not be started."
    );

  }


  console.log(
    "Room changed to STARTING:",
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

  const user =
    await getLobbyUser();


  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
  }


  // -------------------------------------------------------
  // Get room
  // -------------------------------------------------------

  const {
    data: rooms,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select(`
      id,
      host_id,
      status,
      current_round_id
    `)
    .eq(
      "id",
      roomId
    )
    .limit(1);

  if (roomError) {
    throw roomError;
  }

  if (
    !rooms ||
    rooms.length === 0
  ) {
    throw new Error(
      "Room not found."
    );
  }

  const room =
    rooms[0];


  if (
    room.host_id !== user.id
  ) {
    throw new Error(
      "Only the host can start the game."
    );
  }


  // -------------------------------------------------------
  // Already playing
  // -------------------------------------------------------

  if (
    room.status === "playing"
  ) {
    return room;
  }


  if (
    room.status !== "starting"
  ) {

    throw new Error(
      `Room cannot enter the game right now. Current status: ${room.status}`
    );

  }


  // -------------------------------------------------------
  // Make sure round exists
  // -------------------------------------------------------

  if (
    !room.current_round_id
  ) {

    const round =
      await createGameRound(
        roomId,
        user.id
      );

    room.current_round_id =
      round.id;

  }


  // -------------------------------------------------------
  // Update game round
  // -------------------------------------------------------

  const {
    data: roundRows,
    error: roundError
  } = await window.supabaseClient
    .from("game_rounds")
    .update({

      status:
        "playing",

      started_at:
        new Date().toISOString()

    })
    .eq(
      "id",
      room.current_round_id
    )
    .select()
    .limit(1);

  if (roundError) {
    throw roundError;
  }

  if (
    !roundRows ||
    roundRows.length === 0
  ) {

    throw new Error(
      "Could not activate the game round."
    );

  }


  // -------------------------------------------------------
  // Update room
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error
  } = await window.supabaseClient
    .from("game_rooms")
    .update({

      status:
        "playing",

      started_at:
        new Date().toISOString(),

      current_round_id:
        room.current_round_id

    })
    .eq(
      "id",
      roomId
    )
    .eq(
      "host_id",
      user.id
    )
    .eq(
      "status",
      "starting"
    )
    .select()
    .limit(1);

  if (error) {
    throw error;
  }


  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    const {
      data: latestRooms
    } = await window.supabaseClient
      .from("game_rooms")
      .select(`
        id,
        host_id,
        status,
        current_round_id,
        started_at
      `)
      .eq(
        "id",
        roomId
      )
      .limit(1);

    const latestRoom =
      latestRooms?.[0];

    if (
      latestRoom?.status ===
      "playing"
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
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

    console.error(
      "Auth error:",
      error
    );

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
      (player) => player.user_id
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
          (p) =>
            p.id === rp.user_id
        );


      const character =
        characters?.find(
          (c) =>
            c.user_id === rp.user_id
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
  // Get the room
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
      player_limit
    `)
    .eq("id", roomId)
    .limit(1);


  if (roomError) {

    console.error(
      "Get room before start error:",
      roomError
    );

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


  console.log(
    "Room before start:",
    room
  );


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
  // Check status
  // -------------------------------------------------------

  if (
    room.status !== "waiting"
  ) {

    console.warn(
      "Cannot start room. Current status:",
      room.status
    );


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
    .eq("room_id", roomId)
    .is("left_at", null);


  if (playersError) {

    console.error(
      "Get room players error:",
      playersError
    );

    throw playersError;

  }


  if (
    !players ||
    players.length === 0
  ) {

    throw new Error(
      "There are no players in this room."
    );

  }


  // -------------------------------------------------------
  // Minimum 2 players
  // -------------------------------------------------------

  if (
    players.length < 2
  ) {

    throw new Error(
      "At least 2 players are required to start the game."
    );

  }


  // -------------------------------------------------------
  // Check all players are ready
  // -------------------------------------------------------

  const allReady =
    players.every(
      (player) =>
        player.is_ready === true
    );


  if (!allReady) {

    const notReady =
      players.filter(
        (player) =>
          !player.is_ready
      ).length;


    throw new Error(
      `${notReady} player${
        notReady === 1 ? "" : "s"
      } ${notReady === 1 ? "is" : "are"} not ready.`
    );

  }


  // -------------------------------------------------------
  // Change waiting → starting
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      status: "starting"
    })
    .eq("id", roomId)
    .eq("host_id", user.id)
    .eq("status", "waiting")
    .select()
    .limit(1);


  if (updateError) {

    console.error(
      "Start room error:",
      updateError
    );

    throw updateError;

  }


  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    throw new Error(
      "The room could not be started. It may have already been started."
    );

  }


  console.log(
    "Room changed to starting:",
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


  const {
    data: rooms,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select(`
      id,
      host_id,
      status
    `)
    .eq("id", roomId)
    .limit(1);


  if (roomError) {

    console.error(
      "Get room before playing error:",
      roomError
    );

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


  if (
    room.status !== "starting"
  ) {

    throw new Error(
      `Room cannot enter the game right now. Current status: ${room.status}`
    );

  }


  const {
    data: updatedRooms,
    error
  } = await window.supabaseClient
    .from("game_rooms")
    .update({
      status: "playing",
      started_at:
        new Date().toISOString()
    })
    .eq("id", roomId)
    .eq("host_id", user.id)
    .eq("status", "starting")
    .select()
    .limit(1);


  if (error) {

    console.error(
      "Mark room playing error:",
      error
    );

    throw error;

  }


  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    throw new Error(
      "Could not start the game."
    );

  }


  return updatedRooms[0];
}
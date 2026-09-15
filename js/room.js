/**
 * js/room.js
 * ---------------------------------------------------------
 * Room creation and joining.
 * ---------------------------------------------------------
 */

const ROOM_CODE_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";


// =========================================================
// GENERATE ROOM CODE
// =========================================================

function generateRoomCode() {

  let code = "BMB";

  for (let i = 0; i < 3; i++) {

    code += ROOM_CODE_CHARS[
      Math.floor(
        Math.random() * ROOM_CODE_CHARS.length
      )
    ];

  }

  return code;
}


// =========================================================
// GENERATE UNIQUE ROOM CODE
// =========================================================

async function generateUniqueRoomCode() {

  for (let attempt = 0; attempt < 8; attempt++) {

    const code = generateRoomCode();

    const {
      data,
      error
    } = await window.supabaseClient
      .from("game_rooms")
      .select("id")
      .eq("room_code", code)
      .limit(1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return code;
    }

  }

  throw new Error(
    "Could not generate a unique room code. Please try again."
  );
}


// =========================================================
// CREATE ROOM
// =========================================================

async function createRoom({
  roomName,
  playerLimit,
  map,
  roundDurationSeconds,
  hostId
}) {

  roomName =
    String(roomName || "").trim();


  playerLimit =
    Number(playerLimit);


  roundDurationSeconds =
    Number(roundDurationSeconds);


  if (!roomName) {
    throw new Error(
      "Please enter a room name."
    );
  }


  if (
    !Number.isInteger(playerLimit) ||
    playerLimit < 2 ||
    playerLimit > 10
  ) {
    throw new Error(
      "Player limit must be between 2 and 10."
    );
  }


  if (
    ![180, 300, 600].includes(
      roundDurationSeconds
    )
  ) {
    throw new Error(
      "Invalid round duration."
    );
  }


  if (
    !["arena1", "arena2", "arena3"].includes(map)
  ) {
    throw new Error(
      "Invalid map."
    );
  }


  if (!hostId) {
    throw new Error(
      "You must be logged in to create a room."
    );
  }


  // Generate room code
  const roomCode =
    await generateUniqueRoomCode();


  // Create room
  const {
    data: room,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .insert({
      room_code: roomCode,
      room_name: roomName,
      host_id: hostId,
      player_limit: playerLimit,
      map: map,
      round_duration_seconds:
        roundDurationSeconds,
      status: "waiting"
    })
    .select()
    .limit(1);


  if (roomError) {
    console.error(
      "Create room error:",
      roomError
    );

    throw roomError;
  }


  if (!room || room.length === 0) {
    throw new Error(
      "Room was created but could not be loaded."
    );
  }


  const createdRoom =
    room[0];


  // Add host as first player
  const {
    error: joinError
  } = await window.supabaseClient
    .from("room_players")
    .insert({
      room_id: createdRoom.id,
      user_id: hostId,
      is_host: true,
      is_ready: false
    });


  if (joinError) {

    console.error(
      "Add host to room error:",
      joinError
    );


    // Remove room if host could not be added
    await window.supabaseClient
      .from("game_rooms")
      .delete()
      .eq("id", createdRoom.id);


    throw joinError;
  }


  return createdRoom;
}


// =========================================================
// GET ROOM BY CODE
// =========================================================

async function getRoomByCode(code) {

  const cleanCode =
    String(code || "")
      .trim()
      .toUpperCase();


  if (!cleanCode) {
    return null;
  }


  const {
    data,
    error
  } = await window.supabaseClient
    .from("game_rooms")
    .select("*")
    .eq("room_code", cleanCode)
    .limit(1);


  if (error) {
    throw error;
  }


  return data?.[0] || null;
}


// =========================================================
// JOIN ROOM
// =========================================================

async function joinRoomByCode(
  code,
  userId
) {

  if (!userId) {
    throw new Error(
      "You must be logged in to join a room."
    );
  }


  const room =
    await getRoomByCode(code);


  if (!room) {
    throw new Error(
      "ROOM NOT FOUND"
    );
  }


  // Room must still be waiting
  if (room.status !== "waiting") {
    throw new Error(
      "This room has already started."
    );
  }


  // Check if user is already in room
  const {
    data: existingRows,
    error: existingError
  } = await window.supabaseClient
    .from("room_players")
    .select("id, left_at, is_ready, is_host")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .limit(1);


  if (existingError) {
    throw existingError;
  }


  const existing =
    existingRows?.[0];


  // Existing player
  if (existing) {

    // Rejoin
    if (existing.left_at) {

      const {
        error: rejoinError
      } = await window.supabaseClient
        .from("room_players")
        .update({
          left_at: null
        })
        .eq("id", existing.id);


      if (rejoinError) {
        throw rejoinError;
      }

    }


    return room;
  }


  // Count active players
  const {
    count,
    error: countError
  } = await window.supabaseClient
    .from("room_players")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("room_id", room.id)
    .is("left_at", null);


  if (countError) {
    throw countError;
  }


  if (
    (count || 0) >= room.player_limit
  ) {
    throw new Error(
      "ROOM FULL"
    );
  }


  // Add player
  const {
    error: insertError
  } = await window.supabaseClient
    .from("room_players")
    .insert({
      room_id: room.id,
      user_id: userId,
      is_host: false,
      is_ready: false
    });


  if (insertError) {
    throw insertError;
  }


  return room;
}
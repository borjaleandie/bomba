/**
 * js/room.js
 * ---------------------------------------------------------
 * Room creation and joining. Realtime lobby syncing lives in
 * js/lobby.js / js/realtime.js (next phase) — this file only
 * handles the create/join transactions themselves.
 * ---------------------------------------------------------
 */

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 to avoid confusion

function generateRoomCode() {
  let code = "BMB";
  for (let i = 0; i < 3; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

/**
 * Generates a room code, retrying if it happens to collide with
 * an existing active room (extremely rare, but handled).
 */
async function generateUniqueRoomCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await window.supabaseClient
      .from("game_rooms")
      .select("id")
      .eq("room_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!data) return code; // not taken
  }
  throw new Error("Could not generate a unique room code. Please try again.");
}

/**
 * Create a new room and add the host as the first (unready) player.
 * Returns the created room row.
 */
async function createRoom({ roomName, playerLimit, map, roundDurationSeconds, hostId }) {
  roomName = roomName.trim();
  if (!roomName) throw new Error("Please enter a room name.");
  if (playerLimit < 2 || playerLimit > 10) throw new Error("Player limit must be between 2 and 10.");

  const roomCode = await generateUniqueRoomCode();

  const { data: room, error: roomError } = await window.supabaseClient
    .from("game_rooms")
    .insert({
      room_code: roomCode,
      room_name: roomName,
      host_id: hostId,
      player_limit: playerLimit,
      map,
      round_duration_seconds: roundDurationSeconds,
      status: "waiting",
    })
    .select()
    .single();

  if (roomError) throw roomError;

  const { error: joinError } = await window.supabaseClient
    .from("room_players")
    .insert({
      room_id: room.id,
      user_id: hostId,
      is_host: true,
      is_ready: false,
    });

  if (joinError) throw joinError;

  return room;
}

/**
 * Look up a room by its code (case-insensitive).
 * Returns null if not found.
 */
async function getRoomByCode(code) {
  const { data, error } = await window.supabaseClient
    .from("game_rooms")
    .select("*")
    .eq("room_code", code.trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Join a room by code. Throws user-friendly errors matching
 * your spec's ROOM NOT FOUND / ROOM FULL messages.
 */
async function joinRoomByCode(code, userId) {
  const room = await getRoomByCode(code);

  if (!room) {
    throw new Error("ROOM NOT FOUND");
  }

  if (room.status !== "waiting") {
    throw new Error("This room has already started.");
  }

  // Count current active players (left_at is null = still in the room)
  const { count, error: countError } = await window.supabaseClient
    .from("room_players")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .is("left_at", null);

  if (countError) throw countError;

  // If the player is already in this room (e.g. page refresh), let them back in.
  const { data: existing } = await window.supabaseClient
    .from("room_players")
    .select("id, left_at")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.left_at) {
      // Rejoin: clear left_at
      const { error: rejoinError } = await window.supabaseClient
        .from("room_players")
        .update({ left_at: null })
        .eq("id", existing.id);
      if (rejoinError) throw rejoinError;
    }
    return room; // already a member, just go to lobby
  }

  if (count >= room.player_limit) {
    throw new Error("ROOM FULL");
  }

  const { error: insertError } = await window.supabaseClient
    .from("room_players")
    .insert({ room_id: room.id, user_id: userId, is_host: false, is_ready: false });

  if (insertError) throw insertError;

  return room;
}

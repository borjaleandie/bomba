/**
 * js/lobby.js
 * ---------------------------------------------------------
 * Data-layer functions for the lobby page.
 * Works with the Supabase tables:
 *
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

/**
 * Make sure the user is authenticated.
 */
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

/**
 * Fetch every active player in a room.
 *
 * Gets:
 * - room_players
 * - profiles
 * - characters
 */
async function fetchRoomPlayers(roomId) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const { data: roomPlayers, error } =
    await window.supabaseClient
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

  if (!roomPlayers || roomPlayers.length === 0) {
    return [];
  }

  const userIds = roomPlayers.map(
    (player) => player.user_id
  );

  /*
   * Get profiles and characters separately.
   *
   * IMPORTANT:
   * The table is "profiles".
   *
   * IMPORTANT:
   * avatar_url is NOT selected because the
   * profiles table does not have that column.
   */
  const [
    { data: profiles, error: profileError },
    { data: characters, error: characterError }
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

  return roomPlayers.map((rp, index) => {
    const profile = profiles?.find(
      (p) => p.id === rp.user_id
    );

    const character = characters?.find(
      (c) => c.user_id === rp.user_id
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

/**
 * Toggle ready state for the current user.
 */
async function toggleReady(
  roomId,
  userId,
  newReadyState
) {
  const user = await getLobbyUser();

  /*
   * Don't allow one user to change another user's
   * ready status.
   */
  if (user.id !== userId) {
    throw new Error(
      "You can only change your own ready status."
    );
  }

  const { data, error } =
    await window.supabaseClient
      .from("room_players")
      .update({
        is_ready: Boolean(newReadyState)
      })
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

  if (error) {
    console.error(
      "Toggle ready error:",
      error
    );
    throw error;
  }

  if (!data) {
    throw new Error(
      "You are not currently in this room."
    );
  }

  return data;
}

/**
 * Leave the room.
 *
 * We don't delete the player row.
 * Instead we set left_at so the game can keep
 * the player's history.
 */
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

  const { data, error } =
    await window.supabaseClient
      .from("room_players")
      .update({
        left_at: new Date().toISOString()
      })
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

  if (error) {
    console.error(
      "Leave room error:",
      error
    );
    throw error;
  }

  return data;
}

/**
 * Host action:
 * Change room status from waiting → starting.
 */
async function beginStartSequence(roomId) {
  const user = await getLobbyUser();

  /*
   * First verify that the current user is the host.
   */
  const {
    data: room,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select(
      "id, host_id, status"
    )
    .eq("id", roomId)
    .single();

  if (roomError) {
    console.error(
      "Get room before start error:",
      roomError
    );
    throw roomError;
  }

  if (room.host_id !== user.id) {
    throw new Error(
      "Only the host can start the game."
    );
  }

  if (room.status !== "waiting") {
    throw new Error(
      "This room cannot be started right now."
    );
  }

  const { error } =
    await window.supabaseClient
      .from("game_rooms")
      .update({
        status: "starting"
      })
      .eq("id", roomId)
      .eq("host_id", user.id);

  if (error) {
    console.error(
      "Start room error:",
      error
    );
    throw error;
  }
}

/**
 * Host action:
 * Change room status from starting → playing.
 */
async function markRoomPlaying(roomId) {
  const user = await getLobbyUser();

  const {
    data: room,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select(
      "id, host_id, status"
    )
    .eq("id", roomId)
    .single();

  if (roomError) {
    console.error(
      "Get room before playing error:",
      roomError
    );
    throw roomError;
  }

  if (room.host_id !== user.id) {
    throw new Error(
      "Only the host can start the game."
    );
  }

  const { error } =
    await window.supabaseClient
      .from("game_rooms")
      .update({
        status: "playing",
        started_at:
          new Date().toISOString()
      })
      .eq("id", roomId)
      .eq("host_id", user.id);

  if (error) {
    console.error(
      "Mark room playing error:",
      error
    );
    throw error;
  }
}
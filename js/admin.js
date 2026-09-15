/**
 * js/admin.js
 * ---------------------------------------------------------
 * Admin dashboard queries and actions.
 * ---------------------------------------------------------
 */


// =========================================================
// ADMIN CHECK
// =========================================================

async function isCurrentUserAdmin(userId) {

  if (!userId) {
    return false;
  }

  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .limit(1);

  if (error) {
    console.error("Admin check error:", error);
    return false;
  }

  return data?.[0]?.role === "admin";
}


// =========================================================
// OVERVIEW COUNTS
// =========================================================

async function fetchOverviewCounts() {

  const [
    usersResult,
    activeRoomsResult,
    completedGamesResult,
    pendingReportsResult
  ] = await Promise.all([

    window.supabaseClient
      .from("profiles")
      .select("id", {
        count: "exact",
        head: true
      }),

    window.supabaseClient
      .from("game_rooms")
      .select("id", {
        count: "exact",
        head: true
      })
      .in("status", [
        "waiting",
        "starting",
        "playing"
      ]),

    window.supabaseClient
      .from("game_rounds")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("status", "finished"),

    window.supabaseClient
      .from("reports")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("status", "pending")

  ]);

  return {
    userCount: usersResult.count || 0,
    activeRoomCount: activeRoomsResult.count || 0,
    completedGameCount: completedGamesResult.count || 0,
    pendingReportCount: pendingReportsResult.count || 0
  };
}


// =========================================================
// USER MONITORING
// =========================================================

async function fetchUsers(searchTerm = "") {

  let query = window.supabaseClient
    .from("profiles")
    .select(`
      id,
      username,
      email,
      full_name,
      role,
      status,
      created_at,
      last_active,
      total_wins,
      total_kills,
      total_deaths
    `)
    .order("created_at", {
      ascending: false
    })
    .limit(200);


  if (searchTerm.trim()) {

    const term = searchTerm.trim();

    query = query.or(
      `username.ilike.%${term}%,email.ilike.%${term}%`
    );

  }


  const {
    data,
    error
  } = await query;


  if (error) {
    console.error(
      "Fetch users error:",
      error
    );

    throw error;
  }


  return data || [];
}


// =========================================================
// ENABLE / DISABLE USER
// =========================================================

async function setAccountStatus(
  userId,
  status
) {

  if (!userId) {
    throw new Error(
      "User ID is required."
    );
  }


  if (
    !["active", "disabled"].includes(status)
  ) {
    throw new Error(
      "Invalid account status."
    );
  }


  const {
    error
  } = await window.supabaseClient
    .from("profiles")
    .update({
      status: status
    })
    .eq("id", userId);


  if (error) {
    console.error(
      "Set account status error:",
      error
    );

    throw error;
  }
}


// =========================================================
// CHANGE USER ROLE
// =========================================================

async function setUserRole(
  userId,
  role
) {

  if (!userId) {
    throw new Error(
      "User ID is required."
    );
  }


  if (
    !["user", "admin"].includes(role)
  ) {
    throw new Error(
      "Invalid role."
    );
  }


  const {
    error
  } = await window.supabaseClient
    .from("profiles")
    .update({
      role: role
    })
    .eq("id", userId);


  if (error) {
    console.error(
      "Set user role error:",
      error
    );

    throw error;
  }
}


// =========================================================
// ROOM MONITORING
// =========================================================

async function fetchActiveRooms() {

  const {
    data: rooms,
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
      status,
      created_at,
      started_at
    `)
    .in("status", [
      "waiting",
      "starting",
      "playing"
    ])
    .order("created_at", {
      ascending: false
    });


  if (error) {
    throw error;
  }


  if (!rooms || rooms.length === 0) {
    return [];
  }


  const roomIds =
    rooms.map((r) => r.id);


  const {
    data: playerCounts,
    error: playerError
  } = await window.supabaseClient
    .from("room_players")
    .select("room_id")
    .in("room_id", roomIds)
    .is("left_at", null);


  if (playerError) {
    throw playerError;
  }


  const hostIds = [
    ...new Set(
      rooms.map((r) => r.host_id)
    )
  ];


  // Use profiles instead of public_profiles
  const {
    data: hosts,
    error: hostError
  } = await window.supabaseClient
    .from("profiles")
    .select("id, username")
    .in("id", hostIds);


  if (hostError) {
    throw hostError;
  }


  return rooms.map((r) => ({

    ...r,

    playerCount:
      (playerCounts || [])
        .filter(
          (p) => p.room_id === r.id
        )
        .length,

    hostUsername:
      hosts?.find(
        (h) => h.id === r.host_id
      )?.username ||
      "Unknown"

  }));
}


// =========================================================
// ROOM DETAIL
// =========================================================

async function fetchRoomDetail(roomId) {

  const {
    data: room,
    error
  } = await window.supabaseClient
    .from("game_rooms")
    .select("*")
    .eq("id", roomId)
    .limit(1);


  if (error) {
    throw error;
  }


  const players =
    await fetchRoomPlayers(roomId);


  return {
    room: room?.[0] || null,
    players: players || []
  };
}


// =========================================================
// CHAT MODERATION
// =========================================================

async function fetchRecentMessagesForModeration(
  searchTerm = ""
) {

  let query = window.supabaseClient
    .from("messages")
    .select(`
      id,
      room_id,
      user_id,
      message,
      deleted,
      created_at
    `)
    .order("created_at", {
      ascending: false
    })
    .limit(100);


  if (searchTerm.trim()) {

    query = query.ilike(
      "message",
      `%${searchTerm.trim()}%`
    );

  }


  const {
    data,
    error
  } = await query;


  if (error) {
    throw error;
  }


  if (!data || data.length === 0) {
    return [];
  }


  const userIds = [
    ...new Set(
      data
        .map((m) => m.user_id)
        .filter(Boolean)
    )
  ];


  const roomIds = [
    ...new Set(
      data
        .map((m) => m.room_id)
        .filter(Boolean)
    )
  ];


  const {
    data: profiles,
    error: profileError
  } = await window.supabaseClient
    .from("profiles")
    .select("id, username")
    .in("id", userIds);


  if (profileError) {
    throw profileError;
  }


  const {
    data: rooms,
    error: roomError
  } = await window.supabaseClient
    .from("game_rooms")
    .select("id, room_code")
    .in("id", roomIds);


  if (roomError) {
    throw roomError;
  }


  return data.map((m) => ({

    ...m,

    username:
      profiles?.find(
        (p) => p.id === m.user_id
      )?.username ||
      "Player",

    roomCode:
      rooms?.find(
        (r) => r.id === m.room_id
      )?.room_code ||
      "?"

  }));
}


// =========================================================
// DELETE MESSAGE
// =========================================================

async function adminDeleteMessage(
  messageId
) {

  if (!messageId) {
    throw new Error(
      "Message ID is required."
    );
  }


  const {
    error
  } = await window.supabaseClient
    .from("messages")
    .delete()
    .eq("id", messageId);


  if (error) {
    throw error;
  }
}


// =========================================================
// REPORTS
// =========================================================

async function fetchReports(
  statusFilter = "pending"
) {

  let query = window.supabaseClient
    .from("reports")
    .select(`
      id,
      reporter_id,
      reported_user_id,
      room_id,
      message_id,
      reason,
      status,
      created_at
    `)
    .order("created_at", {
      ascending: false
    });


  if (statusFilter !== "all") {

    query = query.eq(
      "status",
      statusFilter
    );

  }


  const {
    data,
    error
  } = await query;


  if (error) {
    throw error;
  }


  if (!data || data.length === 0) {
    return [];
  }


  const userIds = [
    ...new Set(
      [
        ...data.map(
          (r) => r.reporter_id
        ),

        ...data.map(
          (r) => r.reported_user_id
        )

      ].filter(Boolean)
    )
  ];


  const {
    data: profiles,
    error: profileError
  } = await window.supabaseClient
    .from("profiles")
    .select("id, username")
    .in("id", userIds);


  if (profileError) {
    throw profileError;
  }


  return data.map((r) => ({

    ...r,

    reporterUsername:
      profiles?.find(
        (p) => p.id === r.reporter_id
      )?.username ||
      "Unknown",

    reportedUsername:
      profiles?.find(
        (p) => p.id === r.reported_user_id
      )?.username ||
      null

  }));
}


// =========================================================
// UPDATE REPORT STATUS
// =========================================================

async function updateReportStatus(
  reportId,
  status
) {

  if (!reportId) {
    throw new Error(
      "Report ID is required."
    );
  }


  if (
    ![
      "pending",
      "reviewed",
      "resolved"
    ].includes(status)
  ) {
    throw new Error(
      "Invalid report status."
    );
  }


  const {
    error
  } = await window.supabaseClient
    .from("reports")
    .update({
      status: status
    })
    .eq("id", reportId);


  if (error) {
    throw error;
  }
}
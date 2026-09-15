/**
 * js/admin.js
 * ---------------------------------------------------------
 * All queries here rely on the is_admin() RLS policies set up
 * in Phase 4-5. If someone who isn't actually an admin somehow
 * loads this page, every one of these queries will simply
 * return empty/denied results — the client-side check in
 * admin.html is just for showing/hiding the UI, not security.
 * ---------------------------------------------------------
 */

async function isCurrentUserAdmin(userId) {
  const { data } = await window.supabaseClient.from("profiles").select("role").eq("id", userId).single();
  return data?.role === "admin";
}

// ---- Overview counts ----
async function fetchOverviewCounts() {
  const [{ count: userCount }, { count: activeRoomCount }, { count: completedGameCount }, { count: pendingReportCount }] = await Promise.all([
    window.supabaseClient.from("profiles").select("id", { count: "exact", head: true }),
    window.supabaseClient.from("game_rooms").select("id", { count: "exact", head: true }).in("status", ["waiting", "starting", "playing"]),
    window.supabaseClient.from("game_rounds").select("id", { count: "exact", head: true }).eq("status", "finished"),
    window.supabaseClient.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return { userCount, activeRoomCount, completedGameCount, pendingReportCount };
}

// ---- User monitoring ----
async function fetchUsers(searchTerm = "") {
  let query = window.supabaseClient
    .from("profiles")
    .select("id, username, email, full_name, role, account_status, created_at, last_active, total_wins, total_kills, total_deaths")
    .order("created_at", { ascending: false })
    .limit(200);

  if (searchTerm.trim()) {
    query = query.or(`username.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function setAccountStatus(userId, status) {
  const { error } = await window.supabaseClient.from("profiles").update({ account_status: status }).eq("id", userId);
  if (error) throw error;
}

async function setUserRole(userId, role) {
  const { error } = await window.supabaseClient.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}

// ---- Room monitoring ----
async function fetchActiveRooms() {
  const { data: rooms, error } = await window.supabaseClient
    .from("game_rooms")
    .select("id, room_code, room_name, host_id, player_limit, map, status, created_at, started_at")
    .in("status", ["waiting", "starting", "playing"])
    .order("created_at", { ascending: false });
  if (error) throw error;

  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length === 0) return [];

  const { data: playerCounts } = await window.supabaseClient
    .from("room_players")
    .select("room_id")
    .in("room_id", roomIds)
    .is("left_at", null);

  const hostIds = [...new Set(rooms.map((r) => r.host_id))];
  const { data: hosts } = await window.supabaseClient.from("public_profiles").select("id, username").in("id", hostIds);

  return rooms.map((r) => ({
    ...r,
    playerCount: playerCounts.filter((p) => p.room_id === r.id).length,
    hostUsername: hosts?.find((h) => h.id === r.host_id)?.username || "Unknown",
  }));
}

async function fetchRoomDetail(roomId) {
  const { data: room } = await window.supabaseClient.from("game_rooms").select("*").eq("id", roomId).single();
  const players = await fetchRoomPlayers(roomId); // reused from lobby.js
  return { room, players };
}

// ---- Chat moderation ----
async function fetchRecentMessagesForModeration(searchTerm = "") {
  let query = window.supabaseClient
    .from("messages")
    .select("id, room_id, user_id, message, deleted, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (searchTerm.trim()) query = query.ilike("message", `%${searchTerm}%`);

  const { data, error } = await query;
  if (error) throw error;
  if (data.length === 0) return [];

  const userIds = [...new Set(data.map((m) => m.user_id))];
  const roomIds = [...new Set(data.map((m) => m.room_id))];

  const [{ data: profiles }, { data: rooms }] = await Promise.all([
    window.supabaseClient.from("public_profiles").select("id, username").in("id", userIds),
    window.supabaseClient.from("game_rooms").select("id, room_code").in("id", roomIds),
  ]);

  return data.map((m) => ({
    ...m,
    username: profiles?.find((p) => p.id === m.user_id)?.username || "Player",
    roomCode: rooms?.find((r) => r.id === m.room_id)?.room_code || "?",
  }));
}

async function adminDeleteMessage(messageId) {
  const { error } = await window.supabaseClient.from("messages").delete().eq("id", messageId);
  if (error) throw error;
}

// ---- Reports ----
async function fetchReports(statusFilter = "pending") {
  let query = window.supabaseClient
    .from("reports")
    .select("id, reporter_id, reported_user_id, room_id, message_id, reason, status, created_at")
    .order("created_at", { ascending: false });
  if (statusFilter !== "all") query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) throw error;
  if (data.length === 0) return [];

  const userIds = [...new Set([...data.map((r) => r.reporter_id), ...data.map((r) => r.reported_user_id)].filter(Boolean))];
  const { data: profiles } = await window.supabaseClient.from("public_profiles").select("id, username").in("id", userIds);

  return data.map((r) => ({
    ...r,
    reporterUsername: profiles?.find((p) => p.id === r.reporter_id)?.username || "Unknown",
    reportedUsername: profiles?.find((p) => p.id === r.reported_user_id)?.username || null,
  }));
}

async function updateReportStatus(reportId, status) {
  const { error } = await window.supabaseClient.from("reports").update({ status }).eq("id", reportId);
  if (error) throw error;
}

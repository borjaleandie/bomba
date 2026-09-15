/**
 * js/scoreboard.js
 * ---------------------------------------------------------
 * player_scores read/write helpers + host-side round
 * finalization into game_results.
 *
 * SCORING RULE USED HERE: each elimination an attacker causes
 * counts as both a "kill" and a "hit" (+10 total) — this game
 * doesn't have partial/non-lethal blast damage, so the two
 * stats track the same event. A +50 bonus is added to the
 * winner's displayed score at round end (not written back into
 * player_scores, only into the game_results leaderboard).
 * ---------------------------------------------------------
 */

const KILL_SCORE = 10;
const WINNER_BONUS = 50;

async function ensurePlayerScoreRow(roundId, userId) {
  const { error } = await window.supabaseClient
    .from("player_scores")
    .insert({ round_id: roundId, user_id: userId })
    .select();
  // Ignore "already exists" (23505) — happens on page refresh mid-round
  if (error && error.code !== "23505") console.warn("ensurePlayerScoreRow:", error.message);
}

async function pushMyScore(roundId, userId, stats) {
  const { error } = await window.supabaseClient
    .from("player_scores")
    .update({
      kills: stats.kills,
      deaths: stats.deaths,
      bombs_picked_up: stats.bombsPickedUp,
      bombs_thrown: stats.bombsThrown,
      hits: stats.hits,
      score: stats.kills * KILL_SCORE,
      updated_at: new Date().toISOString(),
    })
    .eq("round_id", roundId)
    .eq("user_id", userId);
  if (error) console.warn("pushMyScore:", error.message);
}

/**
 * HOST ONLY: called once when the round timer hits zero.
 * Marks the round/room finished and writes the final
 * leaderboard snapshot into game_results.
 */
async function finalizeRoundAsHost(roomId, roundId) {
  // Guarded with .eq('status','active') so if this somehow
  // runs twice, the second call simply updates 0 rows.
  await window.supabaseClient
    .from("game_rounds")
    .update({ status: "finished", ended_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("status", "active");

  const { data: scores, error: scoresError } = await window.supabaseClient
    .from("player_scores")
    .select("user_id, kills, deaths, bombs_picked_up, bombs_thrown, hits, score")
    .eq("round_id", roundId);
  if (scoresError) { console.error(scoresError); return; }

  const userIds = scores.map((s) => s.user_id);
  const { data: profiles } = await window.supabaseClient
    .from("public_profiles").select("id, username").in("id", userIds);

  let leaderboard = scores
    .map((s) => ({
      user_id: s.user_id,
      username: profiles?.find((p) => p.id === s.user_id)?.username || "Player",
      kills: s.kills,
      deaths: s.deaths,
      score: s.score,
    }))
    .sort((a, b) => b.score - a.score);

  if (leaderboard.length > 0) {
    leaderboard[0] = { ...leaderboard[0], score: leaderboard[0].score + WINNER_BONUS };
  }
  const winnerId = leaderboard.length > 0 ? leaderboard[0].user_id : null;

  const { error: insertError } = await window.supabaseClient
    .from("game_results")
    .insert({ round_id: roundId, room_id: roomId, winner_id: winnerId, leaderboard });
  if (insertError && insertError.code !== "23505") console.warn("finalizeRoundAsHost insert:", insertError.message);

  await window.supabaseClient
    .from("game_rooms")
    .update({ status: "finished", ended_at: new Date().toISOString() })
    .eq("id", roomId);
}

/**
 * Every client (host or not) waits for the game_results row to
 * exist, then redirects to the results page. Polling (rather
 * than only relying on a broadcast message) means this works
 * correctly even for a client that reconnects mid-finalization.
 */
async function waitForRoundResultsAndRedirect(roundId) {
  for (let i = 0; i < 20; i++) {
    const { data } = await window.supabaseClient
      .from("game_results").select("id").eq("round_id", roundId).maybeSingle();
    if (data) { window.location.href = `results.html?round=${roundId}`; return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  window.location.href = `results.html?round=${roundId}`; // fallback, results.html handles "not found yet"
}

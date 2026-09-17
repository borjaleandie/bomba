/**
 * js/reports.js
 * ---------------------------------------------------------
 * Reports + Game Results
 *
 * Reports are stored in:
 *   reports
 *
 * Final game results are stored in:
 *   game_results
 *
 * IMPORTANT:
 * - No game_scores table is required.
 * - Scores are collected by game.js.
 * - The host creates the final game_results row.
 */


/* =========================================================
   SUBMIT REPORT
   ========================================================= */

async function submitReport({
  reporterId,
  reportedUserId = null,
  roomId = null,
  messageId = null,
  reason
}) {
  reason = (reason || "").trim();

  if (!reason) {
    throw new Error("Please provide a reason.");
  }

  const { error } = await window.supabaseClient
    .from("reports")
    .insert({
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      room_id: roomId,
      message_id: messageId,
      reason
    });

  if (error) {
    console.error("submitReport error:", error);
    throw error;
  }

  return true;
}


/* =========================================================
   FINALIZE GAME ROUND
   ========================================================= */

async function finalizeRoundAsHost(roomId, roundId) {
  if (!roomId) {
    throw new Error("Missing room ID.");
  }

  if (!roundId) {
    throw new Error("Missing round ID.");
  }

  console.log("=================================");
  console.log("FINALIZING ROUND");
  console.log("Room:", roomId);
  console.log("Round:", roundId);
  console.log("=================================");

  /*
   * game.js keeps the current player's score in myScore.
   */

  let myFinalScore = {
    kills: 0,
    deaths: 0,
    bombsPickedUp: 0,
    bombsThrown: 0,
    hits: 0
  };

  if (typeof myScore !== "undefined" && myScore) {
    myFinalScore = {
      kills: Number(myScore.kills || 0),
      deaths: Number(myScore.deaths || 0),
      bombsPickedUp: Number(myScore.bombsPickedUp || 0),
      bombsThrown: Number(myScore.bombsThrown || 0),
      hits: Number(myScore.hits || 0)
    };
  }

  /*
   * Get all players in this room.
   */

  const { data: players, error: playersError } =
    await window.supabaseClient
      .from("room_players")
      .select(`
        user_id,
        profiles (
          username,
          full_name,
          avatar_url
        )
      `)
      .eq("room_id", roomId)
      .is("left_at", null);

  if (playersError) {
    console.error(
      "Could not load room players:",
      playersError
    );

    throw playersError;
  }

  if (!players || players.length === 0) {
    throw new Error(
      "No players were found in this room."
    );
  }

  /*
   * IMPORTANT:
   *
   * Currently game.js only keeps detailed score locally.
   * Therefore the host's score is known here.
   *
   * Other players are given zero unless your realtime
   * system has already been extended to synchronize scores.
   *
   * We will fix synchronized scores in the next game.js
   * replacement.
   */

  const leaderboard = players.map((player) => {

    const profile = player.profiles || {};

    const isMe =
      typeof currentUser !== "undefined" &&
      currentUser &&
      player.user_id === currentUser.id;

    const score = isMe
      ? myFinalScore
      : {
          kills: 0,
          deaths: 0,
          bombsPickedUp: 0,
          bombsThrown: 0,
          hits: 0
        };

    const points =
      score.kills * 100 +
      score.hits * 10 +
      score.bombsPickedUp * 2 +
      score.bombsThrown -
      score.deaths * 25;

    return {
      user_id: player.user_id,

      username:
        profile.username ||
        profile.full_name ||
        "Player",

      full_name:
        profile.full_name || "",

      avatar_url:
        profile.avatar_url || null,

      kills: score.kills,
      deaths: score.deaths,
      bombs_picked_up: score.bombsPickedUp,
      bombs_thrown: score.bombsThrown,
      hits: score.hits,

      score: points
    };
  });


  /*
   * Sort leaderboard.
   */

  leaderboard.sort((a, b) => {

    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.kills !== a.kills) {
      return b.kills - a.kills;
    }

    return a.deaths - b.deaths;
  });


  /*
   * Winner.
   */

  const winnerId =
    leaderboard.length > 0
      ? leaderboard[0].user_id
      : null;


  /*
   * Check whether game_results already exists.
   */

  const { data: existingResult } =
    await window.supabaseClient
      .from("game_results")
      .select("*")
      .eq("round_id", roundId)
      .maybeSingle();


  if (existingResult) {

    console.log(
      "Game result already exists.",
      existingResult
    );

    return existingResult;
  }


  /*
   * Create game_results.
   */

  const { data: result, error: resultError } =
    await window.supabaseClient
      .from("game_results")
      .insert({
        round_id: roundId,
        room_id: roomId,
        winner_id: winnerId,
        leaderboard: leaderboard
      })
      .select("*")
      .single();


  if (resultError) {

    console.error(
      "FAILED TO CREATE GAME RESULT:",
      resultError
    );

    throw resultError;
  }


  console.log(
    "================================="
  );

  console.log(
    "GAME RESULT CREATED:",
    result
  );

  console.log(
    "================================="
  );


  /*
   * Mark round finished.
   */

  const { error: roundError } =
    await window.supabaseClient
      .from("game_rounds")
      .update({
        status: "finished",
        ended_at: new Date().toISOString()
      })
      .eq("id", roundId);


  if (roundError) {
    console.warn(
      "Could not update game_rounds:",
      roundError
    );
  }


  /*
   * Mark room finished.
   */

  const { error: roomError } =
    await window.supabaseClient
      .from("game_rooms")
      .update({
        status: "finished"
      })
      .eq("id", roomId);


  if (roomError) {
    console.warn(
      "Could not update game_rooms:",
      roomError
    );
  }


  return result;
}


/* =========================================================
   WAIT FOR RESULTS
   ========================================================= */

async function waitForRoundResultsAndRedirect(
  roundId,
  maxAttempts = 20
) {
  if (!roundId) {
    throw new Error("Missing round ID.");
  }

  console.log(
    "Waiting for results..."
  );


  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {

    const { data, error } =
      await window.supabaseClient
        .from("game_results")
        .select("id")
        .eq("round_id", roundId)
        .maybeSingle();


    if (error) {

      console.warn(
        `Result check ${attempt}/${maxAttempts}:`,
        error
      );

    } else if (data) {

      console.log(
        "RESULT FOUND!"
      );

      window.location.href =
        `results.html?round=${encodeURIComponent(roundId)}`;

      return true;
    }


    /*
     * Wait one second.
     */

    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );
  }


  /*
   * Even if the result wasn't found, go to results page.
   */

  window.location.href =
    `results.html?round=${encodeURIComponent(roundId)}`;

  return false;
}


/* =========================================================
   GLOBAL EXPORTS
   ========================================================= */

window.submitReport =
  submitReport;

window.finalizeRoundAsHost =
  finalizeRoundAsHost;

window.waitForRoundResultsAndRedirect =
  waitForRoundResultsAndRedirect;


console.log(
  "reports.js loaded successfully."
);
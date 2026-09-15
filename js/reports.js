/**
 * js/reports.js
 * Submitting reports (player, message, or username).
 * Reviewing reports is an ADMIN feature — built in the admin phase.
 */

async function submitReport({ reporterId, reportedUserId = null, roomId = null, messageId = null, reason }) {
  reason = (reason || "").trim();
  if (!reason) throw new Error("Please provide a reason.");

  const { error } = await window.supabaseClient
    .from("reports")
    .insert({
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      room_id: roomId,
      message_id: messageId,
      reason,
    });
  if (error) throw error;
}

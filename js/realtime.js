/**
 * js/realtime.js
 * ---------------------------------------------------------
 * Reusable helper for subscribing to a room's realtime channel.
 * Combines TWO Supabase Realtime features on one channel:
 *
 * 1. Postgres Changes — fires when rows in room_players /
 *    game_rooms actually change in the database (joins,
 *    ready-toggles, room status changes). This is the
 *    "source of truth" data.
 *
 * 2. Presence — a lightweight, DB-free way to know who is
 *    ACTUALLY connected right now (detects tab-close/network
 *    drop automatically, usually within seconds). Used only
 *    for the "online/offline" dot — not for game state.
 *
 * This same helper will be reused for the game arena's
 * broadcast events later (movement, bombs, explosions), which
 * is why it's a separate file per your project structure.
 * ---------------------------------------------------------
 */

/**
 * Subscribe to a room's lobby channel.
 * @param {string} roomId - game_rooms.id (uuid)
 * @param {object} me - { id, username }
 * @param {object} handlers - {
 *    onRoomPlayersChange: () => void,   // any insert/update/delete on room_players for this room
 *    onRoomChange: (newRow) => void,    // game_rooms row updated (status, etc.)
 *    onPresenceUpdate: (onlineUserIds: Set) => void,
 * }
 * @returns the channel (keep a reference so you can unsubscribe later)
 */
function subscribeToLobby(roomId, me, handlers) {
  const channel = window.supabaseClient.channel(`lobby:${roomId}`, {
    config: { presence: { key: me.id } },
  });

  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const onlineIds = new Set(Object.keys(state));
      handlers.onPresenceUpdate && handlers.onPresenceUpdate(onlineIds);
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` },
      () => handlers.onRoomPlayersChange && handlers.onRoomPlayersChange()
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` },
      (payload) => handlers.onRoomChange && handlers.onRoomChange(payload.new)
    )
    .subscribe(async (status) => {
      updateConnectionBanner(status);
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: me.id, username: me.username, online_at: new Date().toISOString() });
      }
    });

  return channel;
}

async function unsubscribeChannel(channel) {
  if (!channel) return;
  try {
    await channel.untrack();
  } catch (e) { /* ignore */ }
  await window.supabaseClient.removeChannel(channel);
}

/**
 * Shows a small fixed banner reflecting Supabase Realtime
 * connection status, per the spec's network-handling
 * requirement. Supabase's client automatically retries the
 * underlying WebSocket connection — this just gives the
 * player visible feedback while that happens.
 */
function updateConnectionBanner(status) {
  let banner = document.getElementById("connectionBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "connectionBanner";
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      text-align: center; padding: 6px; font-size: 12px; font-weight: 700;
      transition: opacity 0.3s; pointer-events: none;
    `;
    document.body.appendChild(banner);
  }

  if (status === "SUBSCRIBED") {
    banner.textContent = "✅ CONNECTED";
    banner.style.background = "#4ade80";
    banner.style.color = "#0a0b10";
    setTimeout(() => { banner.style.opacity = "0"; }, 1200);
  } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
    banner.textContent = "⚠️ RECONNECTING...";
    banner.style.background = "#f87171";
    banner.style.color = "#0a0b10";
    banner.style.opacity = "1";
  } else if (status === "CLOSED") {
    banner.style.opacity = "0";
  } else {
    banner.textContent = "CONNECTING...";
    banner.style.background = "#eab308";
    banner.style.color = "#0a0b10";
    banner.style.opacity = "1";
  }
}

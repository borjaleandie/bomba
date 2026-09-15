/**
 * js/chat.js
 * ---------------------------------------------------------
 * Reusable real-time chat panel. Used in lobby.html, game.html
 * (as a toggleable overlay), and results.html.
 *
 * SECURITY NOTE: user-typed messages are inserted using
 * textContent (never innerHTML) to prevent XSS — never trust
 * message text enough to render it as raw HTML.
 * ---------------------------------------------------------
 */

const CLIENT_PROFANITY_LIST = ["damn", "hell", "stupid", "idiot"]; // mirrors the DB-side list; expand together

function filterProfanityClientSide(text) {
  let cleaned = text;
  CLIENT_PROFANITY_LIST.forEach((word) => {
    const re = new RegExp(word, "gi");
    cleaned = cleaned.replace(re, "*".repeat(word.length));
  });
  return cleaned;
}

async function fetchRecentMessages(roomId, limit = 50) {
  const { data, error } = await window.supabaseClient
    .from("messages")
    .select("id, user_id, message, deleted, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const userIds = [...new Set(data.map((m) => m.user_id))];
  const { data: profiles } = await window.supabaseClient
    .from("public_profiles").select("id, username").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  return data.map((m) => ({
    ...m,
    username: profiles?.find((p) => p.id === m.user_id)?.username || "Player",
  }));
}

async function sendChatMessage(roomId, userId, rawMessage) {
  const trimmed = rawMessage.trim();
  if (!trimmed) throw new Error("Message cannot be empty.");
  if (trimmed.length > 500) throw new Error("Message is too long (max 500 characters).");

  const filtered = filterProfanityClientSide(trimmed);

  const { error } = await window.supabaseClient
    .from("messages")
    .insert({ room_id: roomId, user_id: userId, message: filtered });
  if (error) throw error;
}

async function softDeleteMyMessage(messageId) {
  const { error } = await window.supabaseClient
    .from("messages")
    .update({ deleted: true })
    .eq("id", messageId);
  if (error) throw error;
}

function subscribeToChatChannel(roomId, onInsert) {
  const channel = window.supabaseClient
    .channel(`chat:${roomId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, (payload) => onInsert(payload.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, (payload) => onInsert(payload.new, true))
    .subscribe();
  return channel;
}

/**
 * Mounts a full chat panel (message list + input) into a
 * container element. Returns the realtime channel so the
 * caller can unsubscribe when the panel is closed/left.
 */
function mountChatPanel(containerEl, { roomId, userId, username }) {
  containerEl.innerHTML = `
    <div class="chat-messages" id="chatMessages"></div>
    <div class="chat-input-row">
      <input type="text" id="chatInput" maxlength="500" placeholder="Type message..." />
      <button id="chatSendBtn">SEND</button>
    </div>
  `;

  const messagesEl = containerEl.querySelector("#chatMessages");
  const inputEl = containerEl.querySelector("#chatInput");
  const sendBtn = containerEl.querySelector("#chatSendBtn");

  const knownMessages = new Map(); // id -> DOM row, so UPDATE (delete) can find and update the right row

  function renderRow(msg) {
    const row = document.createElement("div");
    row.className = "chat-row";

    const isMine = msg.user_id === userId;
    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-username";
    nameSpan.textContent = msg.username + ":";

    const textSpan = document.createElement("span");
    textSpan.className = "chat-text";
    textSpan.textContent = msg.deleted ? "[message deleted]" : " " + msg.message; // textContent = safe from XSS

    row.appendChild(nameSpan);
    row.appendChild(textSpan);

    if (isMine && !msg.deleted) {
      const delBtn = document.createElement("button");
      delBtn.className = "chat-delete-btn";
      delBtn.textContent = "✕";
      delBtn.title = "Delete message";
      delBtn.addEventListener("click", async () => {
        try { await softDeleteMyMessage(msg.id); } catch (e) { /* ignore */ }
      });
      row.appendChild(delBtn);
    } else if (!isMine && !msg.deleted) {
      const reportBtn = document.createElement("button");
      reportBtn.className = "chat-report-btn";
      reportBtn.textContent = "⚑";
      reportBtn.title = "Report message";
      reportBtn.addEventListener("click", async () => {
        const reason = prompt("Why are you reporting this message?");
        if (!reason) return;
        try {
          await submitReport({ reporterId: userId, reportedUserId: msg.user_id, roomId, messageId: msg.id, reason });
          alert("Report submitted. Thank you.");
        } catch (e) { alert("Could not submit report."); }
      });
      row.appendChild(reportBtn);
    }

    return row;
  }

  function addOrUpdateMessage(msg, isUpdate) {
    if (isUpdate && knownMessages.has(msg.id)) {
      const newRow = renderRow(msg);
      knownMessages.get(msg.id).replaceWith(newRow);
      knownMessages.set(msg.id, newRow);
      return;
    }
    const row = renderRow(msg);
    knownMessages.set(msg.id, row);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight; // auto-scroll
  }

  // Initial load
  fetchRecentMessages(roomId).then((msgs) => msgs.forEach((m) => addOrUpdateMessage(m, false)));

  // Realtime updates — need username for new inserts, so look it up
  const channel = subscribeToChatChannel(roomId, async (msg, isUpdate) => {
    if (isUpdate) { addOrUpdateMessage(msg, true); return; }
    if (msg.user_id !== userId && typeof playSound === "function") playSound("chat");
    const { data: p } = await window.supabaseClient.from("public_profiles").select("username").eq("id", msg.user_id).maybeSingle();
    addOrUpdateMessage({ ...msg, username: p?.username || "Player" }, false);
  });

  async function send() {
    const text = inputEl.value;
    if (!text.trim()) return;
    inputEl.value = "";
    try { await sendChatMessage(roomId, userId, text); }
    catch (e) { alert(e.message || "Could not send message."); }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  return channel;
}

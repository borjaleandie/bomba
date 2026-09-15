/**
 * js/character.js
 * ---------------------------------------------------------
 * Builds a small layered SVG character from style + color
 * choices, and handles loading/saving the `characters` table.
 *
 * IMPORTANT: renderCharacterSVG() is used on THIS page AND
 * will be reused later in lobby.html, game.js, and
 * results.html so every player's character looks the same
 * everywhere, per your spec.
 * ---------------------------------------------------------
 */

const CHARACTER_OPTIONS = {
  body: ["body_1", "body_2", "body_3"],       // build/shape
  hair: ["hair_1", "hair_2", "hair_3", "hair_4", "bald"],
  shirt: ["shirt_1", "shirt_2", "shirt_3"],
  pants: ["pants_1", "pants_2"],
  shoes: ["shoes_1", "shoes_2"],
  accessory: ["none", "cap", "glasses", "mask", "crown"],
};

/**
 * Returns an SVG markup string for a given character record.
 * character = { body, body_color, hair, hair_color, shirt, shirt_color,
 *                pants, pants_color, shoes, shoes_color, accessory }
 */
function renderCharacterSVG(c) {
  const bodyWidth = c.body === "body_2" ? 44 : c.body === "body_3" ? 52 : 48;
  const headRadius = c.body === "body_3" ? 24 : 22;

  // ---- Hair shapes ----
  let hair = "";
  if (c.hair === "hair_1") { // short/round
    hair = `<path d="M 40 30 Q 60 5 80 30 L 80 42 L 40 42 Z" fill="${c.hair_color}"/>`;
  } else if (c.hair === "hair_2") { // long
    hair = `<path d="M 36 30 Q 60 2 84 30 L 88 70 L 78 70 L 76 40 L 44 40 L 42 70 L 32 70 Z" fill="${c.hair_color}"/>`;
  } else if (c.hair === "hair_3") { // spiky
    hair = `<path d="M 38 32 L 44 14 L 50 30 L 58 10 L 66 30 L 74 14 L 82 32 Z" fill="${c.hair_color}"/>`;
  } else if (c.hair === "hair_4") { // mohawk
    hair = `<rect x="55" y="6" width="10" height="30" rx="4" fill="${c.hair_color}"/>`;
  } // bald = none

  // ---- Accessory ----
  let accessory = "";
  if (c.accessory === "cap") {
    accessory = `<path d="M 34 30 Q 60 8 86 30 L 90 36 L 30 36 Z" fill="#e63946"/><rect x="80" y="30" width="16" height="7" rx="3" fill="#e63946"/>`;
  } else if (c.accessory === "glasses") {
    accessory = `<circle cx="50" cy="46" r="8" fill="none" stroke="#111" stroke-width="3"/><circle cx="70" cy="46" r="8" fill="none" stroke="#111" stroke-width="3"/><line x1="58" y1="46" x2="62" y2="46" stroke="#111" stroke-width="3"/>`;
  } else if (c.accessory === "mask") {
    accessory = `<rect x="42" y="50" width="36" height="14" rx="6" fill="#2b2b2b"/>`;
  } else if (c.accessory === "crown") {
    accessory = `<path d="M 40 26 L 46 12 L 54 24 L 60 10 L 66 24 L 74 12 L 80 26 Z" fill="#ffd700" stroke="#b8860b" stroke-width="1.5"/>`;
  }

  // ---- Pants length ----
  const pantsHeight = c.pants === "pants_2" ? 30 : 20;

  return `
  <svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
    <!-- shoes -->
    <rect x="38" y="${140}" width="16" height="${c.shoes === 'shoes_2' ? 14 : 10}" rx="3" fill="${c.shoes_color}"/>
    <rect x="66" y="${140}" width="16" height="${c.shoes === 'shoes_2' ? 14 : 10}" rx="3" fill="${c.shoes_color}"/>
    <!-- pants -->
    <rect x="36" y="${118 - (pantsHeight - 20)}" width="48" height="${pantsHeight + 22}" rx="6" fill="${c.pants_color}"/>
    <!-- shirt / torso -->
    <rect x="${60 - bodyWidth / 2}" y="70" width="${bodyWidth}" height="52" rx="10" fill="${c.shirt_color}"/>
    <!-- arms -->
    <rect x="${60 - bodyWidth / 2 - 10}" y="74" width="10" height="34" rx="5" fill="${c.body_color}"/>
    <rect x="${60 + bodyWidth / 2}" y="74" width="10" height="34" rx="5" fill="${c.body_color}"/>
    <!-- head -->
    <circle cx="60" cy="46" r="${headRadius}" fill="${c.body_color}"/>
    <!-- face -->
    <circle cx="52" cy="46" r="2.5" fill="#111"/>
    <circle cx="68" cy="46" r="2.5" fill="#111"/>
    <path d="M 52 56 Q 60 62 68 56" stroke="#111" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- hair -->
    ${hair}
    <!-- accessory -->
    ${accessory}
  </svg>`;
}

/**
 * Load the current user's character row (guaranteed to exist
 * via the signup trigger).
 */
async function loadCharacter(userId) {
  const { data, error } = await window.supabaseClient
    .from("characters")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Save changes to the current user's character row.
 */
async function saveCharacter(userId, character) {
  const { error } = await window.supabaseClient
    .from("characters")
    .update({
      body: character.body,
      body_color: character.body_color,
      hair: character.hair,
      hair_color: character.hair_color,
      shirt: character.shirt,
      shirt_color: character.shirt_color,
      pants: character.pants,
      pants_color: character.pants_color,
      shoes: character.shoes,
      shoes_color: character.shoes_color,
      accessory: character.accessory,
    })
    .eq("user_id", userId);
  if (error) throw error;
}

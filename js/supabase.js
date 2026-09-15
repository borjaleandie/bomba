/**
 * js/supabase.js
 * ---------------------------------------------------------
 * Single shared Supabase client for the whole game.
 * Every other JS file (auth.js, room.js, game.js, etc.)
 * uses window.supabaseClient — never creates its own client.
 *
 * IMPORTANT:
 * - Only the PUBLIC / PUBLISHABLE key goes here.
 * - NEVER put the service_role key in frontend code.
 * ---------------------------------------------------------
 */

// 1. Your Supabase project credentials
const SUPABASE_URL = "https://mnsxsekvyqunuagzdcqp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cOgketh-zGr7fd1eoUKMAQ__H-adUDV";

// 2. Create the client using the Supabase JS library (loaded via CDN in each HTML file)
//    supabase-js v2 exposes a global `supabase` object with `.createClient()`
window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 15,
    },
  },
});

/**
 * Helper: get the currently logged-in user (or null).
 */
async function getCurrentUser() {
  const { data, error } = await window.supabaseClient.auth.getUser();
  if (error) {
    console.warn("getCurrentUser error:", error.message);
    return null;
  }
  return data.user;
}

/**
 * Helper: require login on a page.
 * Call this at the top of every protected page's script.
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }
  return user;
}

/**
 * Helper: check if the current user's account is disabled.
 */
async function checkAccountStatus(userId) {
  const { data, error } = await window.supabaseClient
    .from("profiles")
    .select("account_status")
    .eq("id", userId)
    .single();

  if (error) {
    console.warn("checkAccountStatus error:", error.message);
    return "active";
  }
  return data.account_status;
}

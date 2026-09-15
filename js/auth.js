/**
 * js/auth.js
 * ---------------------------------------------------------
 * Registration, login, logout, password reset.
 * Depends on js/supabase.js being loaded first.
 * ---------------------------------------------------------
 */

/**
 * Register a new player.
 * Creates the auth.users row via Supabase Auth; the database
 * trigger (handle_new_user, see 01_schema.sql) automatically
 * creates the matching profiles + characters rows using the
 * metadata we pass here (username, full_name).
 */
async function registerUser({ fullName, username, email, password }) {
  // 1. Basic client-side validation (defense in depth; the DB also enforces constraints)
  username = username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error("Username must be 3-20 characters: letters, numbers, underscores only.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  // 2. Check username availability BEFORE creating the auth account,
  //    so we can show a friendly error instead of a failed signup.
  const { data: taken, error: checkError } = await window.supabaseClient
    .rpc("is_username_taken", { check_username: username });

  if (checkError) throw new Error("Could not verify username. Please try again.");
  if (taken) throw new Error("That username is already taken.");

  // 3. Create the auth account. Metadata is read by our DB trigger.
  const { data, error } = await window.supabaseClient.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        username,
        full_name: fullName.trim(),
      },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate")) {
      throw new Error("That username or email is already registered.");
    }
    throw error;
  }

  return data.user;
}

/**
 * Log an existing player in.
 */
async function loginUser(email, password) {
  const { data, error } = await window.supabaseClient.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    if (error.message.toLowerCase().includes("invalid login credentials")) {
      throw new Error("Incorrect email or password.");
    }
    throw error;
  }

  // Block disabled accounts from proceeding even though the password was correct.
  const status = await checkAccountStatus(data.user.id);
  if (status === "disabled") {
    await window.supabaseClient.auth.signOut();
    throw new Error("Your account has been disabled. Please contact the administrator.");
  }

  // Touch last_active (best-effort, ignore failure)
  await window.supabaseClient
    .from("profiles")
    .update({ last_active: new Date().toISOString() })
    .eq("id", data.user.id);

  return data.user;
}

/**
 * Log the current player out and send them to login.html
 */
async function logoutUser() {
  await window.supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

/**
 * Send a password-reset email. The link inside it will open
 * reset-password.html on this same site.
 */
async function sendPasswordReset(email) {
  const redirectTo = window.location.origin + window.location.pathname.replace(/login\.html$/, "reset-password.html");
  const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  if (error) throw error;
}

/**
 * Set a new password. Called from reset-password.html after
 * the user arrives via the emailed link (Supabase automatically
 * creates a temporary session from the link's token).
 */
async function updatePassword(newPassword) {
  if (newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  const { error } = await window.supabaseClient.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

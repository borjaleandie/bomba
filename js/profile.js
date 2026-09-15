/**
 * js/profile.js
 * Loads and updates the logged-in user's profile.
 */


/* =========================================================
   LOAD PROFILE
   ========================================================= */

async function loadProfileData(userId) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  const {
    data: profiles,
    error
  } = await window.supabaseClient
    .from("profiles")
    .select(
      "id, username, full_name, email, role, created_at, total_wins, total_kills, total_deaths, avatar_url"
    )
    .eq("id", userId)
    .limit(1);

  if (error) {
    console.error("Load profile error:", error);
    throw error;
  }

  if (!profiles || profiles.length === 0) {
    throw new Error(
      "Profile not found. Make sure your user has a row in public.profiles."
    );
  }

  return profiles[0];
}


/* =========================================================
   UPDATE USERNAME
   ========================================================= */

async function updateUsername(userId, newUsername) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  newUsername = newUsername.trim();

  /* Validate username */
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)) {
    throw new Error(
      "Username must be 3-20 characters: letters, numbers, underscores only."
    );
  }


  /* ---------------------------------------------------------
     Check whether another profile already uses this username.
     We use an array instead of maybeSingle() so duplicate
     usernames cannot cause:
     "Cannot coerce the result to a single JSON object"
     --------------------------------------------------------- */

  const {
    data: existingUsers,
    error: checkError
  } = await window.supabaseClient
    .from("profiles")
    .select("id")
    .eq("username", newUsername)
    .neq("id", userId)
    .limit(1);

  if (checkError) {
    console.error(
      "Username check error:",
      checkError
    );

    throw new Error(
      "Could not verify username: " +
      checkError.message
    );
  }

  if (
    existingUsers &&
    existingUsers.length > 0
  ) {
    throw new Error(
      "That username is already taken."
    );
  }


  /* ---------------------------------------------------------
     Update username
     --------------------------------------------------------- */

  const {
    error: updateError
  } = await window.supabaseClient
    .from("profiles")
    .update({
      username: newUsername
    })
    .eq("id", userId);

  if (updateError) {
    console.error(
      "Update username error:",
      updateError
    );

    throw new Error(
      "Could not update username: " +
      updateError.message
    );
  }


  /* ---------------------------------------------------------
     Verify the update
     --------------------------------------------------------- */

  const {
    data: updatedProfiles,
    error: verifyError
  } = await window.supabaseClient
    .from("profiles")
    .select("id, username")
    .eq("id", userId)
    .limit(1);

  if (verifyError) {
    console.error(
      "Username verification error:",
      verifyError
    );

    throw verifyError;
  }

  if (
    !updatedProfiles ||
    updatedProfiles.length === 0
  ) {
    throw new Error(
      "Username update could not be verified."
    );
  }

  console.log(
    "Username updated successfully:",
    updatedProfiles[0].username
  );

  return updatedProfiles[0];
}


/* =========================================================
   UPLOAD AVATAR
   ========================================================= */

async function uploadAvatar(userId, file) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!file) {
    throw new Error("Please choose an image.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(
      "Please choose an image file."
    );
  }

  if (file.size > 3 * 1024 * 1024) {
    throw new Error(
      "Image must be smaller than 3MB."
    );
  }


  /* Get file extension */

  const ext =
    file.name.split(".").pop().toLowerCase();


  /* Create unique storage path */

  const path =
    `${userId}/avatar-${Date.now()}.${ext}`;


  /* Upload image */

  const {
    error: uploadError
  } = await window.supabaseClient
    .storage
    .from("avatars")
    .upload(
      path,
      file,
      {
        upsert: true,
        cacheControl: "3600"
      }
    );

  if (uploadError) {
    console.error(
      "Avatar upload error:",
      uploadError
    );

    throw uploadError;
  }


  /* Get public URL */

  const {
    data: publicUrlData
  } = window.supabaseClient
    .storage
    .from("avatars")
    .getPublicUrl(path);

  const avatarUrl =
    publicUrlData.publicUrl;


  /* Save URL to profile */

  const {
    error: updateError
  } = await window.supabaseClient
    .from("profiles")
    .update({
      avatar_url: avatarUrl
    })
    .eq("id", userId);

  if (updateError) {
    console.error(
      "Avatar profile update error:",
      updateError
    );

    throw updateError;
  }

  return avatarUrl;
}
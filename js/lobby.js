// =========================================================
// CREATE GAME ROUND
// =========================================================
// Uses the Supabase RPC:
//
//   start_game_round(p_room_id)
//
// The RPC handles everything atomically:
//   1. Checks the logged-in user
//   2. Checks that the user is the host
//   3. Checks at least 2 players
//   4. Checks everyone is ready
//   5. Creates game_rounds
//   6. Saves current_round_id
//   7. Changes room status to "playing"
//
// =========================================================

async function createGameRound(
  roomId,
  hostId
) {

  if (!roomId) {
    throw new Error(
      "Room ID is required."
    );
  }

  if (!hostId) {
    throw new Error(
      "Host ID is required."
    );
  }


  // -------------------------------------------------------
  // Verify logged-in user
  // -------------------------------------------------------

  const user =
    await getLobbyUser();


  if (
    user.id !== hostId
  ) {

    throw new Error(
      "Only the host can start the game."
    );

  }


  // -------------------------------------------------------
  // Get current room
  // -------------------------------------------------------

  const room =
    await getLobbyRoom(roomId);


  if (
    room.host_id !== hostId
  ) {

    throw new Error(
      "Only the host can start the game."
    );

  }


  console.log(
    "================================"
  );

  console.log(
    "STARTING GAME THROUGH RPC"
  );

  console.log(
    "ROOM ID:",
    roomId
  );

  console.log(
    "HOST ID:",
    hostId
  );

  console.log(
    "ROOM STATUS:",
    room.status
  );

  console.log(
    "CURRENT ROUND:",
    room.current_round_id
  );

  console.log(
    "================================"
  );


  // -------------------------------------------------------
  // CALL SUPABASE RPC
  // -------------------------------------------------------

  const {
    data,
    error
  } = await window.supabaseClient
    .rpc(
      "start_game_round",
      {
        p_room_id: roomId
      }
    );


  if (error) {

    console.error(
      "START GAME RPC ERROR:",
      error
    );

    throw new Error(
      error.message ||
      "Could not start the game."
    );

  }


  // -------------------------------------------------------
  // Supabase can return either:
  //
  // object
  // OR
  // array with one object
  // -------------------------------------------------------

  const round =
    Array.isArray(data)
      ? data[0]
      : data;


  if (
    !round ||
    !round.id
  ) {

    console.error(
      "RPC RETURNED:",
      data
    );

    throw new Error(
      "Game round was not created."
    );

  }


  console.log(
    "GAME ROUND CREATED:",
    round.id
  );


  // -------------------------------------------------------
  // IMPORTANT:
  //
  // Reload the room from Supabase.
  // Do NOT rely on the old room object.
  // -------------------------------------------------------

  const updatedRoom =
    await getLobbyRoom(roomId);


  console.log(
    "UPDATED ROOM:",
    updatedRoom
  );


  // -------------------------------------------------------
  // Verify room status
  // -------------------------------------------------------

  if (
    updatedRoom.status !==
    "playing"
  ) {

    throw new Error(
      "Game round was created but room is not playing."
    );

  }


  // -------------------------------------------------------
  // Verify current_round_id
  // -------------------------------------------------------

  if (
    !updatedRoom.current_round_id
  ) {

    throw new Error(
      "Game started but current_round_id is missing."
    );

  }


  // -------------------------------------------------------
  // Make sure the room points to THIS round
  // -------------------------------------------------------

  if (
    updatedRoom.current_round_id !==
    round.id
  ) {

    throw new Error(
      "Room current_round_id does not match the created round."
    );

  }


  // -------------------------------------------------------
  // SUCCESS
  // -------------------------------------------------------

  console.log(
    "================================"
  );

  console.log(
    "GAME STARTED SUCCESSFULLY"
  );

  console.log(
    "ROOM:",
    updatedRoom.id
  );

  console.log(
    "ROOM CODE:",
    updatedRoom.room_code
  );

  console.log(
    "ROOM STATUS:",
    updatedRoom.status
  );

  console.log(
    "ROUND:",
    round.id
  );

  console.log(
    "CURRENT ROUND:",
    updatedRoom.current_round_id
  );

  console.log(
    "================================"
  );


  return round;
}
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
  // VERIFY CURRENT USER
  // -------------------------------------------------------

  const user =
    await getLobbyUser();

  if (user.id !== hostId) {
    throw new Error(
      "Only the host can create the game round."
    );
  }


  // -------------------------------------------------------
  // GET ROOM
  // -------------------------------------------------------

  const room =
    await getLobbyRoom(roomId);


  // -------------------------------------------------------
  // VERIFY HOST
  // -------------------------------------------------------

  if (
    room.host_id !== hostId
  ) {
    throw new Error(
      "Only the host can create the game round."
    );
  }


  // -------------------------------------------------------
  // IF ROOM ALREADY HAS AN ACTIVE ROUND
  // -------------------------------------------------------

  if (
    room.current_round_id
  ) {

    const {
      data: existingRounds,
      error: existingError
    } = await window.supabaseClient
      .from("game_rounds")
      .select(`
        id,
        room_id,
        round_number,
        status,
        started_at
      `)
      .eq(
        "id",
        room.current_round_id
      )
      .eq(
        "room_id",
        roomId
      )
      .limit(1);

    if (existingError) {
      console.error(
        "Check existing round error:",
        existingError
      );

      throw existingError;
    }


    if (
      existingRounds &&
      existingRounds.length > 0
    ) {

      const existingRound =
        existingRounds[0];


      // -----------------------------------------------
      // Existing round is already playing
      // -----------------------------------------------

      if (
        existingRound.status === "playing"
      ) {

        return existingRound;

      }


      // -----------------------------------------------
      // Existing round exists but is not playing
      // -----------------------------------------------

      const {
        data: activatedRows,
        error: activateError
      } = await window.supabaseClient
        .from("game_rounds")
        .update({
          status: "playing",
          started_at:
            existingRound.started_at ||
            new Date().toISOString()
        })
        .eq(
          "id",
          existingRound.id
        )
        .select()
        .limit(1);


      if (activateError) {
        console.error(
          "Activate round error:",
          activateError
        );

        throw activateError;
      }


      if (
        activatedRows &&
        activatedRows.length > 0
      ) {

        // Make sure room is also playing.
        const {
          error: roomUpdateError
        } = await window.supabaseClient
          .from("game_rooms")
          .update({
            status: "playing",
            current_round_id:
              existingRound.id,
            started_at:
              existingRound.started_at ||
              new Date().toISOString()
          })
          .eq(
            "id",
            roomId
          )
          .eq(
            "host_id",
            hostId
          );

        if (roomUpdateError) {
          throw roomUpdateError;
        }

        return activatedRows[0];
      }
    }


    // -----------------------------------------------
    // current_round_id was invalid
    // -----------------------------------------------

    const {
      error: clearError
    } = await window.supabaseClient
      .from("game_rooms")
      .update({
        current_round_id: null,
        status: "waiting",
        started_at: null,
        ended_at: null
      })
      .eq(
        "id",
        roomId
      )
      .eq(
        "host_id",
        hostId
      );

    if (clearError) {
      console.error(
        "Clear broken round error:",
        clearError
      );

      throw clearError;
    }
  }


  // -------------------------------------------------------
  // GET NEXT ROUND NUMBER
  // -------------------------------------------------------

  const {
    count: roundCount,
    error: countError
  } = await window.supabaseClient
    .from("game_rounds")
    .select(
      "id",
      {
        count: "exact",
        head: true
      }
    )
    .eq(
      "room_id",
      roomId
    );


  if (countError) {
    console.error(
      "Round count error:",
      countError
    );

    throw countError;
  }


  const roundNumber =
    (roundCount || 0) + 1;


  // -------------------------------------------------------
  // CREATE THE ROUND FIRST
  // -------------------------------------------------------

  const {
    data: roundRows,
    error: roundError
  } = await window.supabaseClient
    .from("game_rounds")
    .insert({

      room_id:
        roomId,

      round_number:
        roundNumber,

      status:
        "playing",

      started_at:
        new Date().toISOString()

    })
    .select()
    .limit(1);


  if (roundError) {

    console.error(
      "Create game round error:",
      roundError
    );

    throw roundError;
  }


  if (
    !roundRows ||
    roundRows.length === 0
  ) {

    throw new Error(
      "Game round was created but could not be loaded."
    );

  }


  const round =
    roundRows[0];


  // -------------------------------------------------------
  // IMPORTANT
  //
  // Attach the round ID to the room.
  //
  // DO NOT set status = playing before
  // current_round_id is available.
  // -------------------------------------------------------

  const {
    data: updatedRooms,
    error: updateError
  } = await window.supabaseClient
    .from("game_rooms")
    .update({

      current_round_id:
        round.id,

      status:
        "playing",

      started_at:
        round.started_at

    })
    .eq(
      "id",
      roomId
    )
    .eq(
      "host_id",
      hostId
    )
    .select(`
      id,
      room_code,
      status,
      current_round_id,
      started_at
    `)
    .limit(1);


  // -------------------------------------------------------
  // ROOM UPDATE FAILED
  // -------------------------------------------------------

  if (updateError) {

    console.error(
      "Attach round to room error:",
      updateError
    );


    // Try to remove the unused round.
    await window.supabaseClient
      .from("game_rounds")
      .delete()
      .eq(
        "id",
        round.id
      );


    throw updateError;
  }


  if (
    !updatedRooms ||
    updatedRooms.length === 0
  ) {

    await window.supabaseClient
      .from("game_rounds")
      .delete()
      .eq(
        "id",
        round.id
      );


    throw new Error(
      "Could not attach the game round to the room."
    );
  }


  const updatedRoom =
    updatedRooms[0];


  // -------------------------------------------------------
  // FINAL VERIFICATION
  // -------------------------------------------------------

  if (
    !updatedRoom.current_round_id
  ) {

    throw new Error(
      "Round was created but current_round_id is missing."
    );
  }


  if (
    updatedRoom.current_round_id !==
    round.id
  ) {

    throw new Error(
      "The room current_round_id does not match the new round."
    );
  }


  if (
    updatedRoom.status !==
    "playing"
  ) {

    throw new Error(
      "Round exists but room is not playing."
    );
  }


  console.log(
    "================================"
  );

  console.log(
    "GAME ROUND CREATED SUCCESSFULLY"
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
    "ROUND:",
    round.id
  );

  console.log(
    "ROUND NUMBER:",
    round.round_number
  );

  console.log(
    "ROOM STATUS:",
    updatedRoom.status
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
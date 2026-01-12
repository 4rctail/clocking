if (interaction.commandName === "clockin") {
  const uid = interaction.user.id;
  timesheet[uid] ??= { logs: [] };

  const voiceChannel = await getVoiceChannel(interaction);
  if (!voiceChannel) {
    return interaction.editReply("❌ You must be in a voice channel to clock in.");
  }

  if (timesheet[uid].active) {
    return interaction.editReply("❌ You are already clocked in.");
  }

  timesheet[uid].active = new Date().toISOString();

  await writeJSON(ACTIVE_FILE, timesheet);
  await syncFile("timesheet.json");

  return interaction.editReply(`🟢 CLOCKED IN\n📢 Voice: **${voiceChannel.name}**`);
}

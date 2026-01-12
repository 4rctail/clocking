export default {
  name: "clockin",

  async execute(interaction) {
    await interaction.deferReply(); // ✅ REQUIRED

    const member = interaction.member;

    if (!member.voice.channelId) {
      await interaction.editReply("❌ You must be in a voice channel to clock in.");
      return;
    }

    const fs = await import("fs/promises");
    const FILE = "./timesheet.json";

    let data = {};
    try {
      data = JSON.parse(await fs.readFile(FILE, "utf8"));
    } catch {}

    const uid = interaction.user.id;
    data[uid] ??= { logs: [] };

    if (data[uid].active) {
      await interaction.editReply("❌ You are already clocked in.");
      return;
    }

    data[uid].active = new Date().toISOString();

    await fs.writeFile(FILE, JSON.stringify(data, null, 2));

    await interaction.editReply("🟢 CLOCKED IN");
  }
};

import fs from "fs/promises";

const FILE = "./timesheet.json";

export default {
  name: "status",

  async execute(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    const data = JSON.parse(await fs.readFile(FILE, "utf8") || "{}");

    const u = data[user.id];
    if (!u)
      return interaction.editReply("📭 No record.");

    if (u.active) {
      const mins = Math.floor((Date.now() - new Date(u.active)) / 60000);
      return interaction.editReply(`🟢 Clocked in (${mins} min)`);
    }

    interaction.editReply("🔴 Not clocked in.");
  }
};

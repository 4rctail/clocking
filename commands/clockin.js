import fs from "fs/promises";

const FILE = "./timesheet.json";

async function read() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function write(data) {
  await fs.writeFile(FILE, JSON.stringify(data, null, 2));
}

export default {
  name: "clockin",

  async execute(interaction) {
    // 🔥 MUST be first
    await interaction.reply("🟢 Clocking in...");

    const data = await read();
    const uid = interaction.user.id;

    if (data[uid]?.active) {
      await interaction.editReply("❌ You are already clocked in.");
      return;
    }

    data[uid] ??= { logs: [] };
    data[uid].active = new Date().toISOString();

    await write(data);

    await interaction.editReply("🟢 CLOCKED IN");
  }
};

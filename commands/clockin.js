import fs from "fs/promises";

const FILE = "./timesheet.json";

async function read() {
  try { return JSON.parse(await fs.readFile(FILE)); }
  catch { return {}; }
}

async function write(d) {
  await fs.writeFile(FILE, JSON.stringify(d, null, 2));
}

export default {
  name: "clockin",

  async execute(interaction) {
    if (!interaction.member.voice?.channelId)
      return interaction.editReply("❌ Join voice first.");

    const data = await read();
    const uid = interaction.user.id;

    data[uid] ??= { logs: [] };

    if (data[uid].active)
      return interaction.editReply("❌ Already clocked in.");

    data[uid].active = new Date().toISOString();
    await write(data);

    interaction.editReply("🟢 CLOCKED IN");
  }
};

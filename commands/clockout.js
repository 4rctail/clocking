import fs from "fs/promises";

const FILE = "./timesheet.json";

async function read() {
  try { return JSON.parse(await fs.readFile(FILE)); }
  catch { return {}; }
}

async function write(d) {
  await fs.writeFile(FILE, JSON.stringify(d, null, 2));
}

function diffHours(a, b) {
  return ((new Date(b) - new Date(a)) / 36e5).toFixed(2);
}

export default {
  name: "clockout",

  async execute(interaction) {
    const data = await read();
    const uid = interaction.user.id;

    if (!data[uid]?.active)
      return interaction.editReply("❌ Not clocked in.");

    const end = new Date().toISOString();

    data[uid].logs.push({
      start: data[uid].active,
      end,
      hours: diffHours(data[uid].active, end),
    });

    delete data[uid].active;
    await write(data);

    interaction.editReply("🔴 CLOCKED OUT");
  }
};

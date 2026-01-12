import fs from "fs/promises";

const FILE = "./timesheet.json";

async function read() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
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
    // ✅ REQUIRED
    await interaction.deferReply();

    const data = await read();
    const uid = interaction.user.id;

    if (!data[uid]?.active) {
      await interaction.editReply("❌ Not clocked in.");
      return;
    }

    const end = new Date().toISOString();

    data[uid].logs.push({
      start: data[uid].active,
      end,
      hours: diffHours(data[uid].active, end),
    });

    delete data[uid].active;
    await write(data);

    await interaction.editReply("🔴 CLOCKED OUT");
  }
};

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

// 🔒 BULLETPROOF VOICE CHECK
function getVoiceChannel(interaction) {
  // Must be in a guild
  if (!interaction.inGuild()) return null;

  const guild = interaction.guild;
  if (!guild) return null;

  const voiceState = guild.voiceStates.cache.get(interaction.user.id);
  return voiceState?.channel ?? null;
}

export default {
  name: "clockin",

  async execute(interaction) {
    const uid = interaction.user.id;

    const voiceChannel = getVoiceChannel(interaction);
    if (!voiceChannel) {
      return interaction.editReply(
        "❌ You must be **inside a server voice channel** to clock in."
      );
    }

    const data = await read();
    data[uid] ??= { logs: [] };

    if (data[uid].active) {
      return interaction.editReply("❌ You are already clocked in.");
    }

    data[uid].active = new Date().toISOString();
    await write(data);

    return interaction.editReply(
      `🟢 **CLOCKED IN**\n📢 Voice: **${voiceChannel.name}**`
    );
  }
};

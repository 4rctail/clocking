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
    // MUST be in a guild
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ This command can only be used in a server.",
        ephemeral: true
      });
    }

    // 🔴 THIS IS THE KEY LINE — DO NOT CHANGE IT
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ You must be **in a voice channel** to clock in.",
        ephemeral: true
      });
    }

    const uid = interaction.user.id;
    const data = await read();

    data[uid] ??= {};

    if (data[uid].active) {
      return interaction.reply({
        content: "❌ You are already clocked in.",
        ephemeral: true
      });
    }

    data[uid].active = {
      time: new Date().toISOString(),
      channel: voiceChannel.id
    };

    await write(data);

    return interaction.reply({
      content: `🟢 **CLOCKED IN**\n📢 Voice: **${voiceChannel.name}**`,
      ephemeral: true
    });
  }
};

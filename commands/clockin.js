import fs from "fs/promises";
import { MessageFlags } from "discord.js";

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
    if (!interaction.inGuild()) {
      return interaction.editReply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral
      });
    }

    const uid = interaction.user.id;
    const data = await read();

    data[uid] ??= {};

    if (data[uid].active) {
      return interaction.editReply({
        content: "❌ You are already clocked in.",
        flags: MessageFlags.Ephemeral
      });
    }

    data[uid].active = {
      time: new Date().toISOString()
    };

    await write(data);

    return interaction.editReply({
      content: "🟢 **CLOCKED IN**",
      flags: MessageFlags.Ephemeral
    });
  }
};

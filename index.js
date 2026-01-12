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
      return interaction.editReply({
        content: "❌ This command can only be used in a server."
      });
    }

    const uid = interaction.user.id;
    const data = await read();

    data[uid] ??= {};

    if (data[uid].active) {
      return interaction.editReply({
        content: "❌ You are already clocked in."
      });
    }

    data[uid].active = {
      time: new Date().toISOString()
    };

    await write(data);

    return interaction.editReply({
      content: "🟢 **CLOCKED IN**"
    });
  }
};

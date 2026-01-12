import fs from "fs/promises";

const ACTIVE = "./timesheet.json";
const HISTORY = "./timesheetHistory.json";

export default {
  name: "timesheet",

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "reset") {
      if (!interaction.member.roles.cache.some(r => r.name === "Manager"))
        return interaction.editReply("❌ Manager only.");

      const current = JSON.parse(await fs.readFile(ACTIVE, "utf8") || "{}");
      let history = {};

      try { history = JSON.parse(await fs.readFile(HISTORY)); }
      catch {}

      history[new Date().toISOString()] = current;

      await fs.writeFile(HISTORY, JSON.stringify(history, null, 2));
      await fs.writeFile(ACTIVE, "{}");

      return interaction.editReply("♻️ Timesheet reset.");
    }

    interaction.editReply("❌ Unknown subcommand.");
  }
};

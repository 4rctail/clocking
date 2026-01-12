import fs from "fs/promises";

export default {
  name: "totalhr",

  async execute(interaction) {
    const data = JSON.parse(await fs.readFile("./timesheet.json", "utf8") || "{}");

    let total = 0;
    for (const u of Object.values(data)) {
      for (const l of u.logs || [])
        total += parseFloat(l.hours);
    }

    interaction.editReply(`⏱ Total hours: **${total.toFixed(2)}h**`);
  }
};

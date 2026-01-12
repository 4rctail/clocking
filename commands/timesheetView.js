import fs from "fs/promises";

const FILE = "./timesheet.json";

function parseDate(str, end = false) {
  const [m, d, y] = str.split("/").map(Number);
  if (!m || !d || !y) return null;

  const date = new Date(y, m - 1, d);
  if (end) date.setHours(23, 59, 59, 999);
  return date;
}

function formatSession(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const dateOpts = { month: "long", day: "numeric", year: "numeric" };
  const timeOpts = { hour: "numeric", minute: "2-digit" };

  const datePart = sameDay
    ? start.toLocaleDateString("en-US", dateOpts)
    : `${start.toLocaleDateString("en-US", dateOpts)} – ${end.toLocaleDateString("en-US", dateOpts)}`;

  const timePart =
    `${start.toLocaleTimeString("en-US", timeOpts)} - ${end.toLocaleTimeString("en-US", timeOpts)}`;

  return `${datePart}, ${timePart}`;
}

export default {
  name: "timesheet",

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== "view") return;

    // ✅ REQUIRED
    await interaction.deferReply();

    const uid = interaction.user.id;

    const startStr = interaction.options.getString("start");
    const endStr   = interaction.options.getString("end");

    const start = startStr ? parseDate(startStr) : null;
    const end   = endStr ? parseDate(endStr, true) : null;

    let data = {};
    try {
      data = JSON.parse(await fs.readFile(FILE, "utf8"));
    } catch {}

    const logs = data[uid]?.logs || [];

    let total = 0;
    let output = "";
    let i = 1;

    for (const l of logs) {
      const d = new Date(l.start);
      if ((!start || d >= start) && (!end || d <= end)) {
        total += parseFloat(l.hours);
        output += `${i}. ${formatSession(l.start, l.end)} (${l.hours}h)\n`;
        i++;
      }
    }

    // ✅ SAFE nickname fetch
    let displayName = interaction.user.username;
    try {
      const member = await interaction.guild.members.fetch(uid);
      displayName = member.displayName;
    } catch {}

    await interaction.editReply(
      `👤 **${displayName}**\n` +
      `⏱ **Total: ${total.toFixed(2)}h**\n\n` +
      (output || "📭 No sessions found.")
    );
  }
};

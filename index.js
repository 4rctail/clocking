import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// FILES
// =======================
const ACTIVE_FILE = "./timesheet.json";
const HISTORY_FILE = "./timesheetHistory.json";

// =======================
// GITHUB
// =======================
const GIT_TOKEN  = process.env.GIT_TOKEN;
const GIT_USER   = process.env.GIT_USER;
const GIT_REPO   = process.env.GIT_REPO;
const GIT_BRANCH = process.env.GIT_BRANCH || "main";

// =======================
// CLIENT
// =======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// =======================
// HELPERS
// =======================
async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return {}; }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function parseDate(str, end = false) {
  const [m, d, y] = str.split("/").map(Number);
  if (!m || !d || !y) return null;
  const date = new Date(y, m - 1, d);
  if (end) date.setHours(23, 59, 59, 999);
  return date;
}

function diffHours(a, b) {
  return ((new Date(b) - new Date(a)) / 36e5).toFixed(2);
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

async function syncFile(file) {
  if (!GIT_TOKEN) return;

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/${file}`;
  const content = Buffer.from(await fs.readFile(file)).toString("base64");

  let sha = null;
  const res = await fetch(api, {
    headers: { Authorization: `Bearer ${GIT_TOKEN}` },
  });

  if (res.ok) sha = (await res.json()).sha;

  await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Update ${file}`,
      content,
      sha,
      branch: GIT_BRANCH,
    }),
  });
}

// =======================
// COMMAND HANDLER
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 🔒 ALWAYS DEFER ONCE — prevents 40060 forever
  await interaction.deferReply();

  const member = interaction.member;
  const timesheet = await readJSON(ACTIVE_FILE);
  const history   = await readJSON(HISTORY_FILE);

  // =======================
  // CLOCK IN
  // =======================
  if (interaction.commandName === "clockin") {
    const uid = interaction.user.id;
    timesheet[uid] ??= { logs: [] };

    if (!member.voice?.channelId)
      return interaction.editReply("❌ Join voice first.");

    if (timesheet[uid].active)
      return interaction.editReply("❌ Already clocked in.");

    timesheet[uid].active = new Date().toISOString();

    await writeJSON(ACTIVE_FILE, timesheet);
    await syncFile("timesheet.json");

    return interaction.editReply("🟢 CLOCKED IN");
  }

  // =======================
  // CLOCK OUT
  // =======================
  if (interaction.commandName === "clockout") {
    const uid = interaction.user.id;
    const data = timesheet[uid];

    if (!data?.active)
      return interaction.editReply("❌ Not clocked in.");

    const end = new Date().toISOString();
    data.logs.push({
      start: data.active,
      end,
      hours: diffHours(data.active, end),
    });

    delete data.active;

    await writeJSON(ACTIVE_FILE, timesheet);
    await syncFile("timesheet.json");

    return interaction.editReply("🔴 CLOCKED OUT");
  }

  // =======================
  // TIMESHEET
  // =======================
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand();

    // ---------- VIEW ----------
    if (sub === "view") {
      const user = interaction.options.getUser("user") || interaction.user;
      const uid = user.id;

      const startStr = interaction.options.getString("start");
      const endStr   = interaction.options.getString("end");

      const start = startStr ? parseDate(startStr) : null;
      const end   = endStr ? parseDate(endStr, true) : null;

      let sessions = "";
      let i = 1;
      let grandTotal = 0;
      let lastSessionHours = null;

      const logs = timesheet[uid]?.logs || [];

      for (const l of logs) {
        grandTotal += parseFloat(l.hours);
        lastSessionHours = l.hours;

        const d = new Date(l.start);
        if ((!start || d >= start) && (!end || d <= end)) {
          sessions += `${i}. ${formatSession(l.start, l.end)}\n`;
          i++;
        }
      }

      return interaction.editReply(
        `👤 **${interaction.guild.members.cache.get(uid)?.displayName || user.username}**\n` +
        `⏱ **${grandTotal.toFixed(2)}h**\n\n` +
        (sessions
          ? `${sessions}\n**Last session hours:** ${lastSessionHours}`
          : "📭 No sessions found.")
      );
    }
  }

  // =======================
  // FALLBACK
  // =======================
  return interaction.editReply("❌ Unknown command.");
});

// =======================
// START
// =======================
(async () => {
  startKeepAlive();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";
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

function diffHours(a, b) {
  return ((new Date(b) - new Date(a)) / 36e5).toFixed(2);
}

function formatDuration(ms) {
  const h = Math.floor(ms / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  return `${h}h ${m}m`;
}

function formatSession(startISO, endISO) {
  const s = new Date(startISO);
  const e = new Date(endISO);
  return `${s.toLocaleString()} → ${e.toLocaleString()}`;
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
  await interaction.deferReply();

  const timesheet = await readJSON(ACTIVE_FILE);
  const history   = await readJSON(HISTORY_FILE);

  // =======================
  // CLOCK IN
  // =======================
  if (interaction.commandName === "clockin") {
    const uid = interaction.user.id;
    timesheet[uid] ??= { logs: [] };

    if (!interaction.member.voice?.channelId)
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
  // STATUS
  // =======================
  if (interaction.commandName === "status") {
    const user = interaction.options.getUser("user") || interaction.user;
    const uid = user.id;
    const data = timesheet[uid];

    if (!data)
      return interaction.editReply(`📭 No records for **${user.username}**`);

    let msg = `👤 **${user.username}**\n`;

    if (data.active) {
      const elapsed = Date.now() - new Date(data.active).getTime();
      msg += `🟢 **Clocked In**\n⏱ ${formatDuration(elapsed)}`;
    } else {
      msg += `🔴 **Not Clocked In**`;
    }

    return interaction.editReply(msg);
  }

  // =======================
  // TOTAL HOURS
  // =======================
  if (interaction.commandName === "totalhr") {
    let total = 0;

    for (const uid in timesheet) {
      for (const l of timesheet[uid].logs || []) {
        total += parseFloat(l.hours);
      }
    }

    return interaction.editReply(`⏱ **Total hours (all users): ${total.toFixed(2)}h**`);
  }

  // =======================
  // TIMESHEET
  // =======================
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand();

    // ---------- RESET ----------
    if (sub === "reset") {
      const member = interaction.member;
      const hasManager = member.roles.cache.some(r => r.name === "Manager");

      if (!hasManager)
        return interaction.editReply("❌ Manager role required.");

      const stamp = new Date().toISOString();
      history[stamp] = timesheet;

      await writeJSON(HISTORY_FILE, history);
      await writeJSON(ACTIVE_FILE, {});

      await syncFile("timesheet.json");
      await syncFile("timesheetHistory.json");

      return interaction.editReply("♻️ Timesheet reset and archived.");
    }
  }

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

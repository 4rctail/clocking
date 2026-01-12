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
// DISCORD CLIENT
// =======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// =======================
// FILE HELPERS
// =======================
async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// =======================
// TIME HELPERS
// =======================
function parseDate(str, end = false) {
  const [m, d, y] = str.split("/").map(Number);
  if (!m || !d || !y) return null;
  const date = new Date(y, m - 1, d);
  if (end) date.setHours(23, 59, 59, 999);
  return date;
}

function diffHours(start, end) {
  return ((new Date(end) - new Date(start)) / 36e5).toFixed(2);
}

// =======================
// GITHUB SYNC
// =======================
async function syncFile(file) {
  if (!GIT_TOKEN) return;

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/${file}`;
  const content = Buffer.from(await fs.readFile(file)).toString("base64");

  let sha = null;
  const get = await fetch(api, {
    headers: { Authorization: `Bearer ${GIT_TOKEN}` },
  });

  if (get.ok) sha = (await get.json()).sha;

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

  console.log(`✅ Synced ${file}`);
}

// =======================
// COMMAND HANDLER
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const userId = interaction.user.id;

  const timesheet = await readJSON(ACTIVE_FILE);
  const history   = await readJSON(HISTORY_FILE);

  timesheet[userId] ??= { logs: [] };

  const displayName = member.displayName;

  // =======================
  // CLOCK IN
  // =======================
  if (interaction.commandName === "clockin") {
    if (!member.voice?.channelId)
      return interaction.reply("❌ Join a voice channel first.");

    if (timesheet[userId].active)
      return interaction.reply("❌ Already clocked in.");

    timesheet[userId].active = new Date().toISOString();
    await writeJSON(ACTIVE_FILE, timesheet);
    await syncFile("timesheet.json");

    return interaction.reply("🟢 CLOCKED IN");
  }

  // =======================
  // CLOCK OUT
  // =======================
  if (interaction.commandName === "clockout") {
    const start = timesheet[userId].active;
    if (!start)
      return interaction.reply("❌ Not clocked in.");

    const end = new Date().toISOString();

    timesheet[userId].logs.push({
      start,
      end,
      hours: diffHours(start, end),
    });

    delete timesheet[userId].active;

    await writeJSON(ACTIVE_FILE, timesheet);
    await syncFile("timesheet.json");

    return interaction.reply("🔴 CLOCKED OUT");
  }

  // =======================
  // TIMESHEET
  // =======================
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand();

    // ---------- VIEW ----------
    if (sub === "view") {
      const startStr = interaction.options.getString("start");
      const endStr   = interaction.options.getString("end");

      const start = startStr ? parseDate(startStr) : null;
      const end   = endStr ? parseDate(endStr, true) : null;

      let total = 0;
      for (const l of timesheet[userId].logs) {
        const d = new Date(l.start);
        if ((!start || d >= start) && (!end || d <= end))
          total += parseFloat(l.hours);
      }

      return interaction.reply(
        `📊 **Timesheet Total**\n👤 ${displayName}\n⏱ **${total.toFixed(2)}h**`
      );
    }

    // ---------- RESET ----------
    if (sub === "reset") {
      const isManager = member.roles.cache.some(r => r.name === "Manager");
      if (!isManager)
        return interaction.reply("❌ Only **@Manager** can reset timesheets.");

      const startStr = interaction.options.getString("start");
      const endStr   = interaction.options.getString("end");

      const start = startStr ? parseDate(startStr) : null;
      const end   = endStr ? parseDate(endStr, true) : null;

      for (const uid in timesheet) {
        const logs = timesheet[uid].logs || [];
        const keep = [];
        const move = [];

        for (const l of logs) {
          const d = new Date(l.start);
          const inRange =
            (!start || d >= start) &&
            (!end || d <= end);

          (inRange ? move : keep).push(l);
        }

        if (move.length) {
          history[uid] ??= [];
          history[uid].push(...move);
        }

        timesheet[uid].logs = keep;
      }

      await writeJSON(ACTIVE_FILE, timesheet);
      await writeJSON(HISTORY_FILE, history);

      await syncFile("timesheet.json");
      await syncFile("timesheetHistory.json");

      return interaction.reply("♻️ Timesheet reset completed.");
    }
  }
});

// =======================
// STARTUP
// =======================
(async () => {
  startKeepAlive();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

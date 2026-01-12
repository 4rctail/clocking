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
const GIT_TOKEN = process.env.GIT_TOKEN;
const GIT_USER = process.env.GIT_USER;
const GIT_REPO = process.env.GIT_REPO;
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
function parseDate(str) {
  const [m, d, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}

function diffHours(a, b) {
  return ((new Date(b) - new Date(a)) / 36e5).toFixed(2);
}

// =======================
// GITHUB SYNC
// =======================
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

  console.log(`✅ Synced ${file}`);
}

// =======================
// VOICE CHECK
// =======================
function inVoice(member) {
  return member?.voice?.channelId;
}

// =======================
// COMMAND HANDLER
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const userId = interaction.user.id;

  const data = await readJSON(ACTIVE_FILE);
  const history = await readJSON(HISTORY_FILE);

  data[userId] ??= { logs: [] };

  // =======================
  // CLOCK IN
  // =======================
  if (interaction.commandName === "clockin") {
    if (!inVoice(member)) {
      await interaction.reply("❌ Join a voice channel before clocking in.");
      return;
    }

    if (data[userId].active) {
      await interaction.reply("❌ Already clocked in.");
      return;
    }

    data[userId].active = new Date().toISOString();
    await writeJSON(ACTIVE_FILE, data);
    await syncFile("timesheet.json");

    await interaction.reply("🟢 CLOCKED IN");
    return;
  }

  // =======================
  // CLOCK OUT
  // =======================
  if (interaction.commandName === "clockout") {
    if (!data[userId].active) {
      await interaction.reply("❌ Not clocked in.");
      return;
    }

    const start = data[userId].active;
    const end = new Date().toISOString();

    data[userId].logs.push({
      start,
      end,
      hours: diffHours(start, end),
    });

    delete data[userId].active;

    await writeJSON(ACTIVE_FILE, data);
    await syncFile("timesheet.json");

    await interaction.reply("🔴 CLOCKED OUT");
    return;
  }

  // =======================
  // TIMESHEET
  // =======================
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand(false);

    // ---------- RESET ----------
    if (sub === "reset") {
      const isManager = member.roles.cache.some(r => r.name === "Manager");
      if (!isManager) {
        await interaction.reply("❌ Only @Manager can reset timesheets.");
        return;
      }

      const startStr = interaction.options.getString("start");
      const endStr = interaction.options.getString("end");

      const startDate = startStr ? parseDate(startStr) : null;
      const endDate = endStr ? parseDate(endStr) : null;

      for (const uid in data) {
        const logs = data[uid].logs || [];
        const keep = [];
        const move = [];

        logs.forEach(l => {
          const d = new Date(l.start);
          const inRange =
            (!startDate || d >= startDate) &&
            (!endDate || d <= endDate);

          (inRange ? move : keep).push(l);
        });

        if (move.length) {
          history[uid] ??= [];
          history[uid].push(...move);
        }

        data[uid].logs = keep;
      }

      await writeJSON(HISTORY_FILE, history);
      await writeJSON(ACTIVE_FILE, data);

      await syncFile("timesheetHistory.json");
      await syncFile("timesheet.json");

      await interaction.reply("♻️ Timesheet reset completed.");
      return;
    }

    // ---------- VIEW ----------
    const logs = data[userId].logs || [];
    const startStr = interaction.options.getString("start");
    const endStr = interaction.options.getString("end");

    let startDate = startStr ? parseDate(startStr) : null;
    let endDate = endStr ? parseDate(endStr) : null;

    let total = 0;
    logs.forEach(l => {
      const d = new Date(l.start);
      if (
        (!startDate || d >= startDate) &&
        (!endDate || d <= endDate)
      ) {
        total += parseFloat(l.hours);
      }
    });

    await interaction.reply(`⏱ Total hours: **${total.toFixed(2)}h**`);
    return;
  }
});

// =======================
// START
// =======================
(async () => {
  startKeepAlive();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

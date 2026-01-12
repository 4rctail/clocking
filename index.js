import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// CONFIG
// =======================
const DATA_FILE = "./timesheet.json";
const HISTORY_FILE = "./timesheetHistory.json";

const GIT_TOKEN = process.env.GIT_TOKEN;
const GIT_USER = process.env.GIT_USER;
const GIT_REPO = process.env.GIT_REPO;
const GIT_BRANCH = process.env.GIT_BRANCH || "main";

const TIMEZONE = "Asia/Manila";

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
// MEMORY
// =======================
let timesheet = {};
let history = {};
let gitTimer = null;

// =======================
// TIME HELPERS
// =======================
const nowISO = () => new Date().toISOString();

const diffHours = (s, e) =>
  ((new Date(e) - new Date(s)) / 3600000).toFixed(2);

const formatDate = iso => new Date(iso).toLocaleString();

function elapsed(startISO) {
  const ms = Date.now() - new Date(startISO);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// =======================
// DATE PARSER (MM/DD/YYYY)
// =======================
function parseDate(str, endOfDay = false) {
  const [m, d, y] = str.split("/").map(Number);
  if (!m || !d || !y) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (endOfDay) date.setUTCHours(23, 59, 59, 999);
  return date;
}

// =======================
// GITHUB LOAD
// =======================
async function loadGitFile(path, localFile, target) {
  const url = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/${path}?ref=${GIT_BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clocking-bot",
    },
  });

  if (!res.ok) return {};

  const json = await res.json();
  const decoded = Buffer.from(json.content, "base64").toString("utf8");
  await fs.writeFile(localFile, decoded);
  return JSON.parse(decoded);
}

// =======================
// GITHUB COMMIT
// =======================
async function commitFile(path, content, message) {
  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/${path}`;
  let sha = null;

  const get = await fetch(api, {
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clocking-bot",
    },
  });

  if (get.ok) sha = (await get.json()).sha;

  await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clocking-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      sha,
      branch: GIT_BRANCH,
    }),
  });
}

function queueCommit() {
  if (gitTimer) return;
  gitTimer = setTimeout(async () => {
    gitTimer = null;
    await commitFile("timesheet.json", timesheet, "Update timesheet");
    await commitFile("timesheetHistory.json", history, "Update timesheet history");
    console.log("✅ GitHub committed");
  }, 3000);
}

// =======================
// 15-DAY ARCHIVE CHECK
// =======================
setInterval(async () => {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );

  if (now.getHours() !== 12 || now.getMinutes() !== 30) return;
  if (now.getDate() % 15 !== 0) return;

  console.log("📦 Archiving timesheet");

  for (const uid in timesheet) {
    history[uid] ??= [];
    if (timesheet[uid].logs)
      history[uid].push(...timesheet[uid].logs);
  }

  timesheet = {};
  await fs.writeFile(DATA_FILE, JSON.stringify(timesheet, null, 2));
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  queueCommit();
}, 60_000);

// =======================
// SLASH COMMANDS
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  const member = interaction.options.getMember("user") || interaction.member;
  const userId = member.id;

  // ✅ CORRECT NAME RESOLUTION
  const displayName = member.displayName;

  timesheet[userId] ??= { logs: [] };

  // -------- STATUS --------
  if (interaction.commandName === "status") {
    if (timesheet[userId].active) {
      return interaction.editReply(
        `🟢 CLOCKED IN\n👤 ${displayName}\n⏱ Started: ${formatDate(timesheet[userId].active)}\n⌛ Elapsed: ${elapsed(timesheet[userId].active)}`
      );
    }

    const total = timesheet[userId].logs.reduce(
      (t, l) => t + parseFloat(l.hours),
      0
    );

    return interaction.editReply(
      `⚪ CLOCKED OUT\n👤 ${displayName}\n⏱ Total hours: ${total.toFixed(2)}h`
    );
  }

  // -------- TIMESHEET RANGE --------
  if (interaction.commandName === "timesheet") {
    const startStr = interaction.options.getString("start");
    const endStr = interaction.options.getString("end");

    if (startStr && endStr) {
      const start = parseDate(startStr);
      const end = parseDate(endStr, true);
      if (!start || !end)
        return interaction.editReply("❌ Invalid date format.");

      const total = timesheet[userId].logs
        .filter(l => {
          const d = new Date(l.start);
          return d >= start && d <= end;
        })
        .reduce((t, l) => t + parseFloat(l.hours), 0);

      return interaction.editReply(
        `📊 Timesheet Total\n👤 ${displayName}\n📅 ${startStr} → ${endStr}\n⏱ ${total.toFixed(2)}h`
      );
    }

    // Default full list
    if (!timesheet[userId].logs.length)
      return interaction.editReply("📭 No records found.");

    let total = 0;
    let msg = `🧾 Timesheet — ${displayName}\n`;

    timesheet[userId].logs.forEach((l, i) => {
      total += parseFloat(l.hours);
      msg += `${i + 1}. ${formatDate(l.start)} → ${l.hours}h\n`;
    });

    msg += `\n⏱ Total: ${total.toFixed(2)}h`;
    return interaction.editReply(msg);
  }
});

// =======================
// STARTUP
// =======================
(async () => {
  startKeepAlive();
  timesheet = await loadGitFile("timesheet.json", DATA_FILE, timesheet);
  history = await loadGitFile("timesheetHistory.json", HISTORY_FILE, history);
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

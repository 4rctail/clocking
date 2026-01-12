import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// CONFIG
// =======================
const DATA_FILE = "./timesheet.json";

const GIT_TOKEN = process.env.GIT_TOKEN;
const GIT_USER = process.env.GIT_USER;
const GIT_REPO = process.env.GIT_REPO;
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
// IN-MEMORY STATE
// =======================
let timesheet = {};
let gitCommitTimer = null;

// =======================
// TIME HELPERS
// =======================
const nowISO = () => new Date().toISOString();

const diffHours = (s, e) =>
  ((new Date(e) - new Date(s)) / 3600000).toFixed(2);

const formatDate = iso => new Date(iso).toLocaleString();

function elapsed(startISO) {
  const ms = Date.now() - new Date(startISO).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// =======================
// GITHUB LOAD (SAFE)
// =======================
async function loadFromGitHub() {
  if (!GIT_TOKEN) {
    console.warn("⚠ GIT_TOKEN missing, GitHub sync disabled");
    return;
  }

  const url = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json?ref=${GIT_BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clocking-bot",
    },
  });

  if (!res.ok) {
    console.warn("⚠ No timesheet.json on GitHub yet");
    timesheet = {};
    await persist(); // create file on GitHub
    return;
  }

  const json = await res.json();
  const decoded = Buffer.from(json.content, "base64").toString("utf8");

  timesheet = JSON.parse(decoded);
  await fs.writeFile(DATA_FILE, decoded);

  console.log("✅ Loaded timesheet from GitHub");
}

// =======================
// PERSIST (DISK + QUEUED GIT)
// =======================
async function persist() {
  await fs.writeFile(DATA_FILE, JSON.stringify(timesheet, null, 2));
  queueGitCommit();
}

function queueGitCommit() {
  if (gitCommitTimer) return;

  gitCommitTimer = setTimeout(async () => {
    gitCommitTimer = null;
    await commitToGitHub();
  }, 3000);
}

// =======================
// GITHUB COMMIT (FIXED)
// =======================
async function commitToGitHub() {
  if (!GIT_TOKEN) return;

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json`;
  const content = Buffer.from(
    JSON.stringify(timesheet, null, 2)
  ).toString("base64");

  let sha = null;

  const get = await fetch(api, {
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clocking-bot",
    },
  });

  if (get.ok) {
    sha = (await get.json()).sha;
  }

  const put = await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clocking-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Update timesheet",
      content,
      sha,
      branch: GIT_BRANCH,
    }),
  });

  if (!put.ok) {
    const err = await put.text();
    console.error("❌ GitHub commit failed:", err);
    return;
  }

  console.log("✅ Timesheet committed to GitHub");
}

// =======================
// SLASH COMMANDS
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  const member = interaction.options.getMember("user") || interaction.member;
  const userId = member.id;
  const displayName = member.nickname || member.user.username;

  timesheet[userId] ??= { logs: [] };

  // -------- CLOCK IN --------
  if (interaction.commandName === "clockin") {
    if (!member.voice.channelId)
      return interaction.editReply("❌ Join voice first.");

    if (timesheet[userId].active)
      return interaction.editReply("❌ Already clocked in.");

    timesheet[userId].active = nowISO();
    await persist();

    return interaction.editReply("🟢 Clocked IN");
  }

  // -------- CLOCK OUT --------
  if (interaction.commandName === "clockout") {
    const start = timesheet[userId].active;
    if (!start)
      return interaction.editReply("❌ Not clocked in.");

    const end = nowISO();
    timesheet[userId].logs.push({
      start,
      end,
      hours: diffHours(start, end),
    });

    delete timesheet[userId].active;
    await persist();

    return interaction.editReply(
      `🔴 Clocked OUT — ${diffHours(start, end)}h`
    );
  }

  // -------- STATUS (FIXED) --------
  if (interaction.commandName === "status") {
    if (timesheet[userId].active) {
      return interaction.editReply(
        `🟢 CLOCKED IN\n` +
        `👤 ${displayName}\n` +
        `⏱ Started: ${formatDate(timesheet[userId].active)}\n` +
        `⌛ Elapsed: ${elapsed(timesheet[userId].active)}`
      );
    }

    const total = timesheet[userId].logs.reduce(
      (t, l) => t + parseFloat(l.hours),
      0
    );

    return interaction.editReply(
      `⚪ CLOCKED OUT\n` +
      `👤 ${displayName}\n` +
      `⏱ Total hours: ${total.toFixed(2)}h`
    );
  }

  // -------- TIMESHEET --------
  if (interaction.commandName === "timesheet") {
    const logs = timesheet[userId].logs;
    if (!logs.length)
      return interaction.editReply("📭 No records found.");

    let msg = `🧾 Timesheet — ${displayName}\n`;
    let total = 0;

    logs.forEach((l, i) => {
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
  await loadFromGitHub();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

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
// IN-MEMORY CACHE (CRITICAL)
// =======================
let timesheetCache = {};
let gitSyncTimer = null;

// =======================
// TIME HELPERS
// =======================
const nowISO = () => new Date().toISOString();
const diffHours = (s, e) =>
  ((new Date(e) - new Date(s)) / 3600000).toFixed(2);

const formatDate = iso => new Date(iso).toLocaleString();

// =======================
// GITHUB LOAD (SAFE)
// =======================
async function loadFromGitHub() {
  if (!GIT_TOKEN) {
    timesheetCache = {};
    return;
  }

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json?ref=${GIT_BRANCH}`;

  try {
    const res = await fetch(api, {
      headers: { Authorization: `Bearer ${GIT_TOKEN}` },
    });

    if (!res.ok) {
      console.warn("⚠ No timesheet on GitHub yet, creating new one");
      timesheetCache = {};
      await persist();
      return;
    }

    const json = await res.json();
    const decoded = Buffer.from(json.content, "base64").toString("utf8");

    timesheetCache = JSON.parse(decoded);
    await fs.writeFile(DATA_FILE, decoded);

    console.log("✅ Loaded timesheet from GitHub");
  } catch (err) {
    console.error("❌ GitHub load failed, using local cache", err);
    timesheetCache = {};
  }
}

// =======================
// SAVE (DEBOUNCED GITHUB SYNC)
// =======================
async function persist() {
  await fs.writeFile(DATA_FILE, JSON.stringify(timesheetCache, null, 2));
  queueGitSync();
}

function queueGitSync() {
  if (gitSyncTimer) return;

  gitSyncTimer = setTimeout(async () => {
    gitSyncTimer = null;
    await syncGitHub();
  }, 3000); // debounce
}

// =======================
// GITHUB SYNC (FAST & SAFE)
// =======================
async function syncGitHub() {
  if (!GIT_TOKEN) return;

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json`;
  const content = Buffer.from(
    JSON.stringify(timesheetCache, null, 2)
  ).toString("base64");

  let sha = null;
  const get = await fetch(api, {
    headers: { Authorization: `Bearer ${GIT_TOKEN}` },
  });

  if (get.ok) {
    sha = (await get.json()).sha;
  }

  await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GIT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Update timesheet",
      content,
      sha,
      branch: GIT_BRANCH,
    }),
  });

  console.log("✅ Timesheet synced to GitHub");
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

  timesheetCache[userId] ??= { logs: [] };

  // -------- CLOCK IN --------
  if (interaction.commandName === "clockin") {
    if (!member.voice.channelId)
      return interaction.editReply("❌ Join voice first.");

    if (timesheetCache[userId].active)
      return interaction.editReply("❌ Already clocked in.");

    timesheetCache[userId].active = nowISO();
    await persist();

    return interaction.editReply("🟢 Clocked IN");
  }

  // -------- CLOCK OUT --------
  if (interaction.commandName === "clockout") {
    const active = timesheetCache[userId].active;
    if (!active)
      return interaction.editReply("❌ Not clocked in.");

    const end = nowISO();
    timesheetCache[userId].logs.push({
      start: active,
      end,
      hours: diffHours(active, end),
    });

    delete timesheetCache[userId].active;
    await persist();

    return interaction.editReply(
      `🔴 Clocked OUT — ${diffHours(active, end)}h`
    );
  }

  // -------- STATUS --------
  if (interaction.commandName === "status") {
    if (timesheetCache[userId].active) {
      return interaction.editReply(
        `🟢 CLOCKED IN\n👤 ${displayName}`
      );
    }

    const total = timesheetCache[userId].logs.reduce(
      (t, l) => t + parseFloat(l.hours),
      0
    );

    return interaction.editReply(
      `⚪ CLOCKED OUT\n👤 ${displayName}\n⏱ Total hours: ${total.toFixed(2)}h`
    );
  }

  // -------- TIMESHEET (FIXED) --------
  if (interaction.commandName === "timesheet") {
    const logs = timesheetCache[userId].logs;
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

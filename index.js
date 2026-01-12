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
// VOICE TIMERS
// =======================
const voiceTimers = new Map();

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
// GITHUB LOAD (ON STARTUP)
// =======================
async function loadFromGitHub() {
  if (!GIT_TOKEN) return {};

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json?ref=${GIT_BRANCH}`;

  try {
    const res = await fetch(api, {
      headers: { Authorization: `Bearer ${GIT_TOKEN}` },
    });

    if (!res.ok) return {};

    const json = await res.json();
    const decoded = Buffer.from(json.content, "base64").toString("utf8");

    await fs.writeFile(DATA_FILE, decoded);
    console.log("✅ Loaded timesheet from GitHub");
    return JSON.parse(decoded);
  } catch (e) {
    console.error("❌ Failed to load GitHub timesheet", e);
    return {};
  }
}

// =======================
// FILE HELPERS
// =======================
async function loadData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  await syncGitHub();
}

// =======================
// GITHUB SYNC (SAVE)
// =======================
async function syncGitHub() {
  if (!GIT_TOKEN) return;

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json`;
  const content = Buffer.from(await fs.readFile(DATA_FILE)).toString("base64");

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
// VOICE ENFORCEMENT
// =======================
client.on("voiceStateUpdate", async (oldState, newState) => {
  const userId = newState.id;
  if (oldState.channelId && !newState.channelId) {
    const data = await loadData();
    if (!data[userId]?.active) return;

    clearVoiceTimers(userId);

    const channel =
      newState.guild.systemChannel ??
      newState.guild.channels.cache.find(
        c => c.isTextBased()
      );

    if (!channel) return;

    const warnTimeout = setTimeout(() => {
      channel.send(
        `⚠️ <@${userId}> you left voice chat while **CLOCKED IN**.\nYou have **2 minutes 30 seconds** to rejoin.`
      );
    }, 150_000);

    const forceTimeout = setTimeout(async () => {
      const latest = await loadData();
      if (!latest[userId]?.active) return;

      const start = latest[userId].active;
      const end = nowISO();

      latest[userId].logs.push({
        start,
        end,
        hours: diffHours(start, end),
      });

      delete latest[userId].active;
      await saveData(latest);

      channel.send(
        `⛔ <@${userId}> was **FORCIBLY CLOCKED OUT**`
      );

      clearVoiceTimers(userId);
    }, 300_000);

    voiceTimers.set(userId, { warnTimeout, forceTimeout });
  }

  if (!oldState.channelId && newState.channelId) {
    clearVoiceTimers(userId);
  }
});

function clearVoiceTimers(userId) {
  const t = voiceTimers.get(userId);
  if (!t) return;
  clearTimeout(t.warnTimeout);
  clearTimeout(t.forceTimeout);
  voiceTimers.delete(userId);
}

// =======================
// SLASH COMMANDS
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  const data = await loadData();
  const member = interaction.options.getMember("user") || interaction.member;
  const userId = member.id;

  data[userId] ??= { logs: [] };

  const displayName = member.nickname || member.user.username;

  if (interaction.commandName === "clockin") {
    if (!member.voice.channelId)
      return interaction.editReply("❌ Join voice first.");

    if (data[userId].active)
      return interaction.editReply("❌ Already clocked in.");

    data[userId].active = nowISO();
    await saveData(data);

    return interaction.editReply("🟢 Clocked IN");
  }

  if (interaction.commandName === "clockout") {
    if (!data[userId].active)
      return interaction.editReply("❌ Not clocked in.");

    const start = data[userId].active;
    const end = nowISO();

    data[userId].logs.push({
      start,
      end,
      hours: diffHours(start, end),
    });

    delete data[userId].active;
    await saveData(data);
    clearVoiceTimers(userId);

    return interaction.editReply(`🔴 Clocked OUT — ${diffHours(start, end)}h`);
  }

  if (interaction.commandName === "status") {
    if (data[userId].active) {
      return interaction.editReply(
        `🟢 CLOCKED IN\n` +
        `👤 ${displayName}\n` +
        `⏱ Started: ${formatDate(data[userId].active)}\n` +
        `⌛ Elapsed: ${elapsed(data[userId].active)}`
      );
    }

    const total = data[userId].logs.reduce(
      (t, l) => t + parseFloat(l.hours),
      0
    );

    return interaction.editReply(
      `⚪ CLOCKED OUT\n` +
      `👤 ${displayName}\n` +
      `⏱ Total hours: ${total.toFixed(2)}h`
    );
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

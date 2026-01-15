import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// CONFIG
// =======================
const PH_TZ = "Asia/Manila";
const DATA_FILE = "./timesheet.json";
const MANAGER_IDS = ["769554444534153238", "854713123851337758","921936530778517614"];
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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Prevent crashes from unhandled Discord errors
client.on("error", (err) => {
  console.error("Discord client error:", err);
});

let timesheet = {};
let gitCommitTimer = null;

function mergeUserData(oldKey, newUserId) {
  const oldData = timesheet[oldKey];
  if (!oldData) return;

  // If target doesn't exist, create it
  if (!timesheet[newUserId]) {
    timesheet[newUserId] = {
      userId: newUserId,
      name: oldData.name || oldKey,
      lastKnownNames: oldData.lastKnownNames || [oldData.name || oldKey],
      logs: [],
      active: oldData.active || null,
    };
  }

  const target = timesheet[newUserId];

  // Merge logs, avoid duplicates
  const allLogs = [...(target.logs || []), ...(oldData.logs || [])];
  const seen = new Set();
  const mergedLogs = [];
  for (const log of allLogs) {
    const key = `${log.start}|${log.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      mergedLogs.push(log);
    }
  }
  target.logs = mergedLogs;

  // Merge lastKnownNames
  target.lastKnownNames = Array.from(new Set([
    ...(target.lastKnownNames || []),
    ...(oldData.lastKnownNames || []),
    oldData.name || oldKey
  ]));

  // Preserve active if target has none
  if (!target.active && oldData.active) target.active = oldData.active;

  // Preserve name if missing
  if (!target.name && oldData.name) target.name = oldData.name;

  // Verify logs copied successfully
  if ((oldData.logs?.length || 0) <= (target.logs?.length || 0)) {
    delete timesheet[oldKey];
    console.log(`✅ Merged ${oldKey} → ${newUserId}`);
  }
}

/**
 * Iterate over all keys and migrate old username keys
 */
function autoMergeOldUsers() {
  const keys = Object.keys(timesheet);
  for (const key of keys) {
    const data = timesheet[key];
    // Skip proper userId entries
    if (data.userId && data.userId === key) continue;

    // If old key has logs + name
    if (data.name && data.logs) {
      // Try to find existing userId entry with same name
      const targetKey = Object.keys(timesheet).find(
        k => k !== key && timesheet[k].userId && timesheet[k].name === data.name
      );

      if (targetKey) {
        mergeUserData(key, targetKey);
      } else if (data.userId) {
        mergeUserData(key, data.userId);
      }
    }
  }
}



function formatSession(startISO, endISO) {
  const dateOpts = {
    timeZone: PH_TZ,
    month: "long",
    day: "numeric",
    year: "numeric",
  };

  const timeOpts = {
    timeZone: PH_TZ,
    hour: "numeric",
    minute: "2-digit",
  };

  const s = new Date(startISO);
  const e = new Date(endISO);

  const sameDay =
    s.toLocaleDateString("en-PH", dateOpts) ===
    e.toLocaleDateString("en-PH", dateOpts);

  const datePart = sameDay
    ? s.toLocaleDateString("en-PH", dateOpts)
    : `${s.toLocaleDateString("en-PH", dateOpts)} – ${e.toLocaleDateString("en-PH", dateOpts)}`;

  const timePart =
    `${s.toLocaleTimeString("en-PH", timeOpts)} - ${e.toLocaleTimeString("en-PH", timeOpts)}`;

  return `${datePart}, ${timePart}`;
}


async function loadFromDisk() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    timesheet = JSON.parse(raw);
  } catch {
    timesheet = {};
  }
}

async function safeEdit(interaction, payload) {
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(payload);
    } else {
      await interaction.editReply(payload);
    }
  } catch (err) {
    // Ignore if interaction is unknown or expired
    if (err.code === 10062) return;
    console.error("Interaction update failed:", err);
  }
}

async function safeGetMember(interaction, userId) {
  if (!interaction.inGuild()) return null;
  if (!interaction.guild) return null;

  return (
    interaction.guild.members.cache.get(userId) ||
    await interaction.guild.members.fetch(userId).catch(() => null)
  );
}


// =======================
// STRICT USER RESOLUTION (ID-FIRST)
// =======================
function resolveStrictUser(interaction) {
  const user = interaction.user;
  const member = interaction.member;

  if (!user?.id) return null;

  const name =
    member?.displayName ||
    user.globalName ||
    user.username ||
    null;

  if (!name) return null;

  return {
    userId: user.id,
    name,
  };
}

function ensureUserRecord(userId, name) {
  if (!userId || !name) return null;

  if (!timesheet[userId]) {
    // create new record if doesn't exist
    timesheet[userId] = {
      userId,
      name,
      lastKnownNames: [name],
      logs: [],
      active: null,
    };
    return timesheet[userId];
  }

  const record = timesheet[userId];

  // Update username if changed
  if (record.name !== name) {
    if (!record.lastKnownNames.includes(record.name)) {
      record.lastKnownNames.push(record.name);
    }
    record.name = name;
  }

  // Ensure logs array and active are valid
  if (!Array.isArray(record.logs)) record.logs = [];
  if (record.active === undefined) record.active = null;

  return record;
}

/**
 * Append new logs safely
 * Only adds logs that are not duplicates (by start+end)
 */
function appendLogs(userId, newLogs) {
  const record = timesheet[userId];
  if (!record) return;

  for (const log of newLogs) {
    const exists = record.logs.some(
      (l) => l.start === log.start && l.end === log.end
    );
    if (!exists) {
      record.logs.push(log);
    }
  }
}


function parseDate(str, end = false) {
  if (!str) return null;

  // REMOVE commas, trim spaces
  str = str.replace(/,/g, "").trim();

  const parts = str.split("/");
  if (parts.length !== 3) return null;

  const m = Number(parts[0]);
  const d = Number(parts[1]);
  const y = Number(parts[2]);

  if (
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    !Number.isInteger(y)
  ) return null;

  const date = new Date(y, m - 1, d);
  if (end) date.setHours(23, 59, 59, 999);
  return date;
}

function formatElapsedLive(startISO) {
  const diff = Date.now() - new Date(startISO).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

// Track live status updates per user
const liveStatusTimers = new Map();

/**
 * Merge old username keys into proper userId entries before saving
 */

function mergeBeforePersist() {
  const keys = Object.keys(timesheet);

  for (const key of keys) {
    const data = timesheet[key];
    if (!data || typeof data !== "object") continue;

    // Skip already-correct userId records
    if (data.userId && key === data.userId) continue;

    if (!Array.isArray(data.logs) || !data.name) continue;

    // Find correct target by userId first
    let target = null;

    if (data.userId && timesheet[data.userId]) {
      target = timesheet[data.userId];
    } else {
      // Fallback: find by name with userId
      target = Object.values(timesheet).find(
        u => u.userId && u.name === data.name
      );
    }

    if (!target) continue;

    // --- ENSURE STRUCTURE ---
    target.logs ??= [];
    target.lastKnownNames ??= [];
    if (target.active === undefined) target.active = null;

    // --- MERGE LOGS ---
    for (const log of data.logs) {
      if (
        log?.start &&
        log?.end &&
        !target.logs.some(l => l.start === log.start && l.end === log.end)
      ) {
        target.logs.push(log);
      }
    }

    // --- MERGE ACTIVE ---
    if (!target.active && data.active) {
      target.active = data.active;
    }

    // --- MERGE NAMES ---
    if (data.name && !target.lastKnownNames.includes(data.name)) {
      target.lastKnownNames.push(data.name);
    }

    // --- DELETE OLD KEY ---
    delete timesheet[key];
    console.log(`✅ Migrated ${key} → ${target.userId}`);
  }
}

// =======================
// Updated persist
// =======================
async function persist() {
  mergeBeforePersist(); // merge before writing

  await fs.writeFile(DATA_FILE, JSON.stringify(timesheet, null, 2));
  queueGitCommit();
}


// =======================
// TIME HELPERS
// =======================
const nowISO = () => new Date().toISOString();

const diffHours = (s, e) =>
  (new Date(e) - new Date(s)) / 3600000;


const formatDate = iso =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: PH_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });


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

function hasManagerRoleById(userId) {
  return MANAGER_IDS.includes(userId);
}

process.on("unhandledRejection", err => {
  console.error("Unhandled rejection:", err);
});

// =======================
// SLASH COMMANDS
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
  }

  await interaction.deferReply();
  
    
    
    // -------- TOTAL HOURS (ALL USERS) --------
    // -------- TOTAL HOURS (ALL USERS) --------
    if (interaction.commandName === "totalhr") {
      await loadFromDisk();

      let lines = [];
    
      for (const user of Object.values(timesheet)) {
        if (!user?.logs?.length) continue;
    
        let total = 0;
        for (const l of user.logs) {
          if (typeof l.hours === "number") total += l.hours;
        }
    
        total = Math.round(total * 100) / 100;
        if (total <= 0) continue;
    
        lines.push(`**${user.name}** — ${total.toFixed(2)}h`);
      }
    
      if (!lines.length) {
        return interaction.editReply("📭 No tracked hours.");
      }
    
      return interaction.editReply({
        embeds: [{
          title: "📊 Total Hours (All Users)",
          color: 0x9b59b6,
          description: lines.join("\n"),
          footer: { text: "Time Tracker" },
          timestamp: new Date().toISOString(),
        }],
      });
    }



  // -------- CLOCK IN --------
  if (interaction.commandName === "clockin") {
    await loadFromDisk();
  
    const user = resolveStrictUser(interaction);
    if (!user) {
      return interaction.editReply("❌ Cannot resolve user.");
    }
  
    const record = ensureUserRecord(user.userId, user.name);
  
    if (record.active) {
      return interaction.editReply("❌ Already clocked in.");
    }
  
    record.active = nowISO();
    await persist();
  
    return interaction.editReply({
      embeds: [{
        title: "🟢 Clocked In",
        color: 0x2ecc71,
        fields: [
          { name: "👤 User", value: record.name },
          { name: "🆔 User ID", value: record.userId },
          { name: "⏱ Start", value: formatDate(record.active) },
        ],
        timestamp: new Date().toISOString(),
      }],
    });
  }



  // -------- CLOCK OUT --------
  // -------- CLOCK OUT (EMBED + DETAILS) --------
  if (interaction.commandName === "clockout") {
    await loadFromDisk();

    const user = resolveStrictUser(interaction);
    if (!user) {
      return interaction.editReply("❌ Cannot resolve user.");
    }
  
    const record = ensureUserRecord(user.userId, user.name);
  
    if (!record.active) {
      return interaction.editReply("❌ Not clocked in.");
    }
  
    const start = record.active;
    const end = nowISO();
    const hours = diffHours(start, end);
    const rounded = Math.round(hours * 100) / 100;

    record.logs.push({
      start,
      end,
      hours,
    });
  
    record.active = null;
    await persist();
  
    return interaction.editReply({
      embeds: [{
        title: "🔴 Clocked Out",
        color: 0xe74c3c,
        fields: [
          { name: "👤 User", value: record.name },
          { name: "▶️ Started", value: formatDate(start), inline: false },
          { name: "⏹ Ended", value: formatDate(end), inline: false },
          { name: "⏱ Session Duration", value: `${rounded}h`, inline: true },
          {
            name: "⚠️ Reminder",
            value: "**REMINDER: UPDATE AD SPENT**",
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      }],
    });
  }



  // -------- STATUS (EMBED + LIVE UPDATE) --------
  // -------- STATUS (SAFE, ID-ONLY, NO CRASHES) --------
  if (interaction.commandName === "status") {
    await loadFromDisk();

  
    const uid = interaction.user.id;
    const record = timesheet[uid];
  
    // ===== CLOCKED IN =====
    if (record?.active) {
      const start = record.active;
  
      const embedBase = {
        title: "🟢 Status: Clocked In",
        color: 0x2ecc71,
        footer: { text: "Live updating every 5 seconds" },
      };
  
      const buildEmbed = () => ({
        ...embedBase,
        fields: [
          { 
            name: "👤 User",
            value:
              interaction.member?.displayName ||
              interaction.user.globalName ||
              interaction.user.username,
            inline: true,
          },
          {
            name: "📍 Voice Channel",
            value:
              interaction.member?.voice?.channel?.name ||
              "Not in voice",
            inline: true,
          },
          {
            name: "▶️ Started",
            value: formatDate(start),
            inline: false,
          },
          {
            name: "⏱ Elapsed",
            value: formatElapsedLive(start),
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      });
  
      // clear existing timer
      const existing = liveStatusTimers.get(uid);
      if (existing) {
        clearInterval(existing);
        liveStatusTimers.delete(uid);
      }
  
      await safeEdit(interaction, { embeds: [buildEmbed()] });

      const timer = setInterval(async () => {
        // Stop if user no longer active
        if (!timesheet[uid]?.active) {
          clearInterval(timer);
          liveStatusTimers.delete(uid);
          return;
        }
      
        const embed = buildEmbed(); // your existing buildEmbed function
      
        await safeEdit(interaction, { embeds: [embed] });
      }, 5000);

  
      liveStatusTimers.set(uid, timer);
      return;
    }
  
    // ===== CLOCKED OUT =====
    const total =
      record?.logs?.reduce((t, l) => t + l.hours, 0) || 0;
  
    return interaction.editReply({
      embeds: [{
        title: "⚪ Status: Clocked Out",
        color: 0x95a5a6,
        fields: [
          {
            name: "👤 User",
            value:
              interaction.member?.displayName ||
              interaction.user.globalName ||
              interaction.user.username,
            inline: true,
          },
          {
            name: "⏱ Total Recorded Time",
            value: `${Math.round(total * 100) / 100}h`,
            inline: true,
          },
        ],
        footer: { text: "No active session" },
        timestamp: new Date().toISOString(),
      }],
    });
  }


  // -------- TIMESHEET --------
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand(false);
  
    if (sub !== "view") return;
  
    await loadFromDisk();
  
    // options (all optional)
    const requestedUser = interaction.options.getUser("user");
    const targetUser = requestedUser || interaction.user;
    
    // permission check
    if (
      requestedUser &&
      requestedUser.id !== interaction.user.id &&
      !hasManagerRoleById(interaction.user.id)
    ) {
      return interaction.editReply("❌ You don’t have permission to view other users’ timesheets.");
    }

    const startStr = interaction.options.getString("start");
    const endStr   = interaction.options.getString("end");
  
    // parse dates
    const start = parseDate(startStr);
    const end   = parseDate(endStr, true);
    const member = await safeGetMember(interaction, targetUser.id);
  
    const displayName =
      member?.displayName ||
      targetUser.globalName ||
      targetUser.username;
  
    // fetch record
    const record = timesheet[targetUser.id];
  
    if (!record || !Array.isArray(record.logs) || record.logs.length === 0) {
      return interaction.editReply("📭 No records found.");
    }
  
    // filter logs by date range
    let total = 0;
    let lines = [];
    let count = 0;
  
    for (const l of record.logs) {
      const sessionStart = new Date(l.start);
  
      if ((start && sessionStart < start) || (end && sessionStart > end)) continue;
  
      const hours = (new Date(l.end) - new Date(l.start)) / 3600000;
      total += hours;
      count++;
  
      lines.push(
        `**${count}.** ${formatSession(l.start, l.end)} — **${Math.round(hours * 100) / 100}h**`
      );
    }
  
    if (!count) {
      return interaction.editReply("📭 No sessions in the selected range.");
    }
  
    // range label
    const rangeLabel =
      startStr || endStr
        ? `${startStr || "Beginning"} → ${endStr || "Now"}`
        : "All time";
  
    // response
    return interaction.editReply({
      embeds: [{
        title: "🧾 Timesheet",
        color: 0x3498db,
        fields: [
          { name: "👤 User", value: displayName, inline: true },
          { name: "🆔 User ID", value: targetUser.id, inline: true },
          { name: "📅 Range", value: rangeLabel, inline: true },
          { name: "🧮 Sessions", value: String(count), inline: true },
          { name: "⏱ Total Hours", value: `${Math.round(total * 100) / 100}h`, inline: true },
          { name: "📋 Logs", value: lines.join("\n"), inline: false },
        ],
        footer: { text: "Time Tracker" },
        timestamp: new Date().toISOString(),
      }],
    });
  }
});  

// =======================
// STARTUP
// =======================
(async () => {
  await loadFromGitHub();
  await persist(); // persist already merges safely

  startKeepAlive();
  await client.login(process.env.DISCORD_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

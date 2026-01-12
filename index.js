import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// CONFIG
// =======================
const PH_TZ = "Asia/Manila";
const DATA_FILE = "./timesheet.json";
const MANAGER_ROLE_NAME = "Manager"; // change if needed
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



function resolveDisplayName(interaction, member) {
  if (member?.displayName) return member.displayName;
  if (member?.nickname) return member.nickname;
  if (member?.user?.globalName) return member.user.globalName;
  if (member?.user?.username) return member.user.username;
  return interaction.user.globalName
      || interaction.user.username
      || "Unknown User";
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

function hasManagerRole(member) {
  return member.roles.cache.some(r => r.name === MANAGER_ROLE_NAME);
}

// =======================
// SLASH COMMANDS
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  const member =
    interaction.options.getMember("user") ??
    interaction.member ??
    (await interaction.guild.members.fetch(interaction.user.id));
  
  const userId = member.id;
  const displayName = resolveDisplayName(interaction, member);
  
    
    // -------- TOTAL HOURS (ALL USERS) --------
    // -------- TOTAL HOURS (ALL USERS) --------
    if (interaction.commandName === "totalhr") {
      let lines = [];
    
      for (const [uid, u] of Object.entries(timesheet)) {
        // HARD GUARD — skip invalid users
        if (!u || !Array.isArray(u.logs) || u.logs.length === 0) continue;
    
        let total = 0;
        for (const l of u.logs) {
          if (typeof l.hours === "number") {
            total += l.hours;
          }
        }
    
        total = Math.round(total * 100) / 100;
        if (total <= 0) continue;
    
        let name = u.name || "Unknown";
    
        try {
          const m = await interaction.guild.members.fetch(uid);
          name = m.displayName || m.user.username;
        } catch {}
    
        lines.push(`${name} — ${total.toFixed(2)}h`);
      }
    
      if (!lines.length) {
        return interaction.editReply("📭 No tracked hours.");
      }
    
      return interaction.editReply(
        `📊 **Total Hours (All Users)**\n` + lines.join("\n")
      );
    }
    


  // -------- CLOCK IN --------
  // -------- CLOCK IN (EMBED) --------
  if (interaction.commandName === "clockin") {
    if (!timesheet[userId]) {
      timesheet[userId] = {
        name: displayName,
        logs: [],
      };
    }
  
    if (timesheet[userId].active) {
      return interaction.editReply("❌ Already clocked in.");
    }
  
    const start = nowISO();
    timesheet[userId].active = start;
    timesheet[userId].name = displayName;
  
    await persist();
  
    const voiceChannel =
      interaction.member?.voice?.channel?.name || "Not in voice";
  
    return interaction.editReply({
      embeds: [{
        title: "🟢 Clocked In",
        color: 0x2ecc71,
        fields: [
          { name: "👤 User", value: displayName, inline: true },
          { name: "📍 Voice Channel", value: voiceChannel, inline: true },
          { name: "⏱ Start Time", value: formatDate(start) },
        ],
        footer: { text: "Time Tracker" },
        timestamp: new Date(start).toISOString(),
      }],
    });
  }


  // -------- CLOCK OUT --------
  // -------- CLOCK OUT (EMBED + DETAILS) --------
  if (interaction.commandName === "clockout") {
    const start = timesheet[userId].active;
    if (!start)
      return interaction.editReply("❌ Not clocked in.");
  
    const end = nowISO();
    const hours = diffHours(start, end);
    const rounded = Math.round(hours * 100) / 100;
  
    timesheet[userId].logs.push({
      start,
      end,
      hours,
    });
  
    delete timesheet[userId].active;
    timesheet[userId].name = displayName;
  
    await persist();
  
    const voiceChannel =
      interaction.member?.voice?.channel?.name || "Not in voice";
  
    const embed = {
      title: "🔴 Clocked Out",
      color: 0xe74c3c,
      fields: [
        { name: "👤 User", value: displayName, inline: true },
        { name: "📍 Voice Channel", value: voiceChannel, inline: true },
        { name: "▶️ Started", value: formatDate(start), inline: false },
        { name: "⏹ Ended", value: formatDate(end), inline: false },
        { name: "⏱ Session Duration", value: `${rounded}h`, inline: true },
      ],
      footer: {
        text: "Time Tracker",
      },
      timestamp: new Date(end).toISOString(),
    };
  
    return interaction.editReply({ embeds: [embed] });
  }
  

  // -------- STATUS (EMBED + LIVE UPDATE) --------
  if (interaction.commandName === "status") {
    // CLEAR EXISTING LIVE TIMER IF ANY
    const existing = liveStatusTimers.get(userId);
    if (existing) {
      clearInterval(existing);
      liveStatusTimers.delete(userId);
    }
  
    // ===== CLOCKED IN =====
    if (timesheet[userId].active) {
      const start = timesheet[userId].active;
  
      const buildEmbed = () => ({
        title: "🟢 Status: Clocked In",
        color: 0x2ecc71,
        fields: [
          { name: "👤 User", value: displayName, inline: true },
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
        footer: { text: "Live updating every 5 seconds" },
        timestamp: new Date().toISOString(),
      });
  
      // SEND INITIAL EMBED
      await interaction.editReply({ embeds: [buildEmbed()] });
  
      // START LIVE UPDATES
      const timer = setInterval(async () => {
        // STOP IF USER CLOCKED OUT
        if (!timesheet[userId]?.active) {
          clearInterval(timer);
          liveStatusTimers.delete(userId);
          return;
        }
  
        try {
          await interaction.editReply({
            embeds: [buildEmbed()],
          });
        } catch {
          clearInterval(timer);
          liveStatusTimers.delete(userId);
        }
      }, 5000);
  
      liveStatusTimers.set(userId, timer);
      return;
    }
  
    // ===== CLOCKED OUT =====
    const total = (timesheet[userId].logs || []).reduce(
      (t, l) => t + l.hours,
      0
    );
  
    const embed = {
      title: "⚪ Status: Clocked Out",
      color: 0x95a5a6,
      fields: [
        { name: "👤 User", value: displayName, inline: true },
        {
          name: "⏱ Total Recorded Time",
          value: `${Math.round(total * 100) / 100}h`,
          inline: true,
        },
      ],
      footer: { text: "No active session" },
      timestamp: new Date().toISOString(),
    };
  
    return interaction.editReply({ embeds: [embed] });
  }


  // -------- TIMESHEET --------
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand(false);
  
    // ===== RESET (MANAGER ONLY) =====
    if (sub === "reset") {
      if (!hasManagerRole(interaction.member))
        return interaction.editReply("❌ Managers only.");
  
      let history = {};
      try {
        history = JSON.parse(
          await fs.readFile("./timesheetHistory.json", "utf8")
        );
      } catch {}
  
      const stamp = new Date().toISOString();
      history[stamp] = timesheet;
  
      await fs.writeFile(
        "./timesheetHistory.json",
        JSON.stringify(history, null, 2)
      );
  
      timesheet = {};
      await persist();
  
      return interaction.editReply("✅ Timesheet reset & archived.");
    }
  
    // ===== VIEW =====
    // ===== VIEW (EMBED) =====
    const target =
      interaction.options.getMember("user") || interaction.member;
    
    const targetName =
      target?.displayName ||
      target?.user?.globalName ||
      target?.user?.username ||
      timesheet[target.id]?.name ||
      "Unknown User";
    
    const startStr = interaction.options.getString("start");
    const endStr   = interaction.options.getString("end");
    
    const start = parseDate(startStr);
    const end   = parseDate(endStr, true);
    
    if (!timesheet[target.id] || !timesheet[target.id].logs?.length) {
      return interaction.editReply("📭 No records found.");
    }

    let total = 0;
    let lines = [];
    let count = 0;
    
    const logs = timesheet[target.id].logs;
    
    for (const l of logs) {

      const s = new Date(l.start);
      if ((start && s < start) || (end && s > end)) continue;
    
      const hours =
        (new Date(l.end) - new Date(l.start)) / 3600000;
    
      total += hours;
      count++;
    
      lines.push(
        `**${count}.** ${formatSession(l.start, l.end)} — **${Math.round(hours * 100) / 100}h**`
      );
    }
    
    if (!count)
      return interaction.editReply("📭 No sessions in range.");
    
    const rangeLabel =
      startStr || endStr
        ? `${startStr || "Beginning"} → ${endStr || "Now"}`
        : "All time";
    
    const embed = {
      title: "🧾 Timesheet",
      color: 0x3498db,
      fields: [
        { name: "👤 User", value: targetName, inline: true },
        { name: "📅 Range", value: rangeLabel, inline: true },
        { name: "🧮 Sessions", value: String(count), inline: true },
        {
          name: "⏱ Total Hours",
          value: `${Math.round(total * 100) / 100}h`,
          inline: true,
        },
        {
          name: "📋 Logs",
          value: lines.join("\n"),
          inline: false,
        },
      ],
      footer: { text: "Time Tracker" },
      timestamp: new Date().toISOString(),
    };
    
    return interaction.editReply({ embeds: [embed] });
  }
});

// =======================
// STARTUP
// =======================
(async () => {
  startKeepAlive();
  await loadFromGitHub();
  await client.login(process.env.DISCORD_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

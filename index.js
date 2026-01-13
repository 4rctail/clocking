import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// CONFIG
// =======================
const PH_TZ = "Asia/Manila";
const DATA_FILE = "./timesheet.json";
const MANAGERS = ["4rc", "Rich"];
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

function getGuild(interaction) {
  return interaction.guild ?? client.guilds.cache.first();
}

async function dmManagers(guild, embed) {
  if (!guild) return;

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    console.warn("Failed to fetch members:", err);
    return;
  }

  const foundManagers = members
    .filter(m => MANAGERS.includes(m.user.username))
    .map(m => m.user.tag);

  console.log("Found managers:", foundManagers);

  for (const member of members.values()) {
    if (!MANAGERS.includes(member.user.username)) continue;

    try {
      await member.send({ embeds: [embed] });
    } catch (err) {
      console.warn(`Cannot DM ${member.user.tag}: ${err.message}`);
    }
  }
}


function resolveDisplayName(interaction, member) {
  if (member?.displayName) return member.displayName;
  if (member?.nickname) return member.nickname;
  if (member?.user?.globalName) return member.user.globalName;
  if (member?.user?.username) return member.user.username;
  return interaction.user.globalName
      || interaction.user.username
      || "Unknown User";
}
function getUsername(interaction) {
  return (
    interaction.member?.displayName ||
    interaction.user?.globalName ||
    interaction.user?.username ||
    "unknown"
  );
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

async function checkVoiceAndAutoClockOut(username, userId, guild) {
  const voiceState = guild.voiceStates.cache.get(userId);

  if (voiceState?.channel) {
    console.log(`✅ ${username} still in voice: ${voiceState.channel.name}`);
    return;
  }

  await forceClockOut(username);

  console.log(`⛔ Auto clocked out: ${username} (not in voice)`);

  // DM managers
  const embed = {
    title: "⛔ Auto Clocked Out",
    color: 0xe67e22,
    fields: [
      { name: "👤 User", value: username },
      { name: "📍 Reason", value: "Not in a public voice channel after 5 minutes" },
      { name: "⚠️ Reminder", value: "**REMINDER: UPDATE AD SPENT**" },
    ],
    timestamp: new Date().toISOString(),
  };

  await dmManagers(guild, embed);
}



async function loadFromDisk() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    timesheet = JSON.parse(raw);
  } catch {
    timesheet = {};
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
// Voice enforcement timers (per username)
const voiceCheckTimers = new Map();

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

async function forceClockOut(username) {
  const userData = timesheet[username];
  if (!userData?.active) return;

  const start = userData.active;
  const end = nowISO();
  const hours = diffHours(start, end);

  userData.logs.push({
    start,
    end,
    hours: Math.round(hours * 100) / 100,
    forced: true,
  });

  delete userData.active;
  userData.name = username;

  await persist();

  console.log(`⛔ Auto clock-out: ${username} (not in voice)`);
}


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

function hasManagerRole(username) {
  if (!username) return false;
  return MANAGERS.includes(username);
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
    if (interaction.commandName === "totalhr") {
      await loadFromDisk();
    
      let lines = [];
    
      for (const [username, user] of Object.entries(timesheet)) {
        if (!user?.logs?.length) continue;
    
        let total = 0;
        for (const l of user.logs) {
          if (typeof l.hours === "number") total += l.hours;
        }
    
        total = Math.round(total * 100) / 100;
        if (total <= 0) continue;
    
        lines.push(`**${username}** — ${total.toFixed(2)}h`);
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
  // -------- CLOCK IN (EMBED) --------
  if (interaction.commandName === "clockin") {
    const username = getUsername(interaction);
  
    if (!timesheet[username]) timesheet[username] = { logs: [] };
    if (timesheet[username].active)
      return interaction.editReply("❌ Already clocked in.");
  
    const start = nowISO();
    timesheet[username].active = start;
    await persist();
  
    const userId = interaction.user.id;
    const guild = interaction.guild;
  
    // CLEAR old timers
    if (voiceCheckTimers.has(userId)) {
      clearTimeout(voiceCheckTimers.get(userId));
      voiceCheckTimers.delete(userId);
    }
  
    // ---- 2.5 MIN REMINDER ----
    const reminderTimer = setTimeout(async () => {
      await loadFromDisk();
      if (!timesheet[username]?.active) return;
  
      const voiceState = guild.voiceStates.cache.get(userId);
      if (!voiceState?.channel) {
        try {
          await interaction.user.send(
            "⏳ Reminder: Join a public voice channel within 2.5 minutes or you will be auto clocked out."
          );
        } catch {}
      }
  
      // ---- FINAL AUTO CLOCK OUT (5 MIN TOTAL) ----
      const autoOutTimer = setTimeout(() => {
        checkVoiceAndAutoClockOut(username, userId, guild);
      }, 150000);
  
      voiceCheckTimers.set(userId, autoOutTimer);
    }, 150000);
  
    voiceCheckTimers.set(userId, reminderTimer);
  
    return interaction.editReply({
      embeds: [{
        title: "🟢 Clocked In",
        color: 0x2ecc71,
        fields: [
          { name: "👤 User", value: username },
          { name: "⏱ Start Time", value: formatDate(start) },
        ],
        timestamp: new Date(start).toISOString(),
      }],
    });
  }



  // -------- CLOCK OUT --------
  // -------- CLOCK OUT (EMBED + DETAILS) --------
  if (interaction.commandName === "clockout") {
    await loadFromDisk();
  
    const username =
      interaction.member?.displayName ||
      interaction.user?.globalName ||
      interaction.user?.username;
  
    const userData = timesheet[username];
  
    if (!userData?.active) {
      return interaction.editReply("❌ Not clocked in.");
    }
  
    const start = userData.active;
    const end = new Date().toISOString();
    const hours = (new Date(end) - new Date(start)) / 3600000;
    const rounded = Math.round(hours * 100) / 100;
  
    // Push to logs
    userData.logs.push({
      start,
      end,
      hours,
    });
  
    // Remove active session
    delete userData.active;
  
    // Save username
    userData.name = username;
  
    await persist();
    // cancel pending voice check
    const userId = interaction.user.id;
    
    if (voiceCheckTimers.has(userId)) {
      clearTimeout(voiceCheckTimers.get(userId));
      voiceCheckTimers.delete(userId);
    }

    }

    const voiceChannel =
      interaction.member?.voice?.channel?.name || "Not in voice";
  
    // Build the embed
    const embed = {
      title: "🔴 Clocked Out",
      color: 0xe74c3c,
      fields: [
        { name: "👤 User", value: username, inline: true },
        { name: "📍 Voice Channel", value: voiceChannel, inline: true },
        { name: "▶️ Started", value: formatDate(start), inline: false },
        { name: "⏹ Ended", value: formatDate(end), inline: false },
        { name: "⏱ Session Duration", value: `${rounded}h`, inline: true },
        {
          name: "⚠️ Reminder",
          value: "**REMINDER: UPDATE AD SPENT**",
          inline: false,
        },
      ],
      footer: { text: "Time Tracker" },
      timestamp: new Date().toISOString(),
    };
  
    return interaction.editReply({ embeds: [embed] });
  }

  

  // -------- STATUS (EMBED + LIVE UPDATE) --------
  // -------- STATUS (USERNAME ONLY, SAFE) --------
  if (interaction.commandName === "status") {
    await loadFromDisk();
    if (timesheet.undefined) {
      delete timesheet.undefined;
      await persist();
    }

  
    const username = getUsername(interaction);
    if (!username) {
      return interaction.editReply("❌ Cannot resolve username.");
    }
  
    const userData = timesheet[username];
  
    // ===== CLOCKED IN =====
    if (userData?.active) {
      const start = userData.active;
  
      const embed = {
        title: "🟢 Status: Clocked In",
        color: 0x2ecc71,
        fields: [
          { name: "👤 User", value: username, inline: true },
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
      };
  
      // clear old timer
      const existing = liveStatusTimers.get(username);
      if (existing) {
        clearInterval(existing);
        liveStatusTimers.delete(username);
      }
  
      await interaction.editReply({ embeds: [embed] });
  
      // live update
      const timer = setInterval(async () => {
        if (!timesheet[username]?.active) {
          clearInterval(timer);
          liveStatusTimers.delete(username);
          return;
        }
  
        try {
          await interaction.editReply({
            embeds: [{
              ...embed,
              fields: embed.fields.map(f =>
                f.name === "⏱ Elapsed"
                  ? { ...f, value: formatElapsedLive(start) }
                  : f
              ),
              timestamp: new Date().toISOString(),
            }],
          });
        } catch {
          clearInterval(timer);
          liveStatusTimers.delete(username);
        }
      }, 5000);
  
      liveStatusTimers.set(username, timer);
      return;
    }
  
    // ===== CLOCKED OUT =====
    const total =
      userData?.logs?.reduce((t, l) => t + l.hours, 0) || 0;
  
    return interaction.editReply({
      embeds: [{
        title: "⚪ Status: Clocked Out",
        color: 0x95a5a6,
        fields: [
          { name: "👤 User", value: username, inline: true },
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
  

  if (interaction.commandName === "leave") {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ No guild context", ephemeral: true });
    }
  
    await interaction.reply("👋 Leaving server...");
    await interaction.guild.leave();
  }

  // -------- TIMESHEET --------
  if (interaction.commandName === "timesheet") {
    const sub = interaction.options.getSubcommand(false);
  
    // ===== RESET (MANAGER ONLY) =====
    // ===== RESET (MANAGER ONLY, USERNAME-ONLY) =====
    if (sub === "reset") {
      let member = interaction.member;
      if (!member) {
        try {
          member = await interaction.guild.members.fetch(interaction.user.id);
        } catch {
          member = null;
        }
      }
      
      const username =
        interaction.member?.displayName ||
        interaction.user?.globalName ||
        interaction.user?.username;
      
      if (!hasManagerRole(username)) {
        return interaction.editReply("❌ Managers only.");
      }

    
      await loadFromDisk();
      if (timesheet?.undefined) {
        delete timesheet.undefined;
        await persist();
      }
      process.on("unhandledRejection", err => {
        console.error("Unhandled rejection:", err);
      });
      // sanitize corrupted keys
      if (timesheet.undefined) {
        delete timesheet.undefined;
      }
    
      let history = {};
      try {
        history = JSON.parse(
          await fs.readFile("./timesheetHistory.json", "utf8")
        );
      } catch {}
    
      const stamp = new Date().toISOString();
    
      // DEEP COPY (important)
      history[stamp] = JSON.parse(JSON.stringify(timesheet));
    
      await fs.writeFile(
        "./timesheetHistory.json",
        JSON.stringify(history, null, 2)
      );
    
      // clear live timers
      for (const timer of liveStatusTimers.values()) {
        clearInterval(timer);
      }
      liveStatusTimers.clear();
    
      // reset timesheet
      timesheet = {};
      await persist();
    
      return interaction.editReply("✅ Timesheet reset & archived.");
    }

  
    // ===== VIEW =====
    // ===== TIMESHEET VIEW (USERNAME ONLY) =====
    await loadFromDisk();
    
    const username =
      interaction.member?.displayName ||
      interaction.user?.globalName ||
      interaction.user?.username;
    
    if (timesheet.undefined) {
      delete timesheet.undefined;
      await persist();
    }

    if (!username) {
      return interaction.editReply("❌ Cannot resolve username.");
    }
    
    const userData = timesheet[username];
    
    if (!userData || !Array.isArray(userData.logs) || userData.logs.length === 0) {
      return interaction.editReply("📭 No records found.");
    }
    
    const startStr = interaction.options.getString("start");
    const endStr   = interaction.options.getString("end");
    
    const start = parseDate(startStr);
    const end   = parseDate(endStr, true);
    
    let total = 0;
    let lines = [];
    let count = 0;
    
    for (const l of userData.logs) {
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
    
    if (!count) {
      return interaction.editReply("📭 No sessions in range.");
    }
    
    const rangeLabel =
      startStr || endStr
        ? `${startStr || "Beginning"} → ${endStr || "Now"}`
        : "All time";
    
    return interaction.editReply({
      embeds: [{
        title: "🧾 Timesheet",
        color: 0x3498db,
        fields: [
          { name: "👤 User", value: username, inline: true },
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
      }],
    });

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

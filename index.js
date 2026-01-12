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
  intents: [GatewayIntentBits.Guilds],
});

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
// TIME HELPERS
// =======================
function nowISO() {
  return new Date().toISOString();
}

function diffHours(start, end) {
  return ((new Date(end) - new Date(start)) / 3600000).toFixed(2);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function elapsed(startISO) {
  const ms = Date.now() - new Date(startISO).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// =======================
// GITHUB SYNC
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
    const json = await get.json();
    sha = json.sha;
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
// SLASH COMMAND HANDLER
// =======================
client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ ephemeral: true });

    const data = await loadData();
    const targetUser =
      interaction.options.getUser("user") || interaction.user;

    const userId = targetUser.id;
    data[userId] ??= { logs: [] };

    // /clockin
    if (interaction.commandName === "clockin") {
      if (data[userId].active) {
        await interaction.editReply("❌ You are already clocked in.");
        return;
      }

      data[userId].active = nowISO();
      await saveData(data);

      await interaction.editReply("🟢 **Clocked IN successfully**");
      return;
    }

    // /clockout
    if (interaction.commandName === "clockout") {
      if (!data[userId].active) {
        await interaction.editReply("❌ You are not clocked in.");
        return;
      }

      const start = data[userId].active;
      const end = nowISO();

      data[userId].logs.push({
        start,
        end,
        hours: diffHours(start, end),
      });

      delete data[userId].active;
      await saveData(data);

      await interaction.editReply(
        `🔴 **Clocked OUT** — ${diffHours(start, end)}h`
      );
      return;
    }

    // /status
    if (interaction.commandName === "status") {
      if (data[userId].active) {
        await interaction.editReply(
          `🟢 **Status: CLOCKED IN**\n` +
          `👤 ${targetUser.tag}\n` +
          `⏱ Started: ${formatDate(data[userId].active)}\n` +
          `⌛ Elapsed: ${elapsed(data[userId].active)}`
        );
        return;
      }

      const logs = data[userId].logs;
      const last = logs.at(-1);
      const total = logs.reduce(
        (t, l) => t + parseFloat(l.hours),
        0
      );

      await interaction.editReply(
        `⚪ **Status: CLOCKED OUT**\n` +
        `👤 ${targetUser.tag}\n` +
        (last ? `📄 Last session: ${last.hours}h\n` : "") +
        `⏱ Total hours: ${total.toFixed(2)}h`
      );
      return;
    }

    // /timesheet
    if (interaction.commandName === "timesheet") {
      const logs = data[userId].logs;

      if (!logs.length) {
        await interaction.editReply(
          `📭 No records found for **${targetUser.tag}**`
        );
        return;
      }

      let total = 0;
      let msg = `🧾 **Timesheet — ${targetUser.tag}**\n`;

      logs.forEach((l, i) => {
        total += parseFloat(l.hours);
        msg += `${i + 1}. ${formatDate(l.start)} → ${l.hours}h\n`;
      });

      msg += `\n⏱ **Total:** ${total.toFixed(2)}h`;
      await interaction.editReply(msg);
      return;
    }

    await interaction.editReply("❓ Unknown command.");

  } catch (err) {
    console.error("❌ Interaction error:", err);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ An error occurred.");
    } else {
      await interaction.reply({
        content: "❌ An error occurred.",
        ephemeral: true,
      });
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

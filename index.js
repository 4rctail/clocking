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
const GIT_BRANCH = process.env.GIT_BRANCH || "Bot";

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
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "clockin") {
      await interaction.reply("🕒 You are now clocked in!");
    }

    else if (interaction.commandName === "clockout") {
      await interaction.reply("🕔 You are now clocked out!");
    }

    else if (interaction.commandName === "status") {
      await interaction.reply("📊 Status: Not implemented yet.");
    }

    else if (interaction.commandName === "timesheet") {
      await interaction.reply("📄 Timesheet feature coming soon.");
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: "❌ Error handling command.", ephemeral: true });
    }
  }
});


  const userId = i.user.id;
  const data = await loadData();

  // /clockin
  if (i.commandName === "clockin") {
    if (data[userId]?.active)
      return i.reply({ content: "❌ You are already clocked in.", ephemeral: true });

    data[userId] = data[userId] || { logs: [] };
    data[userId].active = nowISO();

    await saveData(data);
    return i.reply("🟢 **Clocked IN successfully**");
  }

  // /clockout
  if (i.commandName === "clockout") {
    if (!data[userId]?.active)
      return i.reply({ content: "❌ You are not clocked in.", ephemeral: true });

    const start = data[userId].active;
    const end = nowISO();

    data[userId].logs.push({
      start,
      end,
      hours: diffHours(start, end),
    });

    delete data[userId].active;
    await saveData(data);

    return i.reply(`🔴 **Clocked OUT** — ${diffHours(start, end)}h`);
  }

  // /status
  if (i.commandName === "status") {
    if (data[userId]?.active)
      return i.reply(`🟡 Clocked IN since:\n\`${data[userId].active}\``);

    return i.reply("⚪ You are NOT clocked in.");
  }

  // /timesheet
  if (i.commandName === "timesheet") {
    const logs = data[userId]?.logs || [];
    if (!logs.length) return i.reply("📭 No records found.");

    let total = 0;
    let msg = "🧾 **Your Timesheet**\n";

    logs.forEach((l, idx) => {
      total += parseFloat(l.hours);
      msg += `${idx + 1}. ${l.hours}h\n`;
    });

    msg += `\n⏱ **Total Hours:** ${total.toFixed(2)}h`;
    return i.reply(msg);
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

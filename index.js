import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { startKeepAlive } from "./keepAlive.js";

// ======================
// ENV
// ======================
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GIT_TOKEN = process.env.GIT_TOKEN;
const GIT_USER = process.env.GIT_USER;
const GIT_REPO = process.env.GIT_REPO;
const GIT_BRANCH = process.env.GIT_BRANCH || "main";

const DATA_FILE = "./timesheet.json";

// ======================
// DISCORD CLIENT
// ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ======================
// FILE HELPERS
// ======================
async function loadData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  await syncToGitHub();
}

// ======================
// GITHUB SYNC
// ======================
async function syncToGitHub() {
  if (!GIT_TOKEN) return;

  const api = `https://api.github.com/repos/${GIT_USER}/${GIT_REPO}/contents/timesheet.json`;
  const content = Buffer.from(await fs.readFile(DATA_FILE)).toString("base64");

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
      message: "Update timesheet",
      content,
      sha,
      branch: GIT_BRANCH,
    }),
  });

  console.log("✅ Timesheet synced to GitHub");
}

// ======================
// TIME HELPERS
// ======================
function now() {
  return new Date().toISOString();
}

function diffHours(start, end) {
  return ((new Date(end) - new Date(start)) / 3600000).toFixed(2);
}

// ======================
// COMMAND HANDLER
// ======================
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const userId = msg.author.id;
  const data = await loadData();
  const cmd = msg.content.toLowerCase();

  // CLOCK IN
  if (cmd === "!clock in") {
    if (data[userId]?.active)
      return msg.reply("❌ You are already clocked in.");

    data[userId] = data[userId] || { logs: [] };
    data[userId].active = now();

    await saveData(data);
    return msg.reply("🟢 Clocked IN successfully.");
  }

  // CLOCK OUT
  if (cmd === "!clock out") {
    if (!data[userId]?.active)
      return msg.reply("❌ You are not clocked in.");

    const start = data[userId].active;
    const end = now();

    data[userId].logs.push({ start, end, hours: diffHours(start, end) });
    delete data[userId].active;

    await saveData(data);
    return msg.reply(`🔴 Clocked OUT. Hours worked: **${diffHours(start, end)}h**`);
  }

  // STATUS
  if (cmd === "!status") {
    if (data[userId]?.active)
      return msg.reply(`🟡 Clocked IN since ${data[userId].active}`);
    return msg.reply("⚪ Not clocked in.");
  }

  // TIMESHEET
  if (cmd === "!timesheet") {
    const logs = data[userId]?.logs || [];
    if (!logs.length) return msg.reply("📭 No records found.");

    let total = 0;
    let text = "🧾 **Your Timesheet**\n";
    logs.forEach((l, i) => {
      total += parseFloat(l.hours);
      text += `${i + 1}. ${l.start} → ${l.end} = **${l.hours}h**\n`;
    });

    text += `\n⏱️ **Total: ${total.toFixed(2)}h**`;
    return msg.reply(text);
  }
});

// ======================
// STARTUP
// ======================
(async () => {
  startKeepAlive();
  await client.login(TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

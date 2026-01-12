import { Client, GatewayIntentBits } from "discord.js";
import http from "http";

// ─────────────────────────────────────────────
// Keep-alive server (Render requirement)
// ─────────────────────────────────────────────
http.createServer((_, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(10000, () => {
  console.log("🌐 Keep-alive server on port 10000");
});

// ─────────────────────────────────────────────
// TOKEN DIAGNOSTICS (SAFE)
// ─────────────────────────────────────────────
console.log("🔍 TOKEN TYPE:", typeof process.env.DISCORD_TOKEN);
console.log("🔍 TOKEN LENGTH:", process.env.DISCORD_TOKEN?.length);

// HARD FAIL IF TOKEN IS MISSING
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN IS MISSING AT RUNTIME");
  process.exit(1);
}

// ─────────────────────────────────────────────
// Discord Client
// ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// Ready event (v14+ compatible)
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Error visibility
client.on("error", err => {
  console.error("❌ CLIENT ERROR:", err);
});

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);

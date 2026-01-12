import express from "express";
import fetch from "node-fetch";

const PORT = process.env.PORT || 10000;
const PING_URL = process.env.PING_URL;

export function startKeepAlive() {
  const app = express();

  app.get("/", (_req, res) => {
    res.status(200).send("🟢 Clock Bot Alive");
  });

  app.listen(PORT, () => {
    console.log(`🌐 Keep-alive server on port ${PORT}`);
  });

  if (!PING_URL) {
    console.warn("⚠️ No PING_URL set — self-ping disabled");
    return;
  }

  setInterval(async () => {
    try {
      await fetch(PING_URL);
      console.log("🔄 Self-ping OK");
    } catch (e) {
      console.warn("❌ Self-ping failed");
    }
  }, 300000);
}

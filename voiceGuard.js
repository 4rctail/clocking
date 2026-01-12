import fs from "fs/promises";

const FILE = "./timesheet.json";

const WARN_DELAY = 150000;  // 2.5 minutes
const KICK_DELAY = 300000; // 5 minutes

const timers = new Map();

async function read() {
  try { return JSON.parse(await fs.readFile(FILE)); }
  catch { return {}; }
}

async function write(d) {
  await fs.writeFile(FILE, JSON.stringify(d, null, 2));
}

export function attachVoiceGuard(client) {
  client.on("voiceStateUpdate", async (oldState, newState) => {
    const uid = oldState.id;

    // LEFT VOICE
    if (oldState.channelId && !newState.channelId) {
      const data = await read();
      if (!data[uid]?.active) return;

      const warnTimer = setTimeout(async () => {
        try {
          await oldState.member.send(
            "⚠️ You left voice while clocked in. Rejoin within 2.5 minutes or you will be clocked out."
          );
        } catch {}
      }, WARN_DELAY);

      const kickTimer = setTimeout(async () => {
        const d = await read();
        if (!d[uid]?.active) return;

        const end = new Date().toISOString();
        d[uid].logs.push({
          start: d[uid].active,
          end,
          hours: ((new Date(end) - new Date(d[uid].active)) / 36e5).toFixed(2),
        });

        delete d[uid].active;
        await write(d);

        try {
          await oldState.member.send("⛔ You were automatically clocked out for staying out of voice.");
        } catch {}
      }, KICK_DELAY);

      timers.set(uid, { warnTimer, kickTimer });
    }

    // REJOINED VOICE
    if (!oldState.channelId && newState.channelId) {
      const t = timers.get(uid);
      if (t) {
        clearTimeout(t.warnTimer);
        clearTimeout(t.kickTimer);
        timers.delete(uid);
      }
    }
  });
}

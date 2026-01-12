import { Client, GatewayIntentBits, Collection } from "discord.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { startKeepAlive } from "./keepAlive.js";
import { attachVoiceGuard } from "./voiceGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// =======================
// LOAD COMMANDS
// =======================
client.commands = new Collection();
const commandFiles = await fs.readdir(path.join(__dirname, "commands"));

for (const file of commandFiles) {
  const cmd = await import(`./commands/${file}`);
  client.commands.set(cmd.default.name, cmd.default);
}

// =======================
// INTERACTION HANDLER
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await interaction.deferReply();
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    if (!interaction.replied)
      await interaction.editReply("❌ Command error.");
  }
});

// =======================
// START
// =======================
(async () => {
  startKeepAlive();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

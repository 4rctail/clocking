import { Client, GatewayIntentBits, Collection } from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startKeepAlive } from "./keepAlive.js";

// =======================
// PATH FIX (ESM)
// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
// CLIENT
// =======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ],
});

// =======================
// COMMAND HANDLER
// =======================
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  client.commands.set(command.default.name, command.default);
}

// =======================
// INTERACTIONS
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Command Error: ${interaction.commandName}`, err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply("❌ An internal error occurred.");
    }
  }
});

// =======================
// READY
// =======================
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// =======================
// START
// =======================
startKeepAlive();
client.login(process.env.DISCORD_BOT_TOKEN);

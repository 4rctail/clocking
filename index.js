import { Client, GatewayIntentBits, Collection } from "discord.js";
import fs from "fs/promises";
import { startKeepAlive } from "./keepAlive.js";
import path from "path";
import { fileURLToPath } from "url";

// =======================
// PATH FIX
// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
// CLIENT
// =======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();

// =======================
// LOAD COMMANDS
// =======================
const commandsPath = path.join(__dirname, "commands");
const files = await fs.readdir(commandsPath);

for (const file of files) {
  if (!file.endsWith(".js")) continue;
  const cmd = await import(`./commands/${file}`);
  client.commands.set(cmd.default.name, cmd.default);
}

// =======================
// INTERACTION HANDLER
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
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


  try {
    await command.execute(interaction);
  } catch (err) {
    console.error("❌ Command Error:", interaction.commandName);
    console.error(err);

    try {
      await interaction.editReply("❌ An internal error occurred.");
    } catch {
      // interaction is gone
    }
  }
});

// =======================
// START BOT
// =======================
(async () => {
  startKeepAlive();
  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

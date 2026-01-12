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

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    // ❗ DO NOT defer here
    await command.execute(interaction);

  } catch (err) {
    console.error("❌ Command Error");
    console.error("Command:", interaction.commandName);
    console.error(err);

    try {
      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ An internal error occurred.",
          ephemeral: true
        });
      }
    } catch {
      // Interaction already expired — ignore
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

import { Client, GatewayIntentBits, Collection } from "discord.js";
import fs from "fs/promises";
import { startKeepAlive } from "./keepAlive.js";
import { attachVoiceGuard } from "./voiceGuard.js";
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
import { GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates
  ]
});



// =======================
// COMMAND LOADER
// =======================
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const files = await fs.readdir(commandsPath);

for (const file of files) {
  if (!file.endsWith(".js")) continue;
  const cmd = await import(`./commands/${file}`);
  client.commands.set(cmd.default.name, cmd.default);
}

// =======================
// INTERACTION HANDLER (FIXED)
// =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    // 🔒 ALWAYS defer FIRST, ONCE
    await interaction.deferReply({ ephemeral: false });

    // 🔒 Command files NEVER defer
    await command.execute(interaction);

  } catch (err) {
    console.error(err);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ An internal error occurred.");
    }
  }
});

// =======================
// START
// =======================
(async () => {
  startKeepAlive();
  attachVoiceGuard(client);

  await client.login(process.env.DISCORD_BOT_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}`);
})();

import { REST, Routes, SlashCommandBuilder } from "discord.js";

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;

const commands = [
  new SlashCommandBuilder()
    .setName("clockin")
    .setDescription("Clock in to work"),

  new SlashCommandBuilder()
    .setName("clockout")
    .setDescription("Clock out from work"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check clock status"),

  new SlashCommandBuilder()
    .setName("timesheet")
    .setDescription("View your timesheet"),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("⏳ Registering guild slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered INSTANTLY");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
})();

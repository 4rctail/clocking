import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("clockin")
    .setDescription("Clock in to work"),

  new SlashCommandBuilder()
    .setName("clockout")
    .setDescription("Clock out from work"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check your clock status"),

  new SlashCommandBuilder()
    .setName("timesheet")
    .setDescription("View your timesheet"),
].map(c => c.toJSON());

const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_BOT_TOKEN);

await rest.put(
  Routes.applicationCommands(process.env.CLIENT_ID),
  { body: commands }
);

console.log("✅ Slash commands registered");

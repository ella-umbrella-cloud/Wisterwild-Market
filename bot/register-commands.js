import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const { DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!DISCORD_APP_ID) throw new Error('Missing DISCORD_APP_ID');
if (!GUILD_ID) throw new Error('Missing GUILD_ID');

const shop = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Shop plot commands')
  .addSubcommand(sc =>
    sc.setName('register')
      .setDescription('Register your shop to an unclaimed address (run inside your shop thread)')
      .addStringOption(o => o.setName('address').setDescription('e.g. 1000 Teacup Terrace').setRequired(true))
      .addStringOption(o => o.setName('shop_name').setDescription('Your shop name').setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName('unclaim')
      .setDescription('Unclaim an address (owner or mod)')
      .addStringOption(o => o.setName('address').setDescription('e.g. 1000 Teacup Terrace').setRequired(true))
  );

const commands = [shop.toJSON()];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(DISCORD_APP_ID, GUILD_ID),
  { body: commands }
);

console.log('✅ Registered slash commands for guild:', GUILD_ID);

import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, PermissionsBitField } from 'discord.js';
import { Octokit } from '@octokit/rest';

const {
  DISCORD_TOKEN,
  DISCORD_APP_ID,
  GUILD_ID,
  SHOP_FORUM_CHANNEL_ID,
  MOD_ROLE_IDS,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  SHOPS_JSON_PATH = 'data/shops.json',
  PLOTS_JSON_PATH = 'data/plots.json',
} = process.env;

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!SHOP_FORUM_CHANNEL_ID) throw new Error('Missing SHOP_FORUM_CHANNEL_ID');
if (!GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN');
if (!GITHUB_OWNER || !GITHUB_REPO) throw new Error('Missing GITHUB_OWNER/GITHUB_REPO');

const modRoleIds = new Set((MOD_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

const octokit = new Octokit({ auth: GITHUB_TOKEN });

function normalizeAddress(addr) {
  return (addr || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function getRepoJson(path) {
  const res = await octokit.repos.getContent({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path,
  });
  if (!('content' in res.data)) throw new Error(`Expected file content at ${path}`);
  const buff = Buffer.from(res.data.content, res.data.encoding || 'base64');
  const json = JSON.parse(buff.toString('utf8') || 'null');
  return { json, sha: res.data.sha };
}

async function putRepoJson(path, json, sha, message) {
  const content = Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf8').toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path,
    message,
    content,
    sha,
  });
}

async function loadAllowedAddresses() {
  const { json } = await getRepoJson(PLOTS_JSON_PATH);
  const set = new Set();
  for (const p of (json.plots || [])) set.add(normalizeAddress(p.address));
  return set;
}

function isInThread(interaction) {
  // In discord.js v14, threads have isThread() on channel
  const ch = interaction.channel;
  return ch && typeof ch.isThread === 'function' && ch.isThread();
}

function buildThreadUrl(interaction) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId; // thread id (channelId is thread's id)
  const parentId = interaction.channel?.parentId;
  // Thread URL uses /channels/<guild>/<parent>/<thread>
  if (!guildId || !parentId || !channelId) return null;
  return `https://discord.com/channels/${guildId}/${parentId}/${channelId}`;
}

function callerIsMod(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.ManageThreads)) return true;
  if (modRoleIds.size === 0) return false;
  return member.roles.cache.some(r => modRoleIds.has(r.id));
}

async function ensureInShopForum(interaction) {
  const thread = interaction.channel;
  if (!thread?.parentId) return false;
  return thread.parentId === SHOP_FORUM_CHANNEL_ID;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'shop' && interaction.options.getSubcommand() === 'register') {
      await interaction.deferReply({ ephemeral: true });

      if (!isInThread(interaction)) {
        return interaction.editReply('Run this command **inside your shop thread** so I can link it automatically.');
      }
      if (!(await ensureInShopForum(interaction))) {
        return interaction.editReply('This command must be used in the **Shop Forum** threads.');
      }

      const addressRaw = interaction.options.getString('address', true);
      const shopName = interaction.options.getString('shop_name', true);
      const addrKey = normalizeAddress(addressRaw);

      const allowed = await loadAllowedAddresses();
      if (!allowed.has(addrKey)) {
        return interaction.editReply('That address is not in the official plot list. Double-check spelling.');
      }

      const { json: shops, sha } = await getRepoJson(SHOPS_JSON_PATH);
      const list = Array.isArray(shops) ? shops : [];
      const already = list.find(s => normalizeAddress(s.address) === addrKey);
      if (already) {
        return interaction.editReply(`That address is already claimed by **${already.owner || 'Unknown'}**.`);
      }

      const threadUrl = buildThreadUrl(interaction);
      if (!threadUrl) return interaction.editReply('Could not build a thread link. (Missing IDs)');

      const ownerName = interaction.member?.displayName || interaction.user.username;
      const claimedAt = new Date().toISOString();

      list.push({
        address: addressRaw.trim(),
        owner: ownerName,
        shopName: shopName.trim(),
        threadUrl,
        claimedAt
      });

      // Keep stable ordering by address
      list.sort((a, b) => normalizeAddress(a.address).localeCompare(normalizeAddress(b.address)));

      await putRepoJson(
        SHOPS_JSON_PATH,
        list,
        sha,
        `Register shop: ${addressRaw.trim()}`
      );

      return interaction.editReply(`✅ Registered **${addressRaw.trim()}** for **${ownerName}**.\nThread linked: ${threadUrl}`);
    }

    if (interaction.commandName === 'shop' && interaction.options.getSubcommand() === 'unclaim') {
      await interaction.deferReply({ ephemeral: true });

      const addressRaw = interaction.options.getString('address', true);
      const addrKey = normalizeAddress(addressRaw);

      const { json: shops, sha } = await getRepoJson(SHOPS_JSON_PATH);
      const list = Array.isArray(shops) ? shops : [];

      const idx = list.findIndex(s => normalizeAddress(s.address) === addrKey);
      if (idx === -1) {
        return interaction.editReply('That address is not currently claimed.');
      }

      const entry = list[idx];
      const ownerName = entry.owner || '';

      const member = interaction.member;
      const canMod = callerIsMod(member);

      const callerName = member?.displayName || interaction.user.username;
      const isOwner = callerName === ownerName;

      if (!canMod && !isOwner) {
        return interaction.editReply(`Only the current owner (**${ownerName}**) or a moderator can unclaim this address.`);
      }

      list.splice(idx, 1);

      await putRepoJson(
        SHOPS_JSON_PATH,
        list,
        sha,
        `Unclaim shop: ${addressRaw.trim()}`
      );

      return interaction.editReply(`✅ Unclaimed **${addressRaw.trim()}**.`);
    }

  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = '⚠️ Something went wrong. Check bot logs.';
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
        else await interaction.reply({ content: msg, ephemeral: true });
      } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);

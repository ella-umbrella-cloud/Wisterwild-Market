# Shop Map Bot

Node.js + discord.js bot that writes `data/shops.json` into your GitHub Pages repo.

## Setup
1) `cd bot`
2) `npm install`
3) Copy `.env.example` to `.env` and fill values
4) Register slash commands:
   - `npm run register-commands`
5) Start bot:
   - `npm start`

## Discord requirements
- Create a Forum channel for shop threads (set SHOP_FORUM_CHANNEL_ID)
- Bot needs permission to use slash commands in the server
- If you want mod override: set MOD_ROLE_IDS or rely on Manage Threads/Admin permissions

## GitHub requirements
- Create a fine-grained token with access to the repo and Contents: Read/Write.

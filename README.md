# Minecraft Shop Map (GitHub Pages)

This project hosts an interactive, plugin-free shop map for your Minecraft server:
- Base map is an image (assets/map.png)
- Plots are rectangles keyed by address (data/plots.json)
- Claimed shop data is bot-updated (data/shops.json)
- Hover shows owner
- Click shows owner + address + link to shop thread

## Quick start
1) Put your map image at: `assets/map.png` (replace placeholder)
2) Edit `data/plots.json`:
   - Set correct image width/height in `meta`
   - Add all 70 addresses as plots (x,y,w,h)
3) Use `editor.html` to draw rectangles, then paste the generated JSON entry back into `data/plots.json`.
4) Enable GitHub Pages on your repo (Settings → Pages → Deploy from main branch).
5) Open the site URL.

## Updating ownership
Your Discord bot updates `data/shops.json` by committing to the repo.
The map auto-refreshes shop data every 30 seconds.

## Security
GitHub Pages is public. If you need it private-to-members later, consider Cloudflare Access.

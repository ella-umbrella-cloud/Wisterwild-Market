// Minecraft Shop Map (OpenLayers) - GitHub Pages friendly
// Data sources (static): data/plots.json, data/labels.json, data/stalls.json
// Live data (bot-updated): data/shops.json
//
// Coordinates are PIXELS on the base image (0,0 top-left). Rectangles are x,y,w,h.

const REFRESH_MS = 30_000; // auto-refresh shop ownership
const PLOTS_URL = "data/plots.json";
const SHOPS_URL = "data/shops.json";
const LABELS_URL = "data/labels.json";
const STALLS_URL = "data/stalls.json";

const mapEl = document.getElementById("map");
const popupEl = document.getElementById("popup");
const popupContent = document.getElementById("popup-content");
const toastEl = document.getElementById("toast");
const searchEl = document.getElementById("search");
const refreshBtn = document.getElementById("refreshBtn");
document.getElementById("popup-close").onclick = () => popupEl.classList.add("hidden");

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), 2500);
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function rectToPolygon(x, y, w, h) {
  return [[
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y]
  ]];
}

function normalizeAddress(addr) {
  return (addr || "").trim().replace(/\s+/g, " ").toLowerCase();
}

let map, plotLayer, labelLayer, stallLayer;
let plotSource;
let plotFeaturesByAddress = new Map();
let shopByAddress = new Map();
let plotsMeta = null;

const avatarImageCache = new Map(); // key: owner|bedrock -> HTMLImageElement

function getAvatarUrl(owner, isBedrock) {
  if (isBedrock) return "https://mc-heads.net/avatar/Steve/128";
  return `https://mc-heads.net/avatar/${encodeURIComponent(owner)}/128`;
}

function getAvatarImage(owner, bedrock) {
  const key = `${owner}|${bedrock}`;
  const existing = avatarImageCache.get(key);
  if (existing) return existing;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = getAvatarUrl(owner, bedrock);

  // Re-render map once the image loads so it appears immediately
  img.onload = () => window._mapRef?.render();

  avatarImageCache.set(key, img);
  return img;
}
function getAvatarUrl(owner, isBedrock) {
  if (isBedrock) return "https://mc-heads.net/avatar/Steve/128";
  return `https://mc-heads.net/avatar/${encodeURIComponent(owner)}/128`;
}

const avatarStyleCache = new Map(); // key: owner|bedrock|scale

function stylePlot(feature) {
  const isServer = feature.get("serverBuilding") === true;

  // Server buildings: always show as gold.
  if (isServer) {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ width: 3, color: "rgba(212, 175, 55, 0.95)" }),
      fill: new ol.style.Fill({ color: "rgba(212, 175, 55, 0.28)" })
    });
  }

  const owner = (feature.get("owner") || "").trim();
const bedrock = feature.get("bedrock") === true;

const geom = feature.getGeometry();
const extent = geom.getExtent();
const center = ol.extent.getCenter(extent);
const w = extent[2] - extent[0];
const h = extent[3] - extent[1];

// Claimed → show head
if (owner) {
  const rawScale = Math.min(w, h) / 128;
  const scale = Math.max(0.35, Math.min(rawScale, 0.80));
  const cacheKey = `${owner}|${bedrock}|${scale.toFixed(3)}`;

  if (avatarStyleCache.has(cacheKey)) {
    return avatarStyleCache.get(cacheKey);
  }

  const styles = [
    new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "black", width: 2 }),
      fill: new ol.style.Fill({ color: "rgba(0,0,0,0)" })
    }),
    new ol.style.Style({
      geometry: new ol.geom.Point(center),
      image: new ol.style.Icon({
        src: getAvatarUrl(owner, bedrock),
        scale,
        opacity: 0.95,
        crossOrigin: "anonymous"
      })
    })
  ];

  avatarStyleCache.set(cacheKey, styles);
  return styles;
}

// Unclaimed plot
return new ol.style.Style({
  stroke: new ol.style.Stroke({ color: "black", width: 2 }),
  fill: new ol.style.Fill({ color: "rgba(255,255,255,0.08)" })
});
}

function styleLabel(feature) {
  const text = feature.get("text") || "";
  return new ol.style.Style({
    text: new ol.style.Text({
      text,
      font: "700 14px system-ui",
      backgroundFill: new ol.style.Fill({ color: "rgba(255,255,255,0.75)" }),
      padding: [2, 6, 2, 6],
      offsetY: -10
    })
  });
}

function styleStall(feature) {
  const name = feature.get("name") || "";
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: 6,
      fill: new ol.style.Fill({ color: "rgba(0,0,0,0.65)" }),
      stroke: new ol.style.Stroke({ width: 2, color: "rgba(255,255,255,0.9)" })
    }),
    text: new ol.style.Text({
      text: name,
      font: "600 12px system-ui",
      backgroundFill: new ol.style.Fill({ color: "rgba(255,255,255,0.75)" }),
      padding: [2, 6, 2, 6],
      offsetY: -18
    })
  });
}

function applyShopDataToFeatures() {
  for (const [addrKey, feature] of plotFeaturesByAddress.entries()) {
    const shop = shopByAddress.get(addrKey);
    feature.set("owner", shop?.owner || "");
    feature.set("shopName", shop?.shopName || "");
    feature.set("threadUrl", shop?.threadUrl || "");
    feature.set("claimedAt", shop?.claimedAt || "");
  }
  plotLayer.changed();
}

function updateSearch() {
  const q = (searchEl.value || "").trim().toLowerCase();
  if (!q) {
    for (const f of plotSource.getFeatures()) {
      f.set("_match", false);
      f.set("_dim", false);
    }
    plotLayer.changed();
    return;
  }

  let matches = 0;
  for (const f of plotSource.getFeatures()) {
    const address = (f.get("address") || "").toLowerCase();
    const owner = (f.get("owner") || "").toLowerCase();
    const shopName = (f.get("shopName") || "").toLowerCase();
    const hit = address.includes(q) || owner.includes(q) || shopName.includes(q);
    f.set("_match", hit);
    f.set("_dim", !hit);
    if (hit) matches++;
  }
  plotLayer.changed();
  toast(matches ? `Found ${matches} match(es).` : "No matches.");
}

async function refreshShops() {
  try {
    const shops = await loadJSON(SHOPS_URL);
    shopByAddress = new Map(shops.map(s => [normalizeAddress(s.address), s]));
    applyShopDataToFeatures();
    toast("Shop data refreshed.");
  } catch (e) {
    console.error(e);
    toast("Failed to refresh shop data. Check console.");
  }
}

function openPopupForFeature(feature) {
  const owner = feature.get("owner") || "Unclaimed";
  const address = feature.get("address");
  const shopName = feature.get("shopName");
  const threadUrl = feature.get("threadUrl");

  popupContent.innerHTML = `
    <div style="font-weight:800;font-size:16px;">${shopName ? escapeHtml(shopName) : escapeHtml(owner)}</div>
    <div class="kv">
      <div><b>Owner:</b> ${escapeHtml(owner)}</div>
      <div><b>Address:</b> ${escapeHtml(address)}</div>
      ${threadUrl ? `<div><a class="link" href="${threadUrl}" target="_blank" rel="noopener">Open Shop Thread</a></div>` : `<div style="color:#666;margin-top:8px;">No thread linked yet.</div>`}
    </div>
  `;
  popupEl.classList.remove("hidden");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

(async () => {
  // Load static layers
  const plotsData = await loadJSON(PLOTS_URL);
  plotsMeta = plotsData.meta;

  const labelsData = await loadJSON(LABELS_URL).catch(() => ({ labels: [] }));
  const stallsData = await loadJSON(STALLS_URL).catch(() => ({ stalls: [] }));
  const shopsData = await loadJSON(SHOPS_URL).catch(() => ([]));

  const { width, height, image } = plotsMeta;

  // Projection in pixel space
  const extent = [0, 0, width, height];
  const projection = new ol.proj.Projection({ code: "PIXELS", units: "pixels", extent });

  const imageLayer = new ol.layer.Image({
    source: new ol.source.ImageStatic({
      url: image,
      projection,
      imageExtent: extent
    })
  });

  // Shops index
  shopByAddress = new Map(shopsData.map(s => [normalizeAddress(s.address), s]));

  // Plot features
  const plotFeatures = plotsData.plots.map(p => {
    const addrKey = normalizeAddress(p.address);
    const shop = shopByAddress.get(addrKey);

    const geom = new ol.geom.Polygon(rectToPolygon(p.x, p.y, p.w, p.h));
    const f = new ol.Feature({ geometry: geom });

    f.setProperties({
      address: p.address,
      serverBuilding: !!p.serverBuilding,
      owner: shop?.owner || "",
      shopName: shop?.shopName || "",
      threadUrl: shop?.threadUrl || "",
      claimedAt: shop?.claimedAt || ""
    });

    plotFeaturesByAddress.set(addrKey, f);
    return f;
  });

  plotSource = new ol.source.Vector({ features: plotFeatures });

  plotLayer = new ol.layer.Vector({
    source: plotSource,
    style: stylePlot
  });

  // Label features
  const labelFeatures = (labelsData.labels || []).map(l => {
    const f = new ol.Feature({
      geometry: new ol.geom.Point([l.x, l.y]),
      text: l.text,
      type: l.type || "label"
    });
    return f;
  });
  labelLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: labelFeatures }),
    style: styleLabel
  });

  // Stall features
  const stallFeatures = (stallsData.stalls || []).map(s => new ol.Feature({
    geometry: new ol.geom.Point([s.x, s.y]),
    name: s.name || "",
    type: s.type || "stall"
  }));
  stallLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: stallFeatures }),
    style: styleStall
  });

  map = new ol.Map({
    target: "map",
    layers: [imageLayer, plotLayer, stallLayer, labelLayer],
    view: new ol.View({
      projection,
      center: [width / 2, height / 2],
      zoom: 2,
      minZoom: 1,
      maxZoom: 8
    })
  });

  // Hover: show owner in tooltip
  map.on("pointermove", (evt) => {
    const f = map.forEachFeatureAtPixel(evt.pixel, feat => feat, { layerFilter: (l) => l === plotLayer });
    map.getTargetElement().style.cursor = f ? "pointer" : "";
    if (f) {
      map.getTargetElement().title = f.get("owner") || "Unclaimed";
    } else {
      map.getTargetElement().title = "";
    }
  });

  // Click: show popup
  map.on("singleclick", (evt) => {
    const f = map.forEachFeatureAtPixel(evt.pixel, feat => feat, { layerFilter: (l) => l === plotLayer });
    if (!f) return;
    openPopupForFeature(f);
  });

  // Search + refresh
  searchEl.addEventListener("input", () => updateSearch());
  refreshBtn.addEventListener("click", () => refreshShops());

  // Auto refresh
  setInterval(() => refreshShops(), REFRESH_MS);

  toast("Loaded. Replace assets/map.png with your map image.");
})();

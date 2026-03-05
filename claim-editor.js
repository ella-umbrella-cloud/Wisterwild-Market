const PLOTS_URL  = "data/plots.json";
const SHOPS_URL  = "data/shops.json";

const elAddress  = document.getElementById("address");
const elOwner    = document.getElementById("owner");
const elThread   = document.getElementById("threadUrl");
const elStatus   = document.getElementById("status");

const btnSave    = document.getElementById("saveBtn");
const btnClear   = document.getElementById("clearBtn");
const btnExport  = document.getElementById("exportBtn");
const btnCopy    = document.getElementById("copyBtn");

// Owners from your legend + special values
const OWNER_CHOICES = [
  "Open Lot",
  "PENDING",
  "Trade Stall",
  "XP Repair House",
  "Ore Trade Hall",
  "Loot House",
  "Market Spawn",

  "Jaden1999",
  ".Spider_Mir_Z",
  ".Zalariah",
  ".LilGothicImp",
  "Turanga3000",
  ".McD98Meg",
  "Crimson1311",
  ".RedstoneCity13",
  ".Milady95",
  ".MissAlpha6531",
  "TsukiDeftones",
  "Non_Profit Shop",

  "_Mizaki_",
  ".WACK_Stamps7",
  "dopeydistroga",
  ".Aster6093",
  ".ChemicalRhino59",
  "NeoFangx",
  "Thundersgay",
  "xXPanTheManXx",
  "Anchentguy132",
  "Struwbunny",

  ".localpsycho696",
  ".BongoKat4366",
  ".MimiDoll04",
  ".CMGreen648",
  "EliaraElander",
  ".PanchoDoesStuff",
  "Obsidian_raven3",
  "CuriousGabs",
  ".Buzzboogaloo",
  "KZToonz",
  "Struwbunny",
  "LilAbsy",
  ".PurpleCapy",
  "DarthRabbit526",
  "UndeadUni",
  "ZanaTheGM",
  "SuperGirl966",
  ".Syphiex",
  "savnuh5182",
  "Virtchh",
  ".PocketPirate866",
  ".Swaelit4L",
  "SkullCameo",
  ".Loretta1998"
];

function setStatus(msg) {
  elStatus.textContent = msg || "";
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
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

// local edits stored in browser so you don’t lose work mid-session
const LS_KEY = "shop-claims-v1";

function readLocalClaims() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
}
function writeLocalClaims(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

// map state
let map, vectorSource;
let selectedFeature = null;
let plots = [];
let claimsByAddress = {}; // { [address]: { owner, threadUrl } }

/* ===============================
   Avatar Image System
================================ */

const avatarImageCache = new Map();

function getAvatarUrl(owner, isBedrock) {
  if (isBedrock) return "https://mc-heads.net/avatar/Steve/128";
  return `https://mc-heads.net/avatar/${encodeURIComponent(owner)}/128`;
}

function getAvatarImage(owner, bedrock) {
  const key = `${owner}|${bedrock}`;
  if (avatarImageCache.has(key)) return avatarImageCache.get(key);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = getAvatarUrl(owner, bedrock);

  img.onload = () => map?.render(); // re-render when loaded

  avatarImageCache.set(key, img);
  return img;
}
/* ADD THIS RIGHT HERE */

function isBedrockId(id) {
  return typeof id === "string" && id.startsWith(".");
}

function displayNameFromId(id) {
  return isBedrockId(id) ? id.slice(1) : id;
}

function getClaim(address) {
  return claimsByAddress[address] || null;
}
function setClaim(address, claimOrNull) {
  if (!address) return;
  if (!claimOrNull) delete claimsByAddress[address];
  else claimsByAddress[address] = claimOrNull;
  writeLocalClaims(claimsByAddress);
}

function isClaimedOwner(owner) {
  if (!owner) return false;
  const o = owner.trim();
  return o !== "Open Lot" && o !== "PENDING";
}

function featureStyle(feature) {
  const addr = feature.get("address");
  const c = getClaim(addr);
  const owner = c?.owner || "Open Lot";

  // simple styles: claimed = green outline, open = black outline, pending = orange outline
  let strokeColor = "rgba(0,0,0,0.9)";
  let fillColor   = "rgba(255,255,255,0.08)";

  if (owner === "PENDING") {
    strokeColor = "rgba(255,165,0,0.95)";
    fillColor   = "rgba(255,165,0,0.10)";
  } else if (isClaimedOwner(owner)) {
    strokeColor = "rgba(80,200,120,0.95)";
    fillColor   = "rgba(80,200,120,0.10)";
  }

  // highlight selected
  if (selectedFeature && feature === selectedFeature) {
    strokeColor = "rgba(255,255,255,1)";
    fillColor   = "rgba(255,255,255,0.12)";
  }

  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: strokeColor, width: 3 }),
    fill: new ol.style.Fill({ color: fillColor })
  });
}

function refreshStyles() {
  vectorSource.getFeatures().forEach(f => f.setStyle(featureStyle(f)));
}

function selectFeature(feature) {
  selectedFeature = feature;
  refreshStyles();

  if (!feature) {
    elAddress.value = "(click a plot)";
    elOwner.value = "Open Lot";
    elThread.value = "";
    return;
  }

  const address = feature.get("address");
  elAddress.value = address;

  const c = getClaim(address);
  elOwner.value = c?.owner || "Open Lot";
  elThread.value = c?.threadUrl || "";
}

function exportShopsArray() {
  // Only export claimed plots (Open Lot/PENDING ignored)
  const out = [];
  for (const [address, c] of Object.entries(claimsByAddress)) {
    if (!c?.owner) continue;
    if (!isClaimedOwner(c.owner)) continue;

    out.push({
      address,
      owner: c.owner,
      threadUrl: (c.threadUrl || "").trim()
    });
  }

  // stable ordering: by address number then street-ish
  out.sort((a,b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
  return out;
}

function downloadJSON(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

(async () => {
  setStatus("Loading plots + existing shops…");

  // Populate owner dropdown
  for (const name of OWNER_CHOICES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    elOwner.appendChild(opt);
  }

  // Load plots
  const plotsData = await loadJSON(PLOTS_URL);
  plots = plotsData.plots;
  const { width, height, image } = plotsData.meta;

  // Load shops.json (existing claimed ones)
  let shops = [];
  try {
    const shopsData = await loadJSON(SHOPS_URL);
    shops = Array.isArray(shopsData) ? shopsData : [];
  } catch {
    shops = [];
  }

  // Load local edits (overrides shops.json for the session)
  claimsByAddress = readLocalClaims();

  // If local storage is empty, seed it from shops.json
  if (Object.keys(claimsByAddress).length === 0 && shops.length > 0) {
    for (const s of shops) {
      if (!s?.address) continue;
      claimsByAddress[s.address] = { owner: s.owner || "Open Lot", threadUrl: s.threadUrl || "" };
    }
    writeLocalClaims(claimsByAddress);
  }

  // OpenLayers image + plot layer
  const extent = [0, 0, width, height];
  const projection = new ol.proj.Projection({ code: "PIXELS", units: "pixels", extent });

  const imageLayer = new ol.layer.Image({
    source: new ol.source.ImageStatic({
      url: image,
      projection,
      imageExtent: extent
    })
  });

  function stylePlot(feature) {
  const address = feature.get("address");
  const c = getClaim(address);
  const owner = (c?.owner || "Open Lot").trim();

  // Open lots = gold
  if (!owner || owner === "Open Lot") {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "black", width: 1 }),
      fill: new ol.style.Fill({ color: "rgba(255,215,0,0.25)" })
    });
  }

  // Pending = orange
  if (owner === "PENDING") {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "rgba(255,165,0,0.95)", width: 2 }),
      fill: new ol.style.Fill({ color: "rgba(255,165,0,0.12)" })
    });
  }

  // Claimed = light outline
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: "rgba(0,0,0,0.65)", width: 1 }),
    fill: new ol.style.Fill({ color: "rgba(0,0,0,0.02)" })
  });
}
  
  vectorSource = new ol.source.Vector();
  const vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: stylePlot
  });

  for (const p of plots) {
    if (!p?.address) continue;
    if (!p.w || !p.h) continue; // skip empty rectangles
    const feat = new ol.Feature({
      geometry: new ol.geom.Polygon(rectToPolygon(p.x, p.y, p.w, p.h)),
      address: p.address
    });
    vectorSource.addFeature(feat);
  }

  map = new ol.Map({
    target: "map",
    layers: [imageLayer, vectorLayer],
    view: new ol.View({
      projection,
      center: [width / 2, height / 2],
      zoom: 2,
      minZoom: 1,
      maxZoom: 8
    })
  });

  // Apply styles
  vectorSource.getFeatures().forEach(f => f.setStyle(featureStyle(f)));

  // Click handler
  map.on("singleclick", (evt) => {
    const feature = map.forEachFeatureAtPixel(evt.pixel, f => f) || null;
    selectFeature(feature);
  });

  // Buttons
  btnSave.addEventListener("click", () => {
    if (!selectedFeature) return setStatus("Click a plot first.");
    const address = selectedFeature.get("address");

    const owner = elOwner.value.trim();
    const threadUrl = elThread.value.trim();

    if (!owner || owner === "Open Lot") {
      setClaim(address, null);
      setStatus(`Cleared claim: ${address}`);
    } else {
      setClaim(address, { owner, threadUrl });
      setStatus(`Saved: ${address} → ${owner}`);
    }
    refreshStyles();
  });

  btnClear.addEventListener("click", () => {
    if (!selectedFeature) return setStatus("Click a plot first.");
    const address = selectedFeature.get("address");
    setClaim(address, null);
    selectFeature(selectedFeature);
    refreshStyles();
    setStatus(`Cleared claim: ${address}`);
  });

  btnExport.addEventListener("click", () => {
    const arr = exportShopsArray();
    downloadJSON("shops.json", arr);
    setStatus(`Exported shops.json (${arr.length} claimed). Upload it into data/shops.json`);
  });

  btnCopy.addEventListener("click", async () => {
    const arr = exportShopsArray();
    const text = JSON.stringify(arr, null, 2);
    await navigator.clipboard.writeText(text);
    setStatus(`Copied JSON (${arr.length} claimed) — paste into data/shops.json`);
  });

  setStatus("Ready. Click a plot to begin.");
})();

// Minimal rectangle editor.
// Workflow: pick address -> drag a rectangle -> copy output and paste into data/plots.json.

const PLOTS_URL = "data/plots.json";

const addrSel = document.getElementById("addr");
const out = document.getElementById("out");
const btnClear = document.getElementById("clear");
const btnCopy = document.getElementById("copy");

function toast(msg) {
  // reuse simple alert for editor
  console.log(msg);
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function escapeJsonString(s) {
  return String(s).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

let map, drawLayer, drawSource, plotsMeta, plotsData;
let rectByAddress = new Map();
let activeAddress = null;
let currentFeature = null;

function setOutputFromFeature() {
  if (!activeAddress) return;
  if (!currentFeature) {
    out.value = JSON.stringify({ address: activeAddress, x: 0, y: 0, w: 0, h: 0 }, null, 2);
    return;
  }
  const geom = currentFeature.getGeometry(); // Polygon
  const coords = geom.getCoordinates()[0];
  const xs = coords.map(c => c[0]);
  const ys = coords.map(c => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const entry = {
    address: activeAddress,
    x: Math.round(xMin),
    y: Math.round(yMin),
    w: Math.round(xMax - xMin),
    h: Math.round(yMax - yMin)
  };
  out.value = JSON.stringify(entry, null, 2);
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

(async () => {
  plotsData = await loadJSON(PLOTS_URL);
  plotsMeta = plotsData.meta;
  const { width, height, image } = plotsMeta;

  // Populate dropdown
  for (const p of plotsData.plots) {
    rectByAddress.set(p.address, p);
    const opt = document.createElement("option");
    opt.value = p.address;
    opt.textContent = p.address;
    addrSel.appendChild(opt);
  }
  activeAddress = addrSel.value;

  const extent = [0, 0, width, height];
  const projection = new ol.proj.Projection({ code: "PIXELS", units: "pixels", extent });

  const imageLayer = new ol.layer.Image({
    source: new ol.source.ImageStatic({
      url: image,
      projection,
      imageExtent: extent
    })
  });

  drawSource = new ol.source.Vector();
  drawLayer = new ol.layer.Vector({ source: drawSource });

  map = new ol.Map({
  target: "map",
  layers: [imageLayer, drawLayer],
  interactions: ol.interaction.defaults({
    dragPan: false,
    mouseWheelZoom: true,
    doubleClickZoom: false
  }),
  view: new ol.View({
    projection,
    center: [width / 2, height / 2],
    zoom: 2,
    minZoom: 1,
    maxZoom: 8
  })
});


  // Helper: show existing rect for selected address
  function showExistingRect(address) {
    drawSource.clear();
    currentFeature = null;

    const p = rectByAddress.get(address);
    if (p && p.w > 0 && p.h > 0) {
      const geom = new ol.geom.Polygon(rectToPolygon(p.x, p.y, p.w, p.h));
      currentFeature = new ol.Feature({ geometry: geom });
      drawSource.addFeature(currentFeature);
    }
    setOutputFromFeature();
  }

  // Drag-box rectangle tool (simple)
  let start = null;
  map.on("pointerdown", (evt) => {
    start = evt.coordinate;
  });
  map.on("pointerup", (evt) => {
    if (!start) return;
    const end = evt.coordinate;
    const x1 = Math.min(start[0], end[0]);
    const y1 = Math.min(start[1], end[1]);
    const x2 = Math.max(start[0], end[0]);
    const y2 = Math.max(start[1], end[1]);
    start = null;

    drawSource.clear();
    const geom = new ol.geom.Polygon(rectToPolygon(x1, y1, x2 - x1, y2 - y1));
    currentFeature = new ol.Feature({ geometry: geom });
    drawSource.addFeature(currentFeature);
    setOutputFromFeature();
  });

  addrSel.addEventListener("change", () => {
    activeAddress = addrSel.value;
    showExistingRect(activeAddress);
  });

  btnClear.addEventListener("click", () => {
    drawSource.clear();
    currentFeature = null;
    setOutputFromFeature();
  });

  btnCopy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(out.value);
    toast("Copied!");
    alert("Copied plot JSON to clipboard. Paste it into data/plots.json, replacing the entry for this address.");
  });

  // init
  showExistingRect(activeAddress);
})();

/* Earth Element Explorer: layered globe, periodic table selector, sourced deposit + production data. */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 0) => (x == null ? "n/a" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d }));
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const loading = (msg) => { $("loading").textContent = msg || ""; $("loading").hidden = !msg; };
  const R2D = 180 / Math.PI, D2R = Math.PI / 180;

  // ---------------------------------------------------------------- token + viewer
  const cfg = window.EARTH_CONFIG || {};
  const TOKEN_KEY = "earthExplorer.ionToken";
  let stored = "";
  try { stored = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
  const fileToken = (cfg.CESIUM_ION_TOKEN || "").trim();
  const token = fileToken || stored.trim();
  const common = {
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, homeButton: true,
  };
  let viewer;
  if (token) {
    Cesium.Ion.defaultAccessToken = token;
    const worldTerrain = Cesium.Terrain.fromWorldTerrain();
    viewer = new Cesium.Viewer("globe", { ...common, terrain: worldTerrain });
    $("terrain").innerHTML = "Terrain: Cesium World Terrain. Imagery: Bing Maps aerial via Cesium ion (free Community tier, non-commercial use). " +
      "Marker heights come from NOAA ETOPO 2022 at about 1.8 km resolution, so a marker can sit slightly off the ground at close zoom." +
      (fileToken ? "" : ' <button type="button" id="token-clear" class="linkish">Remove token</button>');
    worldTerrain.errorEvent.addEventListener((err) => {
      $("terrain").innerHTML = "Cesium ion rejected the token or terrain failed to load (" + esc(err && err.message ? err.message : "unknown error") +
        "). Check the token at ion.cesium.com. " + (fileToken ? "" : '<button type="button" id="token-clear" class="linkish">Remove token</button>');
      wireClear();
    });
  } else {
    Cesium.Ion.defaultAccessToken = "";
    viewer = new Cesium.Viewer("globe", {
      ...common,
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"))),
    });
    $("terrain").innerHTML = "Terrain is flat. Imagery is Natural Earth II (public domain, ships with CesiumJS). " +
      "Paste a free Cesium ion token to turn on 3D terrain and satellite imagery. It stays in this browser only." +
      '<span class="token-row"><input id="token-in" type="password" autocomplete="off" placeholder="Cesium ion access token" aria-label="Cesium ion access token">' +
      '<button type="button" id="token-save">Turn on terrain</button></span>';
    $("token-save").onclick = () => {
      const v = $("token-in").value.trim();
      if (!v) return $("token-in").focus();
      try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {}
      location.reload();
    };
  }
  function wireClear() {
    const b = $("token-clear");
    if (b) b.onclick = () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} location.reload(); };
  }
  wireClear();

  const scene = viewer.scene, globe = scene.globe, camera = viewer.camera;
  globe.depthTestAgainstTerrain = true;
  globe.baseColor = Cesium.Color.fromCssColorString("#0f1d27");
  globe.translucency.enabled = false;
  camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-40, 25, 2.0e7) });
  camera.percentageChanged = 0.05;

  // ---------------------------------------------------------------- styles
  const DEV_STYLE = [
    { label: "Producer", color: "#f2c230", size: 7 }, { label: "Past producer", color: "#d9a53a", size: 5 },
    { label: "Prospect", color: "#b07a36", size: 4.5 }, { label: "Occurrence", color: "#8fa3ad", size: 3.5 },
    { label: "Processing plant", color: "#e8e1c8", size: 5 }, { label: "Status unknown", color: "#667a85", size: 3.5 },
  ];
  const OP_STYLE = [
    { label: "Surface (pit or quarry)", color: "#f2c230", size: 5 }, { label: "Underground", color: "#6fb7e0", size: 5 },
    { label: "Surface and underground", color: "#b7a4ea", size: 5 }, { label: "Placer", color: "#d9a53a", size: 4.5 },
    { label: "Well or brine", color: "#63c9a0", size: 4.5 }, { label: "Offshore", color: "#4f8fd6", size: 4.5 },
    { label: "Processing plant", color: "#e8e1c8", size: 4.5 }, { label: "Not recorded", color: "#667a85", size: 3.5 },
  ];
  const SRC_STYLE = [
    { label: "USGS MRDS", color: "#f2c230", size: 4.5 }, { label: "USGS rare earth database", color: "#e8e1c8", size: 5 },
    { label: "Geoscience Australia", color: "#6fb7e0", size: 4.5 }, { label: "MinCan (Canada)", color: "#e07a6f", size: 5 },
    { label: "Global mine production database", color: "#63c9a0", size: 5.5 }, { label: "EGDI (Europe)", color: "#b7a4ea", size: 4.5 },
  ];
  const srcOfId = (id) => { id = String(id); return id.startsWith("ree:") ? 1 : id.startsWith("ga:") ? 2 : id.startsWith("mincan:") ? 3 : id.startsWith("minedb:") ? 4 : id.startsWith("egdi:") ? 5 : 0; };
  const RAMP = ["#17485c", "#2b7f8c", "#57b8a5", "#b9e6c4"];
  const rampCss = (t) => {
    const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x));
    return Cesium.Color.lerp(Cesium.Color.fromCssColorString(RAMP[i]), Cesium.Color.fromCssColorString(RAMP[i + 1]), x - i, new Cesium.Color());
  };
  // PREM boundaries (Dziewonski & Anderson 1981), outer radius in km
  const LAYERS = [
    { key: "crust", name: "Crust", r: 6371, inner: 6346.6, depth: "0–24 km (PREM average)", color: "#8a6f4d" },
    { key: "upper", name: "Upper mantle", r: 6346.6, inner: 5701, depth: "24–670 km", color: "#c0693a" },
    { key: "lower", name: "Lower mantle", r: 5701, inner: 3480, depth: "670–2,891 km", color: "#8e3b2c" },
    { key: "outer", name: "Outer core (liquid)", r: 3480, inner: 1221.5, depth: "2,891–5,150 km", color: "#e0a13a" },
    { key: "inner", name: "Inner core (solid)", r: 1221.5, inner: 1, depth: "5,150–6,371 km", color: "#f3e2a0" },
  ];
  const CLASS_TEXT = {
    siderophile: ["Siderophile (iron-loving)", "Most of Earth's supply is thought to have sunk into the metallic core as the planet formed. What we mine is the small share left in the crust.", ["outer", "inner"]],
    lithophile: ["Lithophile (rock-loving)", "Concentrates in silicate rock, so the crust and mantle hold most of it.", ["crust", "upper", "lower"]],
    chalcophile: ["Chalcophile (sulfur-loving)", "Bonds with sulfur and tends to collect in sulfide minerals in the crust and mantle; some is thought to reside in the core.", ["crust", "upper"]],
    atmophile: ["Atmophile (gas-forming)", "Mostly found as gas in the atmosphere and oceans, or trapped in natural gas.", []],
  };

  // ---------------------------------------------------------------- state
  const S = {
    entry: null, data: null, colorBy: "dev", mode: "auto",
    hidden: { dev: new Set(), op: new Set(), src: new Set() }, metric: "prod", interior: "layers", tomoDepth: 2800,
    show: { sites: true, prod: true, surface: true, hosts: true, trade: true, plates: false },
    op: { sites: 1, prod: 0.55, surface: 1, hosts: 0.8, trade: 0.8, plates: 0.7 }, year: null, hist: null,
    cut: 0, lon0: 0, north: true, densityOn: false, positions: [],
  };

  // ---------------------------------------------------------------- base data
  loading("Loading element index…");
  let IDX, CTRY;
  try {
    [IDX, CTRY] = await Promise.all([
      fetch("data/elements.json").then((r) => r.json()),
      fetch("data/countries.json").then((r) => r.json()),
    ]);
  } catch (e) {
    loading("Couldn't load the data folder (" + e.message + "). Serve this folder over http, e.g. python3 -m http.server");
    return;
  }
  const BY_SYM = Object.fromEntries(IDX.elements.map((e) => [e.sym, e]));
  const SRC = IDX.sources;
  $("sources").innerHTML = [
    ["mrds", `Deposit sites: <a href="${SRC.mrds.url}" target="_blank" rel="noopener">${SRC.mrds.name}</a>, file dated ${SRC.mrds.date}.`],
    ["ree", `Rare earth sites also from <a href="${SRC.ree.url}" target="_blank" rel="noopener">${SRC.ree.name}</a>, ${SRC.ree.date}. ${IDX.reeStats.matched_mrds} of its ${IDX.reeStats.records} located sites matched an MRDS site within 5 km and were merged; ${IDX.reeStats.added} were added.`],
    ["usgs", `Production: <a href="${SRC.usgs.url}" target="_blank" rel="noopener">${SRC.usgs.name}</a> (${SRC.usgs.date}), cross-checked against <a href="${SRC.bgs.url}" target="_blank" rel="noopener">${SRC.bgs.name}</a>, ${SRC.bgs.date}.`],
    ["more", (() => { const m = IDX.mergeStats; const f = (k) => `${fmt(m[k].added)} added, ${fmt(m[k].matched)} merged with an existing site within about 650 m`;
      return `More sites: <a href="${SRC.ga.url}" target="_blank" rel="noopener">${SRC.ga.name}</a> (${f("4")}); <a href="${SRC.mincan.url}" target="_blank" rel="noopener">${SRC.mincan.name}</a> (${f("8")}); <a href="${SRC.minedb.url}" target="_blank" rel="noopener">${SRC.minedb.name}</a> (${f("16")}), which also adds mine-level output; <a href="${SRC.egdi.url}" target="_blank" rel="noopener">${SRC.egdi.name}</a> (${f("32")}).`; })()],
    ["res", `Reserves and the critical-mineral flag: USGS MCS 2026 (2025 U.S. critical minerals list). Host-ore links follow the byproduct sources named in the MCS 2026 commodity chapters.`],
    ["germ", `Share of each element by layer: <a href="${SRC.germ.url}" target="_blank" rel="noopener">${SRC.germ.name}</a>. Tomography: <a href="${SRC.tomo.url}" target="_blank" rel="noopener">${SRC.tomo.name}</a>.`],
    ["new", `Production history: <a href="${SRC.bgshist.url}" target="_blank" rel="noopener">${SRC.bgshist.name}</a>. Trade: <a href="${SRC.comtrade.url}" target="_blank" rel="noopener">${SRC.comtrade.name}</a>. Plates: <a href="${SRC.plates.url}" target="_blank" rel="noopener">${SRC.plates.name}</a>.`],
    ["etopo", `Marker elevation: <a href="${SRC.etopo.url}" target="_blank" rel="noopener">${SRC.etopo.name}</a>. Country shapes: Natural Earth 1:110m.`],
  ].map(([, h]) => `<li>${h}</li>`).join("");

  // ---------------------------------------------------------------- periodic table
  const phone = window.matchMedia("(max-width: 640px)");
  const pt = $("ptable");
  IDX.elements.forEach((e) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pt" + (e.sites ? " has-sites" : e.prod || e.prodWorldOnly ? " has-prod" : "") + (e.critical ? " critical" : "");
    b.style.gridColumn = e.x; b.style.gridRow = e.y >= 9 ? e.y : e.y;
    b.dataset.sym = e.sym; b.setAttribute("role", "gridcell"); b.setAttribute("aria-selected", "false");
    const bits = [e.sites ? `${fmt(e.sites)} sites` : "no mapped sites", e.prod ? "production by country" : e.prodWorldOnly ? "world production only" : "no production data"];
    if (e.critical) bits.push("U.S. critical mineral");
    b.title = `${e.name}: ${bits.join(", ")}`;
    b.setAttribute("aria-label", `${e.name}, ${bits.join(", ")}`);
    b.innerHTML = `<span class="zz">${e.z}</span><span class="s">${e.sym}</span>`;
    b.onclick = () => { selectElement(e.sym); if (phone.matches) $("ptable-toggle").click(); };
    pt.appendChild(b);
  });
  $("ptable-toggle").onclick = (ev) => {
    const closed = $("ptable-wrap").classList.toggle("closed");
    ev.currentTarget.setAttribute("aria-expanded", !closed);
    ev.currentTarget.textContent = closed ? "Periodic table" : "Hide table";
  };
  if (phone.matches) { $("ptable-wrap").classList.add("closed"); $("ptable-toggle").setAttribute("aria-expanded", "false"); }
  else $("ptable-toggle").textContent = "Hide table";
  $("tile").onclick = () => {
    const w = $("ptable-wrap");
    if (w.classList.contains("closed")) $("ptable-toggle").click();
    const cur = pt.querySelector('[aria-selected="true"]');
    (cur || pt.firstChild).focus();
  };

  // ---------------------------------------------------------------- primitives
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const bins = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const hostPts = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const prodDS = new Cesium.CustomDataSource("production");
  const interiorDS = new Cesium.CustomDataSource("interior");
  viewer.dataSources.add(prodDS); viewer.dataSources.add(interiorDS);
  const outline = Cesium.Color.BLACK.withAlpha(0.55);
  const scaler = new Cesium.NearFarScalar(2e5, 1.8, 1.8e7, 0.7);
  let byIndex = [];

  function horizon() {
    const h = Math.max(camera.positionCartographic.height, 1);
    return Math.sqrt(h * (2 * 6371000 + h));
  }
  function syncDepth() {
    // Draw markers nearer than the horizon without depth testing (so terrain or the ellipsoid can't clip
    // them), and depth-test anything beyond, so markers on the far side of the planet stay hidden.
    // While the interior is showing, depth-test everything so markers can't paint over the cutaway.
    const hz = interiorDS.show ? 0 : horizon();
    for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = hz;
    for (let i = 0; i < bins.length; i++) bins.get(i).disableDepthTestDistance = hz;
    for (let i = 0; i < hostPts.length; i++) hostPts.get(i).disableDepthTestDistance = hz;
  }
  function inWedge(lon, lat) {
    if (S.cut <= 0) return false;
    if (S.north ? lat < 0 : lat > 0) return false;
    const d = (((lon - S.lon0) % 360) + 360) % 360;
    return d < S.cut;
  }

  // ---------------------------------------------------------------- sites
  const STYLES = { dev: DEV_STYLE, op: OP_STYLE, src: SRC_STYLE };
  function catOf(i) { const d = S.data.sites; return S.colorBy === "dev" ? d.dev[i] : S.colorBy === "op" ? d.op[i] : d.srcCat[i]; }
  function styleOf(i) { return STYLES[S.colorBy][catOf(i)]; }
  function buildSites() {
    points.removeAll(); bins.removeAll(); byIndex = [];
    const d = S.data && S.data.sites;
    if (!d) return;
    const n = d.id.length;
    byIndex = new Array(n);
    const order = [...Array(n).keys()].sort((a, b) => d.dev[b] - d.dev[a]);
    for (const i of order) {
      const h = token ? d.z[i] + 12 : 0;
      byIndex[i] = points.add({
        id: { kind: "site", i }, position: Cesium.Cartesian3.fromDegrees(d.lon[i], d.lat[i], h),
        outlineColor: outline, outlineWidth: 1, scaleByDistance: scaler,
      });
    }
    restyle();
  }
  function restyle() {
    const d = S.data && S.data.sites;
    if (!d) return;
    const hide = S.hidden[S.colorBy], alpha = S.op.sites;
    const showSites = S.show.sites && !S.densityOn;
    const colors = STYLES[S.colorBy].map((s) => Cesium.Color.fromCssColorString(s.color).withAlpha(alpha));
    const ol = outline.withAlpha(0.55 * alpha);
    for (let i = 0; i < byIndex.length; i++) {
      const p = byIndex[i], c = catOf(i);
      p.show = showSites && !hide.has(c) && !inWedge(d.lon[i], d.lat[i]);
      p.color = colors[c]; p.outlineColor = ol;
      if (p !== selected) p.pixelSize = STYLES[S.colorBy][c].size;
    }
    buildBins(); styleHosts();
    syncDepth();
  }
  function buildBins() {
    bins.removeAll();
    const d = S.data && S.data.sites;
    if (!d || !S.densityOn || !S.show.sites) return;
    const hide = S.hidden[S.colorBy], cells = new Map();
    for (let i = 0; i < d.id.length; i++) {
      if (hide.has(catOf(i)) || inWedge(d.lon[i], d.lat[i])) continue;
      const k = Math.floor((d.lat[i] + 90) / 2) * 1000 + Math.floor((d.lon[i] + 180) / 2);
      const c = cells.get(k) || { n: 0, lon: 0, lat: 0, z: 0 };
      c.n++; c.lon += d.lon[i]; c.lat += d.lat[i]; c.z += d.z[i]; cells.set(k, c);
    }
    let max = 1;
    cells.forEach((c) => (max = Math.max(max, c.n)));
    const base = Cesium.Color.fromCssColorString("#f2c230");
    cells.forEach((c) => {
      const t = Math.log(c.n + 1) / Math.log(max + 1);
      bins.add({
        id: { kind: "bin", n: c.n, lon: c.lon / c.n, lat: c.lat / c.n },
        position: Cesium.Cartesian3.fromDegrees(c.lon / c.n, c.lat / c.n, token ? Math.max(c.z / c.n, 0) + 50 : 0),
        pixelSize: 5 + 20 * t, color: base.withAlpha((0.25 + 0.65 * t) * S.op.sites),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.4 * S.op.sites), outlineWidth: 1,
      });
    });
    syncDepth();
  }
  function updateMode() {
    const n = byIndex.length, h = camera.positionCartographic.height;
    const want = S.mode === "density" || (S.mode === "auto" && n > 4000 && h > 3.0e6);
    if (want !== S.densityOn) { S.densityOn = want; restyle(); }
    $("mode-note").textContent = !n ? "" : S.densityOn
      ? (S.mode === "auto" ? `Showing ${fmt(n)} sites as 2° density cells. Zoom in closer than about 3,000 km to see every site.` : "Showing 2° density cells. Brighter and larger means more sites.")
      : `Showing all ${fmt(n)} sites.`;
  }
  function renderLegend() {
    const d = S.data && S.data.sites, ul = $("legend");
    ul.innerHTML = "";
    if (!d) return;
    const styles = STYLES[S.colorBy], counts = new Array(styles.length).fill(0);
    for (let i = 0; i < d.id.length; i++) counts[catOf(i)]++;
    styles.forEach((s, k) => {
      if (!counts[k]) return;
      const li = document.createElement("li"), on = !S.hidden[S.colorBy].has(k);
      li.innerHTML = `<button type="button" aria-pressed="${on}"><span class="dot" style="background:${s.color}"></span><span>${s.label}</span><span class="n">${fmt(counts[k])}</span></button>`;
      li.firstChild.onclick = (ev) => {
        const set = S.hidden[S.colorBy];
        set.has(k) ? set.delete(k) : set.add(k);
        ev.currentTarget.setAttribute("aria-pressed", !set.has(k));
        restyle();
      };
      ul.appendChild(li);
    });
    if (S.colorBy === "src") {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = "Color shows the database each record came from. Sites found in more than one database were merged; the card lists every source.";
      ul.appendChild(li);
    }
    if (S.colorBy === "op") {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = "From the MRDS operation type: how a site is or was worked. It is not a measured deposit depth.";
      ul.appendChild(li);
    }
  }

  // ---------------------------------------------------------------- host ores (byproducts)
  const HOST_COLOR = { Al: "#9ad0ec", Zn: "#b7a4ea", Cu: "#e39a6a", Mo: "#8fd3b6", Pb: "#c9c9c9", W: "#e0c36f", Ni: "#79c28c", Zr: "#d7b8e8", Au: "#f2c230" };
  function buildHosts() {
    hostPts.removeAll();
    const H = S.data && S.data.hosts;
    $("ly-hosts").hidden = !H;
    if (!H) return;
    for (let i = 0; i < H.id.length; i++) {
      hostPts.add({ id: { kind: "host", i }, position: Cesium.Cartesian3.fromDegrees(H.lon[i], H.lat[i], token ? H.z[i] + 12 : 0),
        pixelSize: 6, color: Cesium.Color.TRANSPARENT, outlineWidth: 1.5, scaleByDistance: scaler,
        outlineColor: Cesium.Color.fromCssColorString(HOST_COLOR[H.host[i]] || "#9ad0ec") });
    }
    styleHosts();
  }
  function styleHosts() {
    const H = S.data && S.data.hosts;
    if (!H) return;
    for (let i = 0; i < hostPts.length; i++) {
      const p = hostPts.get(i), k = p.id.i;
      p.show = S.show.hosts && !S.densityOn && !inWedge(H.lon[k], H.lat[k]);
      p.outlineColor = Cesium.Color.fromCssColorString(HOST_COLOR[H.host[k]] || "#9ad0ec").withAlpha(S.op.hosts);
    }
    syncDepth();
  }
  function hostNote() {
    const H = S.data && S.data.hosts, e = S.entry;
    if (!H) return "";
    const names = [...new Set(H.host)].map((h) => BY_SYM[h].name.toLowerCase());
    return `${e.name} is mostly recovered as a byproduct of ${names.join(" and ")} processing, so ${fmt(H.id.length)} producing ${names.join(" and ")} mines are shown as hollow rings. These are likely sources inferred from the host ore, not confirmed ${e.name} output.`;
  }

  // ---------------------------------------------------------------- plate boundaries
  const platesDS = new Cesium.CustomDataSource("plates");
  viewer.dataSources.add(platesDS);
  let platesLoaded = false;
  const PLATE = Cesium.Color.fromCssColorString("#ff6f4f");
  async function applyPlates() {
    platesDS.show = S.show.plates;
    if (S.show.plates && !platesLoaded) {
      platesLoaded = true;
      const pl = await fetch("data/plates.json").then((r) => r.json());
      pl.lines.forEach((ln, k) => platesDS.entities.add({ id: "plate:" + k, plate: true,
        polyline: { positions: Cesium.Cartesian3.fromDegreesArray(ln.flat()), width: 2, clampToGround: !!token, material: PLATE.withAlpha(S.op.plates) } }));
    }
    platesDS.entities.values.forEach((en) => (en.polyline.material = PLATE.withAlpha(S.op.plates)));
  }

  // ---------------------------------------------------------------- production history (BGS 1970-2024)
  const histCache = {};
  async function loadHist(sym) {
    if (histCache[sym]) return histCache[sym];
    loading("Loading production history…");
    try { histCache[sym] = await fetch(`data/hist/${sym}.json`).then((r) => r.json()); } finally { loading(""); }
    return histCache[sym];
  }
  let playTimer = null;
  function stopPlay() { clearInterval(playTimer); playTimer = null; $("play").textContent = "▶"; $("play").setAttribute("aria-label", "Play production history"); }
  async function setYear(y) {
    const e = S.entry;
    if (!e || !e.hist) return;
    if (y >= 2025) { S.year = null; $("year-label").textContent = "Latest"; buildProd(); return; }
    S.hist = await loadHist(e.sym);
    S.year = y; $("year-label").textContent = y; buildProd();
  }

  // ---------------------------------------------------------------- trade flows (UN Comtrade 2023)
  const tradeDS = new Cesium.CustomDataSource("trade");
  viewer.dataSources.add(tradeDS);
  let TRADE = null;
  const TRADE_COLOR = Cesium.Color.fromCssColorString("#d58cf2");
  function arcPositions(a, b) {
    const p0 = Cesium.Cartesian3.fromDegrees(a[0], a[1]), p1 = Cesium.Cartesian3.fromDegrees(b[0], b[1]);
    const ang = Cesium.Cartesian3.angleBetween(p0, p1), lift = 900000 * Math.min(1, ang / 1.2) + 120000, pts = [];
    const n0 = Cesium.Cartesian3.normalize(p0, new Cesium.Cartesian3()), n1 = Cesium.Cartesian3.normalize(p1, new Cesium.Cartesian3());
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, s0 = Math.sin((1 - t) * ang) / Math.sin(ang), s1 = Math.sin(t * ang) / Math.sin(ang);
      const dir = Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(n0, s0, new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(n1, s1, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const c = Cesium.Cartographic.fromCartesian(Cesium.Cartesian3.multiplyByScalar(dir, 6371000, new Cesium.Cartesian3()));
      pts.push(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, Math.sin(Math.PI * t) * lift));
    }
    return pts;
  }
  const countryXY = (iso) => { const c = CTRY.countries[iso]; return c && c.lon != null ? [c.lon, c.lat] : null; };
  const money = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : `$${fmt(v)}`);
  async function buildTrade() {
    tradeDS.entities.removeAll();
    const e = S.entry, sec = $("sec-trade");
    if (!TRADE) { try { TRADE = await fetch("data/trade.json").then((r) => r.json()); } catch (err) { TRADE = { elements: {} }; } }
    const T = e && TRADE.elements[e.sym];
    sec.hidden = !T; $("ly-trade").hidden = !T;
    if (!T) return;
    const flows = T.flows.filter((f) => countryXY(f.from) && countryXY(f.to) && f.from !== f.to && f.usd > 0);
    const vmax = Math.max(...flows.map((f) => f.usd), 1);
    flows.forEach((f, k) => {
      tradeDS.entities.add({ id: "trade:" + k, flow: f, polyline: { positions: arcPositions(countryXY(f.from), countryXY(f.to)),
        width: 3 + 9 * Math.sqrt(f.usd / vmax), arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineArrowMaterialProperty(TRADE_COLOR.withAlpha(S.op.trade)) } });
    });
    $("trade-sum").textContent = `${T.label} (HS ${T.hs}), ${T.year} exports worth ${money(T.worldExportsUsd)} reported by ${T.exporters} countries. Arcs show each of the top 6 exporters' 5 largest destinations by value.` +
      (T.note ? " " + T.note : "") + " Source: UN Comtrade.";
    $("trade-top").innerHTML = flows.slice().sort((a, b) => b.usd - a.usd).slice(0, 6)
      .map((f) => `<li><span>${esc(f.fromName)} → ${esc(f.toName)}</span><span class="n">${money(f.usd)}</span></li>`).join("");
    applyTrade();
  }
  function applyTrade() {
    tradeDS.show = S.show.trade;
    tradeDS.entities.values.forEach((en) => (en.polyline.material = new Cesium.PolylineArrowMaterialProperty(TRADE_COLOR.withAlpha(S.op.trade))));
  }

  // ---------------------------------------------------------------- close-zoom terrain snapping
  // ETOPO heights (~1.8 km cells) can leave markers floating or buried in steep terrain. When the camera is
  // close, sample Cesium World Terrain for the sites in view (at most 1,500 at a time) and snap them to it.
  const snapped = new Set();
  let snapBusy = false;
  async function snapToTerrain() {
    if (!token || snapBusy || !S.data || !S.data.sites || camera.positionCartographic.height > 400000) return;
    const rect = camera.computeViewRectangle(); if (!rect) return;
    const d = S.data.sites, sym = S.entry.sym, idx = [];
    for (let i = 0; i < d.id.length && idx.length < 1500; i++) {
      if (snapped.has(sym + i)) continue;
      const lo = d.lon[i] * D2R, la = d.lat[i] * D2R;
      if (la >= rect.south && la <= rect.north && lo >= rect.west && lo <= rect.east) idx.push(i);
    }
    if (!idx.length) return;
    snapBusy = true;
    try {
      const carto = idx.map((i) => Cesium.Cartographic.fromDegrees(d.lon[i], d.lat[i]));
      await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carto);
      if (S.entry.sym === sym) carto.forEach((c, k) => {
        const i = idx[k];
        if (Number.isFinite(c.height) && byIndex[i]) { byIndex[i].position = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + 3); snapped.add(sym + i); }
      });
    } catch (err) { /* terrain unavailable: keep ETOPO heights */ }
    snapBusy = false;
  }
  camera.moveEnd.addEventListener(snapToTerrain);

  // ---------------------------------------------------------------- production
  let prodScale = null;
  function metricRows(P) {
    if (S.metric === "prod" && S.year && S.hist) {
      const H = S.hist, k = H.years.indexOf(S.year);
      const rows = Object.entries(H.countries).filter(([, c]) => c.v[k] > 0)
        .map(([iso, c]) => [iso, { value: c.v[k], name: c.name, pole: c.pole }]).sort((a, b) => b[1].value - a[1].value);
      return { unit: H.unit, world: rows.reduce((t, r) => t + r[1].value, 0), worldYear: String(S.year), label: `${H.commodity}, ${S.year} (BGS)`, rows, text: [], hist: true };
    }
    if (S.metric === "res" && P.reserves) {
        const R = P.reserves;
        return { unit: R.unit, world: R.world, worldYear: null, label: R.detail === "Reserves" ? "reserves" : R.detail.toLowerCase(),
          rows: Object.entries(R.by).filter(([, v]) => typeof v === "number" && v > 0).map(([iso, v]) => [iso, { value: v, name: (P.countries[iso] || {}).name || (CTRY.countries[iso] || {}).name || iso }]).sort((x, y) => y[1].value - x[1].value),
          text: Object.entries(R.by).filter(([, v]) => typeof v !== "number") };
    }
    return { unit: P.unit.trim(), world: P.world, worldYear: P.worldYear, label: P.label,
      rows: Object.entries(P.countries).filter(([, e]) => e.value > 0).sort((a, b) => b[1].value - a[1].value), text: [] };
  }
  function buildProd() {
    prodDS.entities.removeAll();
    const P = S.data && S.data.production;
    const sec = $("sec-prod");
    $("top").innerHTML = ""; $("ramp").style.background = "";
    const old = $("ramp").nextElementSibling; if (old && old.classList.contains("ramp-labels")) old.remove();
    const hasRes = !!(P && P.reserves && Object.keys(P.reserves.by).length);
    $("timeline").hidden = !(S.entry && S.entry.hist) || S.metric !== "prod";
    document.querySelector('[data-metric="res"]').disabled = !hasRes;
    if (!hasRes && S.metric === "res") setMetric("prod", true);
    if (!P || (!Object.keys(P.countries).length && !P.world && !hasRes)) { sec.hidden = true; $("ly-prod").hidden = true; return; }
    sec.hidden = false; $("ly-prod").hidden = false;
    const M = metricRows(P), rows = M.rows, unit = M.unit;
    const worldTxt = M.world ? ` ${M.hist ? "Sum of listed countries" : "World total"} ${fmt(M.world)} ${unit}${M.worldYear && !M.hist ? ` (${M.worldYear}${M.worldYear === "2025" ? ", estimated" : ""})` : ""}.` : "";
    const what = S.metric === "res" ? `${cap(M.label)} (USGS MCS 2026)` : cap(M.label);
    $("prod-sum").textContent = rows.length
      ? `${what}, ${unit}. ${rows.length} countries.${worldTxt}`
      : `${what}: no country breakdown is published.${worldTxt}`;
    if (!rows.length) return;
    const vmax = rows[0][1].value, vmin = rows[rows.length - 1][1].value;
    const lmin = Math.log10(Math.max(vmin, vmax / 1e4)), lmax = Math.log10(vmax);
    prodScale = (v) => (lmax === lmin ? 1 : (Math.log10(Math.max(v, 10 ** lmin)) - lmin) / (lmax - lmin));
    $("ramp").style.background = `linear-gradient(90deg, ${RAMP.join(",")})`;
    $("ramp").insertAdjacentHTML("afterend", `<div class="ramp-labels"><span>${fmt(10 ** lmin, 1)}</span><span>log scale</span><span>${fmt(vmax)}</span></div>`);
    rows.forEach(([iso, e]) => {
      const col = rampCss(prodScale(e.value));
      const c = CTRY.countries[iso];
      const pe = P.countries[iso] || e;
      if (c) {
        c.polys.forEach((poly, k) => {
          prodDS.entities.add({
            id: `c:${iso}:${k}`, iso, base: col,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(poly[0].flat()),
                poly.slice(1).map((h) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(h.flat())))),
              material: col.withAlpha(S.op.prod), classificationType: Cesium.ClassificationType.TERRAIN,
            },
          });
        });
      } else if (pe.pole) {
        prodDS.entities.add({ id: `c:${iso}:p`, iso, base: col, position: Cesium.Cartesian3.fromDegrees(pe.pole[0], pe.pole[1]),
          point: { pixelSize: 9, color: col.withAlpha(S.op.prod), outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
                   heightReference: token ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE } });
      }
    });
    const share = (v) => (M.world ? ` (${fmt((100 * v) / M.world, v / M.world < 0.01 ? 1 : 0)}%)` : "");
    rows.slice(0, 6).forEach(([iso, e]) => {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button"><span>${esc(e.name)}</span><span class="n">${fmt(e.value)}${share(e.value)}</span></button>`;
      li.firstChild.onclick = () => { flyToCountry(iso, P.countries[iso]); showCountry(iso); };
      $("top").appendChild(li);
    });
    applyProdVisibility();
  }
  function setMetric(m, silent) {
    S.metric = m;
    document.querySelectorAll("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.metric === m));
    if (!silent) buildProd();
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function countryPoint(iso, e) {
    const c = CTRY.countries[iso];
    if (c && c.lon != null) return [c.lon, c.lat];
    return e && e.pole ? e.pole : null;
  }
  function applyProdVisibility() {
    prodDS.show = S.show.prod;
    const P = S.data && S.data.production;
    prodDS.entities.values.forEach((en) => {
      const pt = countryPoint(en.iso, P && P.countries[en.iso]);
      en.show = !(pt && inWedge(pt[0], pt[1]));
    });
  }
  let prodTimer = null;
  function setProdOpacity() {
    clearTimeout(prodTimer);
    prodTimer = setTimeout(() => {
      prodDS.entities.values.forEach((en) => {
        const c = en.base.withAlpha(S.op.prod);
        if (en.polygon) en.polygon.material = c; else if (en.point) en.point.color = c;
      });
    }, 120);
  }
  function flyToCountry(iso, e) {
    const p = countryPoint(iso, e);
    if (p) camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(p[0], p[1], 4.5e6), duration: 1.4 });
  }

  // ---------------------------------------------------------------- interior + cutaway
  const SX = 6378137 / 6371000, SZ = 6356752.3 / 6371000;
  const shells = LAYERS.map((L) => {
    const outer = L.r * 1000 * (L.key === "crust" ? 0.997 : 1), inner = L.inner * 1000;
    const mk = (part) => interiorDS.entities.add({
      id: `layer:${L.key}:${part}`, layer: L.key,
      position: Cesium.Cartesian3.ZERO, orientation: Cesium.Quaternion.IDENTITY,
      ellipsoid: {
        radii: new Cesium.Cartesian3(outer * SX, outer * SX, outer * SZ),
        innerRadii: new Cesium.Cartesian3(inner * SX, inner * SX, inner * SZ),
        material: Cesium.Color.fromCssColorString(L.color), slicePartitions: 72, stackPartitions: 36,
      },
    });
    return { L, a: mk("a"), b: mk("b") };
  });
  interiorDS.show = false;
  const clip = new Cesium.ClippingPlaneCollection({
    planes: [new Cesium.ClippingPlane(Cesium.Cartesian3.UNIT_X, 0), new Cesium.ClippingPlane(Cesium.Cartesian3.UNIT_X, 0),
             new Cesium.ClippingPlane(Cesium.Cartesian3.UNIT_Z, 0)],
    unionClippingRegions: false, edgeColor: Cesium.Color.fromCssColorString("#e8b83a"), edgeWidth: 1.5, enabled: false,
  });
  globe.clippingPlanes = clip;

  function applyCut() {
    const th = S.cut * D2R, l1 = S.lon0 * D2R, l2 = l1 + th;
    clip.enabled = S.cut > 0;
    if (S.cut > 0) {
      // A region is clipped only when it is outside every plane: the wedge between l1 and l2 in one hemisphere.
      clip.get(0).normal = new Cesium.Cartesian3(Math.sin(l1), -Math.cos(l1), 0);
      clip.get(1).normal = new Cesium.Cartesian3(-Math.sin(l2), Math.cos(l2), 0);
      clip.get(2).normal = new Cesium.Cartesian3(0, 0, S.north ? -1 : 1);
    }
    const coneA = S.north ? [Math.PI / 2, Math.PI] : [0, Math.PI / 2];
    const coneB = S.north ? [0, Math.PI / 2] : [Math.PI / 2, Math.PI];
    const minC = S.cut > 0 ? l2 : 0, maxC = S.cut > 0 ? l1 + 2 * Math.PI : 2 * Math.PI;
    shells.forEach(({ a, b }) => {
      a.ellipsoid.minimumCone = coneA[0]; a.ellipsoid.maximumCone = coneA[1];
      a.ellipsoid.minimumClock = 0; a.ellipsoid.maximumClock = 2 * Math.PI;
      b.ellipsoid.minimumCone = coneB[0]; b.ellipsoid.maximumCone = coneB[1];
      b.ellipsoid.minimumClock = minC; b.ellipsoid.maximumClock = maxC;
    });
    interiorDS.show = S.cut > 0 || S.op.surface < 0.999;
    $("sec-interior").hidden = !interiorDS.show;
    if (S.interior === "tomo") applyInteriorMode();
    restyle(); applyProdVisibility();
  }
  function applySurface() {
    const a = S.op.surface;
    globe.translucency.enabled = a < 0.999;
    globe.translucency.frontFaceAlpha = a;
    globe.translucency.backFaceAlpha = a * 0.25;
    viewer.imageryLayers.get(0) && (viewer.imageryLayers.get(0).show = S.show.surface);
    interiorDS.show = S.cut > 0 || a < 0.999;
    $("sec-interior").hidden = !interiorDS.show;
    if (tomoPrim) tomoPrim.show = S.interior === "tomo" && interiorDS.show;
    syncDepth();
  }
  // tomography: a shell of 2°x2° cells at the chosen depth, colored from the measured slice.
  // The shell lies wholly inside the ellipsoid, so Cesium's horizon culling would drop it whenever the globe is
  // opaque; culling is off and, with the cutaway open, only the cells inside the wedge are shown (a floor at that
  // depth), so nothing can draw over the surface outside the wedge.
  const TOMO = IDX.tomo || [];
  let tomoData = null, tomoPrim = null, tomoBuiltFor = null, tomoCells = null, tomoAttrs = null;
  $("tomo-depths").innerHTML = TOMO.map((t) => `<button type="button" data-depth="${t.depth}" aria-pressed="${t.depth === S.tomoDepth}">${fmt(t.depth)} km</button>`).join("");
  $("tomo-depths").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.tomoDepth = +b.dataset.depth; applyInteriorMode(); }));
  const SLOW = Cesium.Color.fromBytes(200, 50, 40), MID = Cesium.Color.fromBytes(242, 238, 230), FAST = Cesium.Color.fromBytes(40, 90, 190);
  function tomoColor(v, lim) {
    const t = Math.max(-1, Math.min(1, v / lim));
    return t < 0 ? Cesium.Color.lerp(MID, SLOW, -t, new Cesium.Color()) : Cesium.Color.lerp(MID, FAST, t, new Cesium.Color());
  }
  async function buildTomo(depth) {
    if (!tomoData) {
      loading("Loading tomography…");
      try { tomoData = await fetch("data/tomo/tx2011.json").then((r) => r.json()); } finally { loading(""); }
    }
    const sl = tomoData.slices.find((x) => x.depth === depth);
    if (!sl) return;
    if (tomoPrim) { scene.primitives.remove(tomoPrim); tomoPrim = null; }
    const lat = tomoData.lat, lon = tomoData.lon, h = -depth * 1000, inst = [];
    tomoCells = []; tomoAttrs = null;
    const dLat = Math.abs(lat[1] - lat[0]), dLon = Math.abs(lon[1] - lon[0]);
    for (let i = 0; i < lat.length; i++) {
      for (let j = 0; j < lon.length; j++) {
        const v = sl.dvs[i][j];
        const w = Math.max(-179.999, lon[j] - dLon / 2), e = Math.min(179.999, lon[j] + dLon / 2);
        const sN = Math.max(-89.999, lat[i] - dLat / 2), n = Math.min(89.999, lat[i] + dLat / 2);
        inst.push(new Cesium.GeometryInstance({
          id: tomoCells.length,
          geometry: new Cesium.RectangleGeometry({ rectangle: Cesium.Rectangle.fromDegrees(w, sN, e, n), height: h,
            granularity: Cesium.Math.toRadians(1), vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(v == null ? MID : tomoColor(v, sl.limit)),
                        show: new Cesium.ShowGeometryInstanceAttribute(true) },
        }));
        tomoCells.push([lon[j], lat[i]]);
      }
    }
    tomoPrim = scene.primitives.add(new Cesium.Primitive({ geometryInstances: inst, asynchronous: true, cull: false,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false }) }));
    tomoBuiltFor = depth;
    tomoPrim.show = S.interior === "tomo" && interiorDS.show;
    maskTomo();
  }
  function maskTomo() {
    if (!tomoPrim) return;
    if (!tomoPrim.ready) {  // per-instance attributes exist only once the async build finishes
      const prim = tomoPrim, off = scene.postRender.addEventListener(() => { if (prim.ready || prim.isDestroyed()) { off(); if (prim === tomoPrim) maskTomo(); } });
      return;
    }
    if (!tomoAttrs) tomoAttrs = tomoCells.map((_, k) => tomoPrim.getGeometryInstanceAttributes(k));
    const all = S.cut <= 0;
    tomoCells.forEach(([lo, la], k) => { tomoAttrs[k].show = Cesium.ShowGeometryInstanceAttribute.toValue(all || inWedge(lo, la), tomoAttrs[k].show); });
  }
  function applyInteriorMode() {
    const tomo = S.interior === "tomo";
    $("int-layers").hidden = tomo; $("int-tomo").hidden = !tomo;
    document.querySelectorAll("[data-interior]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.interior === S.interior));
    $("tomo-depths").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", +x.dataset.depth === S.tomoDepth));
    const t = TOMO.find((x) => x.depth === S.tomoDepth) || TOMO[TOMO.length - 1];
    if (!t) return;
    const rr = (6371 - t.depth) * 1000;
    shells.forEach(({ L, a, b }) => { a.show = b.show = !tomo || S.cut > 0 || L.r * 1000 <= rr + 1; });
    if (tomo) {
      $("tomo-lo").textContent = `-${t.limit}% slower`; $("tomo-hi").textContent = `+${t.limit}% faster`;
      if (tomoBuiltFor !== t.depth) buildTomo(t.depth); else maskTomo();
    }
    if (tomoPrim) tomoPrim.show = tomo && interiorDS.show;
  }
  function renderInterior() {
    const e = S.entry, ab = S.data && S.data.abundance;
    const cls = e && CLASS_TEXT[e.class];
    let share = null;
    if (ab) share = { crust: ab.crust || 0, upper: ab.mantle, lower: ab.mantle, outer: ab.core, inner: ab.core };
    const home = share ? Object.keys(share).filter((k) => share[k] >= 0.2) : cls ? cls[2] : [];
    const pct = (v) => (v >= 0.995 ? ">99%" : v < 0.001 ? "<0.1%" : v < 0.01 ? `${(100 * v).toFixed(1)}%` : `${Math.round(100 * v)}%`);
    const pctOf = { crust: ab && ab.crust != null ? pct(ab.crust) : "", upper: ab ? pct(ab.mantle) : "", outer: ab ? pct(ab.core) : "" };
    $("int-legend").innerHTML = LAYERS.map((L) => {
      const p = L.key === "crust" ? pctOf.crust : L.key === "upper" ? pctOf.upper : L.key === "outer" ? pctOf.outer : "";
      const span = L.key === "upper" ? "mantle" : L.key === "outer" ? "core" : "";
      return `<li class="${home.includes(L.key) ? "home" : home.length ? "faint" : ""}"><span class="sw" style="background:${L.color}"></span><span>${L.name}<br><span class="n">${L.depth}</span></span><span class="pct">${p}${span && p ? `<br><span class="n">whole ${span}</span>` : ""}</span></li>`;
    }).join("");
    let note;
    if (ab) {
      const r = ab.refs;
      note = `Share of Earth's total ${e.name} by layer, estimated from reservoir concentrations (crust: ${r.crust || "not tabulated"}; mantle, using primitive mantle: ${r.mantle}; core: ${r.core}) and layer masses. ` +
        `Continental crust only. Layer boundaries are PREM averages (Dziewonski and Anderson, 1981); colors and uniform shells are illustrative.`;
    } else {
      note = "Layer boundaries are real averages from PREM (Dziewonski and Anderson, 1981). Colors and uniform shells are illustrative." +
        (cls ? ` No reservoir estimate is tabulated for ${e.name}, so the highlight follows its geochemical class and is inferred, not measured.` : "");
    }
    $("int-note").textContent = note;
    shells.forEach(({ L, a, b }) => {
      const base = Cesium.Color.fromCssColorString(L.color);
      const c = home.length && !home.includes(L.key) ? Cesium.Color.lerp(base, Cesium.Color.fromCssColorString("#2a3640"), 0.55, new Cesium.Color()) : base;
      a.ellipsoid.material = c; b.ellipsoid.material = c;
    });
  }

  // ---------------------------------------------------------------- element selection
  const REASON = (e) => {
    if (["H", "O"].includes(e.sym)) return `${e.name} is everywhere in water, air and rock, so neither USGS nor BGS maps deposits or reports mine production for it.`;
    if (e.sym === "Ar") return "Argon is recovered from air rather than mined, so these sources have no deposits or production by country.";
    if (e.z >= 93 || ["Tc", "Pm"].includes(e.sym)) return `${e.name} is synthetic or too short-lived to mine. It is made in reactors or accelerators, so there is nothing to map.`;
    if (["Po", "At", "Rn", "Fr", "Ac", "Pa"].includes(e.sym)) return `${e.name} occurs in nature only as a trace product of uranium and thorium decay, so there are no deposits to map.`;
    return `The public sources used here have no deposit or production records for ${e.name}.`;
  };
  let loadToken = 0;
  async function selectElement(sym) {
    const e = BY_SYM[sym];
    if (!e) return;
    const my = ++loadToken;
    S.entry = e;
    history.replaceState(null, "", "#" + sym + (location.hash.includes("@") ? location.hash.slice(location.hash.indexOf("@")) : ""));
    pt.querySelectorAll(".pt").forEach((b) => b.setAttribute("aria-selected", b.dataset.sym === sym));
    $("el-z").textContent = e.z; $("el-sym").textContent = e.sym; $("el-name").textContent = e.name;
    $("el-title").textContent = e.name; document.title = `${e.name}: Earth Element Explorer`;
    clearSel();
    let data = null;
    if (e.file) {
      loading(`Loading ${e.name}${e.sites > 20000 ? ` (${fmt(e.sites)} sites)` : ""}…`);
      try { data = await fetch("data/" + e.file).then((r) => r.json()); }
      catch (err) { loading(""); $("el-count").textContent = `Couldn't load ${e.file}: ${err.message}`; return; }
      if (my !== loadToken) return;
    }
    if (data && data.sites && data.dict) {
      const d = data.sites;
      for (const k of Object.keys(data.dict)) { const t = data.dict[k]; d[k] = d[k].map((i) => t[i]); }
      delete data.dict;
    }
    if (data && data.sites) data.sites.srcCat = data.sites.id.map(srcOfId);
    S.data = data;
    $("el-crit").hidden = !e.critical;
    $("el-crit").textContent = "On the 2025 U.S. critical minerals list";
    $("q").value = ""; $("q-results").innerHTML = "";
    const cls = CLASS_TEXT[e.class];
    $("el-class").innerHTML = cls ? `<strong>${cls[0]}.</strong> ${cls[1]}` : "";
    const nSites = data && data.sites ? data.sites.id.length : 0;
    const nProd = data && data.production ? Object.values(data.production.countries).filter((c) => c.value > 0).length : 0;
    $("el-count").textContent = [nSites ? `${fmt(nSites)} mapped sites` : "No mapped sites", nProd ? `produced in ${nProd} countries` : null].filter(Boolean).join(", ");
    const notes = [];
    if (!data) notes.push(REASON(e));
    else {
      if (data.stats && data.stats.groupListed) {
        const grp = ["Pt", "Pd", "Rh", "Ru", "Ir", "Os"].includes(sym) ? "platinum-group elements" : "rare earth elements";
        notes.push(`${fmt(data.stats.groupListed)} of these sites are recorded only as ${grp} as a group, not ${e.name} specifically.`);
      }
      if (!nSites) notes.push(`Neither deposit database lists ${e.name} as a commodity at any site.`);
      if (data.production && /group/.test(data.production.label)) notes.push("Production is reported for rare earths as a group, so the country map is the same for every lanthanide.");
    }
    if (data && data.hosts) notes.push(hostNote());
    $("el-empty").innerHTML = notes.map(esc).join("<br>");
    $("el-empty").hidden = !notes.length;
    $("sec-sites").hidden = !nSites; $("ly-sites").hidden = !nSites;
    stopPlay(); S.year = null; S.hist = null; $("year").value = 2025; $("year-label").textContent = "Latest";
    buildSites(); renderLegend(); updateMode(); buildProd(); buildHosts(); buildTrade(); renderInterior(); applyInteriorMode();
    loading("");
  }

  // ---------------------------------------------------------------- selection + tooltip
  let selected = null;
  function clearSel() {
    if (selected && S.data && S.data.sites) {
      selected.pixelSize = styleOf(selected.id.i).size; selected.outlineColor = outline; selected.outlineWidth = 1;
    }
    selected = null; $("site").hidden = true;
  }
  const OPS_LABEL = OP_STYLE.map((s) => s.label);
  function showSite(p) {
    clearSel(); selected = p;
    const d = S.data.sites, i = p.id.i, e = S.entry;
    p.pixelSize = styleOf(i).size + 7; p.outlineColor = Cesium.Color.WHITE; p.outlineWidth = 2;
    const sid = String(d.id[i]), isRee = sid.startsWith("ree:");
    const role = d.grp[i] ? "listed as a group (REE or PGE)" : d.primary[i] ? "the primary commodity" : "a secondary commodity";
    const rows = [
      ["Status", DEV_STYLE[d.dev[i]].label], ["Deposit type", d.dep[i]], ["Mining method", OPS_LABEL[d.op[i]]],
      ["Production size", { L: "Large", M: "Medium", S: "Small", Y: "Produced (size unknown)", N: "None", U: "Unknown" }[d.size[i]]],
      [`${e.name} is`, role], [isRee ? "Resource" : "Also", d.with[i]], ["Production years", d.yrs[i]],
      ["Mine-level output", d.prod[i] ? `${d.prod[i]}, ${e.name} content` : ""],
      ["Elevation", `${fmt(d.z[i])} m (ETOPO 2022)`], ["Coordinates", `${d.lat[i].toFixed(4)}, ${d.lon[i].toFixed(4)}`],
    ].filter((r) => r[1]);
    const where = [d.state[i], d.country[i]].filter(Boolean).join(", ");
    const link = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
    const primary = isRee ? `USGS REE database record ${sid.slice(4)} (${link(SRC.ree.record + sid.slice(4), "open at USGS")})`
      : sid.startsWith("ga:") ? `Geoscience Australia record ${sid.slice(3)} (${link(SRC.ga.record + sid.slice(3), "open at GA")})`
      : sid.startsWith("mincan:") ? `MinCan row ${sid.slice(7)} (${link(SRC.mincan.url, "dataset")})`
      : sid.startsWith("minedb:") ? `Global mine production database, facility ${sid.slice(7)} (${link(SRC.minedb.url, "dataset")})`
      : sid.startsWith("egdi:") ? `EGDI mineral occurrence ${sid.slice(5)} (${link(SRC.egdi.url, "EGDI")})`
      : `USGS MRDS record ${sid} (${link(SRC.mrds.record + sid, "open at USGS")}), file dated ${SRC.mrds.date}`;
    const also = [[2, "USGS REE database"], [4, "Geoscience Australia"], [8, "MinCan"], [16, "global mine production database"], [32, "EGDI"], [1, "USGS MRDS"]]
      .filter(([bit, name]) => d.src[i] & bit && !primary.includes(name.replace("global m", "Global m"))).map(([, n]) => n);
    const src = primary + "." + (also.length ? ` Also in ${also.join(", ")}.` : "");
    $("site").innerHTML = `<h3>${esc(d.name[i] || "Unnamed site")}</h3><p class="where">${esc(where)}</p>` +
      `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl><p class="src">Source: ${src}</p>` +
      `<button type="button" id="close-site">Clear selection</button>`;
    $("site").hidden = false; $("close-site").onclick = clearSel;
    $("panel").classList.remove("collapsed");
    $("site").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function showHost(i) {
    clearSel();
    const H = S.data.hosts, e = S.entry, h = BY_SYM[H.host[i]];
    const sid = String(H.id[i]);
    $("site").innerHTML = `<h3>${esc(H.name[i] || "Unnamed mine")}</h3><p class="where">${esc(H.country[i])}</p>` +
      `<dl><dt>Mines</dt><dd>${esc(h.name)} (producer or past producer)</dd><dt>Link to ${esc(e.name)}</dt><dd>Likely byproduct source, inferred from the host ore</dd>` +
      `<dt>Coordinates</dt><dd>${H.lat[i].toFixed(4)}, ${H.lon[i].toFixed(4)}</dd></dl>` +
      `<p class="src">Not confirmed ${esc(e.name)} output: whether a given mine or smelter recovers ${esc(e.name)} is rarely public. Host-ore relationship per USGS MCS 2026. Site record: ${esc(sid)}.</p>` +
      `<button type="button" id="close-site">Clear selection</button>`;
    $("site").hidden = false; $("close-site").onclick = clearSel;
    $("panel").classList.remove("collapsed");
  }
  function showCountry(iso) {
    clearSel();
    const P = S.data.production, e = P.countries[iso] || { name: (CTRY.countries[iso] || {}).name || iso }, unit = P.unit.trim();
    const R = P.reserves, rv = R && R.by[iso];
    const rows = [
      ["Production", e.value != null ? `${fmt(e.value)} ${unit}` : null], ["Basis", e.basis],
      ["USGS 2025 (est.)", e.usgs2025 != null ? `${fmt(e.usgs2025)} ${unit}` : e.usgsNote],
      ["USGS 2024", e.usgs2024 != null ? `${fmt(e.usgs2024)} ${unit}` : null],
      ["BGS 2024", e.bgs2024 != null ? `${fmt(e.bgs2024)} ${P.bgs ? P.bgs.unit : ""}` : null],
      ["Share of world", P.world && e.value ? `${fmt((100 * e.value) / P.world, 1)}%` : null],
      ["Reserves", rv != null ? (typeof rv === "number" ? `${fmt(rv)} ${R.unit}${R.world ? ` (${fmt((100 * rv) / R.world, 1)}% of world)` : ""}` : rv) : null],
    ].filter((r) => r[1]);
    let check = "";
    if (e.diffPct != null) check = Math.abs(e.diffPct) <= 10
      ? `USGS and BGS agree within ${Math.abs(e.diffPct)}% for 2024.`
      : `USGS and BGS differ by ${e.diffPct > 0 ? "+" : ""}${e.diffPct}% for 2024. Large gaps usually come from different bases (ore vs. contained metal, oxide vs. element) rather than error.`;
    $("site").innerHTML = `<h3>${esc(e.name)}</h3><p class="where">${esc(cap(P.label))}${R ? "; reserves: USGS MCS 2026" : ""}</p>` +
      `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
      (check ? `<p class="src">${esc(check)}</p>` : "") +
      `<p class="src">Sources: ${P.usgs ? `USGS MCS 2026 (${esc(P.usgs.commodity)}: ${esc(P.usgs.series)})` : ""}${P.usgs && P.bgs ? "; " : ""}${P.bgs ? `BGS World Mineral Statistics (${esc(P.bgs.commodity)})` : ""}.</p>` +
      `<button type="button" id="close-site">Clear selection</button>`;
    $("site").hidden = false; $("close-site").onclick = clearSel;
    $("panel").classList.remove("collapsed");
  }
  function describe(hit) {
    if (!hit || !hit.id) return null;
    const id = hit.id;
    if (id.kind === "site" && S.data && S.data.sites) {
      const d = S.data.sites, i = id.i;
      return `<strong>${esc(d.name[i] || "Unnamed site")}</strong>${esc(DEV_STYLE[d.dev[i]].label)}${d.dep[i] ? ", " + esc(d.dep[i]) : ""}<br>${esc(d.country[i])}`;
    }
    if (id.kind === "bin") return `<strong>${fmt(id.n)} sites</strong>in this 2° cell. Click to zoom in.`;
    if (id.kind === "host" && S.data && S.data.hosts) {
      const H = S.data.hosts, i = id.i;
      return `<strong>${esc(H.name[i] || "Unnamed mine")}</strong>${esc(BY_SYM[H.host[i]].name)} mine, ${esc(H.country[i])}<br><span class="n">Likely ${esc(S.entry.name)} source (inferred)</span>`;
    }
    if (id instanceof Cesium.Entity && id.iso && S.data && S.data.production) {
      const M = metricRows(S.data.production), row = M.rows.find(([iso]) => iso === id.iso);
      if (!row) return null;
      const e = S.data.production.countries[id.iso] || {};
      return `<strong>${esc(row[1].name)}</strong>${fmt(row[1].value)} ${esc(M.unit)}${S.metric === "res" ? " reserves" : ""}<br><span class="n">${esc(S.metric === "res" ? "USGS MCS 2026" : e.basis)}</span>`;
    }
    if (id instanceof Cesium.Entity && id.flow) {
      const f = id.flow, T = TRADE.elements[S.entry.sym];
      return `<strong>${esc(f.fromName)} → ${esc(f.toName)}</strong>$${fmt(f.usd)}${f.kg ? `, ${fmt(f.kg / 1000)} t` : ""}<br><span class="n">${esc(T.label)}, UN Comtrade ${T.year}</span>`;
    }
    if (id instanceof Cesium.Entity && id.plate) return `<strong>Plate boundary</strong><span class="n">PB2002 (Bird 2003)</span>`;
    if (id && id.tomoCell) {
      return `<strong>Seismic tomography, ${fmt(S.tomoDepth)} km</strong>TX2011 shear-wave speed vs. average<br><span class="n">Measured model, smoothed</span>`;
    }
    if (id instanceof Cesium.Entity && id.layer) {
      const L = LAYERS.find((x) => x.key === id.layer);
      return `<strong>${L.name}</strong>${L.depth}<br><span class="n">Boundary from PREM; color illustrative</span>`;
    }
    return null;
  }
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  let lastMove = 0;
  if (!coarse) handler.setInputAction((m) => {
    const now = performance.now();
    if (now - lastMove < 70) return;
    lastMove = now;
    const html = describe(scene.pick(m.endPosition));
    const tip = $("tip");
    if (!html) { tip.hidden = true; scene.canvas.style.cursor = ""; return; }
    tip.innerHTML = html; tip.hidden = false; scene.canvas.style.cursor = "pointer";
    const x = Math.min(m.endPosition.x + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(m.endPosition.y + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((c) => {
    const hit = scene.pick(c.position), id = hit && hit.id;
    $("tip").hidden = true;
    if (id && id.kind === "site") return showSite(hit.primitive);
    if (id && id.kind === "host") return showHost(id.i);
    if (id && id.kind === "bin") return camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(id.lon, id.lat, 2.2e6), duration: 1.2 });
    if (id instanceof Cesium.Entity && id.iso) return showCountry(id.iso);
    clearSel();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------------------------------------------------------------- controls
  document.querySelectorAll("[data-layer]").forEach((cb) => cb.addEventListener("change", () => {
    const k = cb.dataset.layer;
    S.show[k] = cb.checked;
    cb.closest(".layer").classList.toggle("off", !cb.checked);
    if (k === "sites") restyle();
    if (k === "prod") applyProdVisibility();
    if (k === "surface") applySurface();
    if (k === "hosts") styleHosts();
    if (k === "trade") applyTrade();
    if (k === "plates") applyPlates();
  }));
  let restyleTimer = null;
  document.querySelectorAll("[data-opacity]").forEach((r) => r.addEventListener("input", () => {
    const k = r.dataset.opacity;
    S.op[k] = r.value / 100;
    if (k === "sites") { clearTimeout(restyleTimer); restyleTimer = setTimeout(restyle, 60); }
    if (k === "prod") setProdOpacity();
    if (k === "surface") applySurface();
    if (k === "hosts") styleHosts();
    if (k === "trade") applyTrade();
    if (k === "plates") applyPlates();
  }));
  let cutTimer = null;
  $("cut").addEventListener("input", (ev) => {
    S.cut = +ev.target.value;
    const c = camera.positionCartographic;
    S.lon0 = c.longitude * R2D - S.cut / 2; S.north = c.latitude >= 0;
    clearTimeout(cutTimer); cutTimer = setTimeout(applyCut, 40);
  });
  document.querySelectorAll("[data-colorby]").forEach((b) => b.addEventListener("click", () => {
    S.colorBy = b.dataset.colorby;
    document.querySelectorAll("[data-colorby]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderLegend(); restyle();
  }));
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    updateMode();
  }));
  document.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => { if (!b.disabled) { stopPlay(); setMetric(b.dataset.metric); } }));
  let yearTimer = null;
  $("year").addEventListener("input", () => { stopPlay(); clearTimeout(yearTimer); const y = +$("year").value; $("year-label").textContent = y >= 2025 ? "Latest" : y; yearTimer = setTimeout(() => setYear(y), 150); });
  $("play").addEventListener("click", async () => {
    if (playTimer) return stopPlay();
    const e = S.entry; if (!e || !e.hist) return;
    let y = S.year && S.year < 2024 ? S.year : Math.max(1970, e.hist.first);
    $("play").textContent = "❚❚"; $("play").setAttribute("aria-label", "Pause");
    await setYear(y); $("year").value = y;
    playTimer = setInterval(async () => {
      y += 1;
      if (y > 2024) { stopPlay(); return; }
      $("year").value = y; await setYear(y);
    }, 700);
  });

  document.querySelectorAll("[data-interior]").forEach((b) => b.addEventListener("click", () => {
    S.interior = b.dataset.interior;
    const cut = $("cut"), surf = document.querySelector('[data-opacity="surface"]');
    if (S.interior === "tomo") {
      // With no wedge open, fade the surface so the slice shows through; with a wedge, the slice fills its floor.
      if (S.cut <= 0 && S.op.surface > 0.4) { surf.value = 25; surf.dispatchEvent(new Event("input")); }
      $("cut-note").textContent = "Open the wedge to see the slice at the chosen depth, or lower Surface imagery to see the whole slice through the planet.";
    } else {
      $("cut-note").textContent = "Slide to open a wedge facing you. Lowering surface opacity shows the interior through the planet.";
    }
    applyInteriorMode();
  }));

  // search within the current element's sites
  $("q").addEventListener("input", () => {
    const q = $("q").value.trim().toLowerCase(), out = $("q-results");
    out.innerHTML = "";
    const d = S.data && S.data.sites;
    if (!d || q.length < 2) return;
    const hits = [];
    for (let i = 0; i < d.id.length && hits.length < 8; i++) {
      if ((d.name[i] || "").toLowerCase().includes(q) || (d.dep[i] || "").toLowerCase().includes(q)) hits.push(i);
    }
    out.innerHTML = hits.length ? "" : `<li class="note">No ${esc(S.entry.name)} sites match.</li>`;
    hits.forEach((i) => {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button"><span>${esc(d.name[i] || "Unnamed")}</span><span class="n">${esc(d.state[i] || d.country[i])}</span></button>`;
      li.firstChild.onclick = () => {
        camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(d.lon[i], d.lat[i], 60000), duration: 1.6,
          complete: () => showSite(byIndex[i]) });
      };
      out.appendChild(li);
    });
  });

  // shareable links: #Sym@lon,lat,height,heading,pitch
  let hashTimer = null;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      if (!S.entry) return;
      const c = camera.positionCartographic;
      const v = [c.longitude * R2D, c.latitude * R2D].map((x) => x.toFixed(3)).concat([Math.round(c.height), Math.round(camera.heading * R2D) % 360, Math.round(camera.pitch * R2D)]);
      history.replaceState(null, "", `#${S.entry.sym}@${v.join(",")}`);
    }, 400);
  }
  camera.moveEnd.addEventListener(writeHash);

  $("collapse").addEventListener("click", (e) => {
    const c = $("panel").classList.toggle("collapsed");
    e.currentTarget.textContent = c ? "Show panel" : "Hide panel";
    e.currentTarget.setAttribute("aria-expanded", !c);
  });
  camera.changed.addEventListener(() => { syncDepth(); updateMode(); });

  // #Sym@lon,lat,height,heading,pitch — read at startup and whenever a link is pasted into an open tab
  // (the app itself writes the hash with replaceState, which doesn't fire hashchange)
  async function applyHash() {
    const [start, view] = decodeURIComponent((location.hash || "").slice(1)).split("@");
    if (view) {
      const v = view.split(",").map(Number);
      if (v.length >= 3 && v.every(Number.isFinite)) camera.setView({ destination: Cesium.Cartesian3.fromDegrees(v[0], v[1], v[2]),
        orientation: { heading: (v[3] || 0) * D2R, pitch: (v.length > 4 ? v[4] : -90) * D2R, roll: 0 } });
    }
    const sym = BY_SYM[start] ? start : S.entry ? null : "Au";
    if (sym && (!S.entry || S.entry.sym !== sym)) await selectElement(sym);
  }
  window.addEventListener("hashchange", applyHash);
  await applyHash();
  window.__explorer = { viewer, points, bins, S, selectElement, showSite, showCountry, applyCut, applySurface };
})();

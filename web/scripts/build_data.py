"""Build every data file the explorer serves.

Inputs (download commands in README):
  mrds.csv                USGS Mineral Resources Data System          https://mrdata.usgs.gov/mrds/
  ree/main.csv etc.       USGS global REE occurrences (OF 02-189)     https://mrdata.usgs.gov/ree/
  mcs2026.csv             USGS Mineral Commodity Summaries 2026 data  https://doi.org/10.5066/P1WKQ63T
  bgs2024.json            BGS World Mineral Statistics, 2024 production (OGC API)
  etopo60.nc              NOAA ETOPO 2022, 60 arc-second surface elevation
  ne110.geojson           Natural Earth 1:110m admin-0 countries
  pubchem.csv             PubChem periodic table (names, blocks)
  ga_occ.json             Geoscience Australia mineral occurrences (erl:MineralOccurrenceView WFS)
  mincan.xlsx             MinCan: past and present producing mines of Canada 1950-2022 (figshare 23740071)
  minedb/data/*           Jasansky et al. 2023 open global mine production database (Zenodo 7369478)
  germ/r10.json r30.json r34.json   GERM reservoir tables: continental crust, primitive mantle, core
  tx2011.nc               TX2011 shear-velocity tomography (Grand 2002), EarthScope EMC

Outputs (app/data):
  elements.json           118 elements: layout, data availability, geochemical class
  el/<Sym>.json           sites (columnar) + production by country for one element
  countries.json          simplified country polygons keyed by ISO3

Usage: python3 scripts/build_data.py <input_dir>
"""
import csv, json, os, re, sys, datetime, math, collections
import numpy as np
import h5py

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(os.path.join(OUT, "el"), exist_ok=True)
TODAY = datetime.date.today().isoformat()
p = lambda *a: os.path.join(SRC, *a)

LANTH = ["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"]  # Pm has no natural deposits
REE_ALL = LANTH + ["Y", "Sc"]
PGE = ["Pt", "Pd", "Rh", "Ru", "Ir", "Os"]

# ---- element -> MRDS commodity names ------------------------------------
MRDS = {
    "Au": ["Gold"], "Ag": ["Silver"], "Cu": ["Copper", "Copper Oxide", "Copper Sulfide"], "Pb": ["Lead"],
    "Zn": ["Zinc"], "Fe": ["Iron", "Pig Iron"], "U": ["Uranium"], "Mn": ["Manganese", "Ferromanganese"],
    "W": ["Tungsten"], "Cr": ["Chromium", "Ferrochrome"], "V": ["Vanadium"], "Mo": ["Molybdenum"],
    "Ba": ["Barium-Barite"], "F": ["Fluorine-Fluorite"], "Hg": ["Mercury"], "Sb": ["Antimony"],
    "Al": ["Aluminum"], "P": ["Phosphorus-Phosphates"], "Sn": ["Tin", "Tantalum from Tin Slag"],
    "Ni": ["Nickel", "Nickel Laterite"], "Pt": ["Platinum"], "Pd": ["Palladium"], "Rh": ["Rhodium"],
    "Ru": ["Ruthenium"], "Ir": ["Iridium"], "Os": ["Osmium"], "Si": ["Silica"], "As": ["Arsenic"],
    "Ti": ["Titanium", "Titanium-Heavy Minerals", "Titanium-Ilmenite", "Titanium-Rutile"],
    "Ca": ["Calcium"], "Be": ["Beryllium"], "S": ["Sulfur", "Sulfur-Pyrite"], "Co": ["Cobalt"],
    "Th": ["Thorium"], "Bi": ["Bismuth"], "Mg": ["Magnesite", "Magnesium Compounds"], "Zr": ["Zirconium"],
    "C": ["Graphite", "Diamond"], "Nb": ["Niobium (Columbium)"], "B": ["Boron-Borates"],
    "Ta": ["Tantalum", "Tantalum from Tin Slag"], "Li": ["Lithium"],
    "Na": ["Sodium", "Halite", "Salt", "Sodium Sulfate", "Sodium Carbonate", "Soda Ash"],
    "Cl": ["Chlorine", "Halite", "Salt"], "K": ["Potassium", "Potash"], "Cd": ["Cadmium"],
    "Te": ["Tellurium"], "Sr": ["Strontium"], "Br": ["Bromine"], "Se": ["Selenium"],
    "N": ["Nitrogen-Nitrates"], "Re": ["Rhenium"], "Tl": ["Thallium"], "Ge": ["Germanium"],
    "Ga": ["Gallium"], "In": ["Indium"], "I": ["Iodine"], "He": ["Helium"], "Ra": ["Radium"],
    "Cs": ["Cesium"], "Rb": ["Rubidium"], "Hf": ["Hafnium"], "Ce": ["Cerium"], "Y": ["Yttrium"],
    "Sc": ["Scandium"],
}
GROUP_TAGS = {"REE": REE_ALL, "PGE": PGE}  # group listings count toward each member, flagged

# ---- element -> USGS MCS world production series ------------------------
# (commodity, [Statistics_detail in order of preference], label)
MCS = {
    "Au": ("Gold", ["Mine production"], "gold, mine production"),
    "Ag": ("Silver", ["Mine production"], "silver, mine production"),
    "Cu": ("Copper", ["Mine production"], "copper, mine production (Cu content)"),
    "Pb": ("Lead", ["Mine production"], "lead, mine production"),
    "Zn": ("Zinc", ["Mine production"], "zinc, mine production"),
    "Fe": ("Iron Ore", ["Mine production: Iron content"], "iron ore, iron content"),
    "Al": ("Bauxite", ["Bauxite, mine production"], "bauxite ore (Al source), dry tons"),
    "Mn": ("Manganese", ["Mine production"], "manganese, mine production"),
    "W": ("Tungsten", ["Mine production"], "tungsten, mine production"),
    "Cr": ("Chromium", ["Mine production"], "chromite ore, mine production"),
    "V": ("Vanadium", ["Mine production"], "vanadium, mine production"),
    "Mo": ("Molybdenum", ["Mine production"], "molybdenum, mine production"),
    "Ba": ("Barite", ["Mine production"], "barite, mine production"),
    "F": ("Fluorspar", ["Mine production"], "fluorspar, mine production"),
    "Hg": ("Mercury", ["Mine production"], "mercury, mine production"),
    "Sb": ("Antimony", ["Mine production"], "antimony, mine production"),
    "P": ("Phosphate Rock", ["Mine production"], "phosphate rock, mine production"),
    "Sn": ("Tin", ["Mine production"], "tin, mine production"),
    "Ni": ("Nickel", ["Mine production"], "nickel, mine production"),
    "Pt": ("Platinum", ["Mine production: Platinum"], "platinum, mine production"),
    "Pd": ("Palladium", ["Mine production: Palladium"], "palladium, mine production"),
    "Si": ("Silicon", ["Silicon metal", "Ferrosilicon"], "silicon metal"),
    "As": ("Arsenic", ["Production (arsenic trioxide, gross weight)"], "arsenic trioxide, gross weight"),
    "Ti": ("Titanium Mineral Concentrates", ["Mine production: Ilmenite"], "ilmenite concentrate"),
    "Be": ("Beryllium", ["Mine production"], "beryllium, mine production"),
    "S": ("Sulfur", ["Production, all forms"], "sulfur, all forms"),
    "Co": ("Cobalt", ["Mine production"], "cobalt, mine production"),
    "Bi": ("Bismuth", ["Refinery production"], "bismuth, refinery production"),
    "Mg": ("Magnesium Compounds", ["Mine production"], "magnesite, mine production"),
    "Zr": ("Zirconium", ["Zirconium mineral concentrates, mine production (thousand metric tons, gross weight)"], "zircon concentrates, gross weight"),
    "Nb": ("Niobium (Columbium)", ["Mine production"], "niobium, mine production"),
    "B": ("Boron", ["Production\u2014All forms"], "boron minerals, all forms"),
    "Ta": ("Tantalum", ["Mine production"], "tantalum, mine production"),
    "Li": ("Lithium", ["Mine production"], "lithium content, mine production"),
    "Na": ("Salt", ["Mine production"], "salt (NaCl)"),
    "Cl": ("Salt", ["Mine production"], "salt (NaCl)"),
    "K": ("Potash", ["Mine production"], "potash, K2O equivalent"),
    "Cd": ("Cadmium", ["Refinery production"], "cadmium, refinery production"),
    "Te": ("Tellurium", ["Refinery production"], "tellurium, refinery production"),
    "Sr": ("Strontium", ["Mine production"], "celestite, mine production"),
    "Br": ("Bromine", ["Production"], "bromine"),
    "Se": ("Selenium", ["Refinery production"], "selenium, refinery production"),
    "N": ("Nitrogen (Fixed)Ammonia", ["Plant production"], "ammonia (N content), plant production"),
    "Re": ("Rhenium", ["Mine production"], "rhenium, mine production"),
    "Ga": ("Gallium", ["Primary production"], "gallium, primary production"),
    "In": ("Indium", ["Refinery production"], "indium, refinery production"),
    "I": ("Iodine", ["Mine production"], "iodine"),
    "He": ("Helium", ["Helium Production"], "helium"),
    "C": ("Graphite (Natural)", ["Mine production"], "natural graphite, mine production"),
    "Ne": ("Neon", ["Rare gases production, (million liters)"], "neon"),
    "Kr": ("Krypton", ["Rare gases production, (million liters)"], "krypton"),
    "Xe": ("Xenon", ["Rare gases production, (million liters)"], "xenon"),
    "Y": ("Yttrium", ["mine production of Y2O3 equivalent contained in rare-earth mineral concentrates"], "yttrium oxide equivalent"),
    "Sc": ("Scandium", ["global production"], "scandium"),
}
for s in LANTH:
    MCS[s] = ("Rare Earths", ["Mine production"], "rare earths as a group (REO equivalent)")

# ---- element -> BGS series (commodity_trans, sub_commodity or None) ------
BGS = {
    "Au": ("gold, mine", None), "Ag": ("silver, mine", None), "Cu": ("copper, mine", None),
    "Pb": ("lead, mine", None), "Zn": ("zinc, mine", None), "Fe": ("iron ore", None),
    "Al": ("bauxite", None), "Mn": ("manganese ore", None), "W": ("tungsten, mine", None),
    "Cr": ("chromium ores and concentrates", None), "V": ("vanadium, mine", None),
    "Mo": ("molybdenum, mine", None), "Ba": ("barytes", None), "F": ("fluorspar", None),
    "Hg": ("mercury", None), "Sb": ("antimony, mine", None), "P": ("phosphate rock", None),
    "Sn": ("tin, mine", None), "Ni": ("nickel, mine", None), "Co": ("cobalt, mine", None),
    "Bi": ("bismuth, mine", None), "Mg": ("magnesite", None), "Zr": ("zirconium minerals", None),
    "B": ("borates", None), "Cd": ("cadmium", None), "Te": ("tellurium, refined", None),
    "Sr": ("strontium minerals", None), "Br": ("bromine", None), "Se": ("selenium, refined", None),
    "Re": ("rhenium", None), "Ga": ("gallium, primary", None), "In": ("indium, refinery", None),
    "I": ("iodine", None), "He": ("helium", "Helium"), "C": ("graphite", None),
    "U": ("uranium", None), "Ge": ("germanium metal", None), "Be": ("beryl", None),
    "Na": ("salt", None), "Cl": ("salt", None), "K": ("potash", None),
    "Pt": ("platinum group metals, mine", "Platinum"), "Pd": ("platinum group metals, mine", "Palladium"),
    "Rh": ("platinum group metals, mine", "Rhodium"), "Ru": ("platinum group metals, mine", "Ruthenium"),
    "Ir": ("platinum group metals, mine", "Iridium"), "Ti": ("titanium minerals", "Ilmenite"),
}
for s in LANTH:
    BGS[s] = ("rare earth oxides", None)

# ---- Goldschmidt geochemical classes (Goldschmidt 1937, as used in standard texts) ----
GOLD = {}
for s in "Li Be B O F Na Mg Al Si Cl K Ca Sc Ti V Cr Mn Br Rb Sr Y Zr Nb I Cs Ba Hf Ta Th U Ra Pa Ac".split() + LANTH + ["Pm"]:
    GOLD[s] = "lithophile"
for s in "Fe Co Ni Ru Rh Pd Re Os Ir Pt Au Mo Ge Sn C P W".split():
    GOLD[s] = "siderophile"
for s in "Cu Ag Zn Cd Hg Ga In Tl Pb As Sb Bi S Se Te Po".split():
    GOLD[s] = "chalcophile"
for s in "H N He Ne Ar Kr Xe Rn".split():
    GOLD[s] = "atmophile"

# ---- helpers -------------------------------------------------------------
def to_float(v):
    v = (v or "").replace(",", "").strip()
    try:
        return float(v)
    except ValueError:
        return None

UNIT_T = {  # multiplier to metric tons
    "metric tons": 1, "thousand metric tons": 1e3, "million metric tons": 1e6, "kilograms": 1e-3,
    "thousand metric dry tons": 1e3, "tonnes (metric)": 1, "tonnes (metal content)": 1,
    "kilograms (metal content)": 1e-3, "tonnes (al2o3 content)": 1, "tonnes (k2o content)": 1,
}
def tons(value, unit):
    m = UNIT_T.get((unit or "").strip().lower())
    return None if value is None or m is None else value * m

# ---- countries -----------------------------------------------------------
ne = json.load(open(p("ne110.geojson")))
countries, iso_name = {}, {}
def rnd(c):
    return [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 2), round(c[1], 2)]
for f in ne["features"]:
    pr = f["properties"]
    iso = pr["ISO_A3"] if pr["ISO_A3"] not in ("-99", None) else pr["ADM0_A3"]
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    countries[iso] = {"name": pr["NAME"], "polys": [rnd(pl) for pl in polys],
                      "lon": pr.get("LABEL_X"), "lat": pr.get("LABEL_Y")}
    iso_name[pr["NAME"].lower()] = iso
json.dump({"source": "Natural Earth 1:110m admin-0 countries (public domain)", "countries": countries},
          open(os.path.join(OUT, "countries.json"), "w"), separators=(",", ":"))

bgs = json.load(open(p("bgs2024.json")))
bgs_iso = {f["properties"]["country_trans"]: f["properties"]["country_iso3_code"] for f in bgs}
bgs_name = {f["properties"]["country_iso3_code"]: f["properties"]["country_trans"] for f in bgs}
bgs_pole = {f["properties"]["country_iso3_code"]: (f["properties"]["pole_of_inaccessibility_longitude"],
            f["properties"]["pole_of_inaccessibility_latitude"]) for f in bgs}
MCS_ISO = {"Burma": "MMR", "Congo (Kinshasa)": "COD", "Czechia": "CZE", "C\u00f4te d\u2019Ivoire": "CIV",
           "Ireland": "IRL", "Korea, North": "PRK", "Korea, Republic of": "KOR", "Trinidad and Tobago": "TTO",
           "United States": "USA"}
def mcs_iso(name):
    return MCS_ISO.get(name) or bgs_iso.get(name) or iso_name.get(name.lower())

MRDS_ISO = {"United States": "USA", "Congo (Kinshasa)": "COD", "Congo (Brazzaville)": "COG",
            "Burma": "MMR", "Korea, North": "PRK", "Korea, South": "KOR", "Russia": "RUS",
            "Tanzania": "TZA", "Ivory Coast": "CIV", "Czech Republic": "CZE", "Bolivia": "BOL",
            "Venezuela": "VEN", "Iran": "IRN", "Laos": "LAO", "Vietnam": "VNM", "Syria": "SYR"}

# ---- production ---------------------------------------------------------
mcs_rows = list(csv.DictReader(open(p("mcs2026.csv"), encoding="cp1252")))
def mcs_series(sym):
    if sym not in MCS:
        return None
    com, details, label = MCS[sym]
    rows = [r for r in mcs_rows if r["Commodity"] == com and r["Section"].startswith("World")
            and r["Statistics"] == "Production"]
    for det in details:
        sel = [r for r in rows if r["Statistics_detail"] == det]
        if sel:
            break
    else:
        return None
    unit = sel[0]["Unit"].strip()
    by = collections.defaultdict(dict)
    world = {}
    for r in sel:
        v = to_float(r["Value"])
        c = r["Country"].strip()
        if c == "World total":
            world[r["Year"]] = v
            continue
        if c == "Other countries":
            continue
        iso = mcs_iso(c)
        if iso:
            by[iso][r["Year"]] = (v, r["Value"].strip(), c)
    for r in rows:
        if r["Country"].strip() == "World total" and r["Statistics_detail"] in (det, det + ": rounded", det + ", rounded"):
            world.setdefault(r["Year"], to_float(r["Value"]))
    return {"unit": unit, "label": label, "by": by, "world": world, "commodity": com, "detail": det}

def bgs_series(sym):
    if sym not in BGS:
        return None
    com, sub = BGS[sym]
    sel = [f["properties"] for f in bgs if f["properties"]["bgs_commodity_trans"] == com
           and (sub is None or f["properties"]["bgs_sub_commodity_trans"] == sub)]
    if not sel:
        return None
    by = collections.defaultdict(float)
    unit = sel[0]["units"]
    for r in sel:
        if r["quantity"] is not None:
            by[r["country_iso3_code"]] += r["quantity"]  # sums sub-commodities when sub is None
    return {"unit": unit, "by": dict(by), "commodity": com + (f" / {sub}" if sub else "")}

def production(sym):
    m, b = mcs_series(sym), bgs_series(sym)
    if not m and not b:
        return None
    rows = {}
    isos = set(m["by"]) if m else set()
    isos |= set(b["by"]) if b else set()
    for iso in isos:
        e = {}
        if m and iso in m["by"]:
            yrs = m["by"][iso]
            e["usgs2025"] = yrs.get("2025", (None,))[0]
            e["usgs2024"] = yrs.get("2024", (None,))[0]
            raw25 = yrs.get("2025", (None, ""))[1]
            if raw25 and e["usgs2025"] is None:
                e["usgsNote"] = {"W": "withheld to avoid disclosing company data", "NA": "not available"}.get(raw25, raw25)
            e["name"] = (yrs.get("2025") or yrs.get("2024"))[2]
        if b and iso in b["by"]:
            e["bgs2024"] = b["by"][iso]
        if "name" not in e:
            e["name"] = countries[iso]["name"] if iso in countries else bgs_name.get(iso, iso)
        # dedupe: one display value per country, USGS 2025 (est.) > USGS 2024 > BGS 2024 (converted)
        if e.get("usgs2025") is not None:
            e["value"], e["basis"] = e["usgs2025"], "USGS MCS 2026, 2025 estimate"
        elif e.get("usgs2024") is not None:
            e["value"], e["basis"] = e["usgs2024"], "USGS MCS 2026, 2024"
        elif e.get("bgs2024") is not None and m:
            t = tons(e["bgs2024"], b["unit"])
            mult = UNIT_T.get(m["unit"].lower())
            if t is not None and mult:
                e["value"], e["basis"] = t / mult, "BGS 2024 (converted)"
        elif e.get("bgs2024") is not None:
            e["value"], e["basis"] = e["bgs2024"], "BGS 2024"
        # cross-check USGS 2024 vs BGS 2024 where both exist
        if m and b and e.get("usgs2024") and e.get("bgs2024"):
            u, g = tons(e["usgs2024"], m["unit"]), tons(e["bgs2024"], b["unit"])
            if u and g:
                e["diffPct"] = round(100 * (g - u) / u)
        if e.get("value") is None or e["value"] <= 0:
            if not e.get("usgsNote"):
                continue
        e["hasShape"] = iso in countries
        if iso in bgs_pole:
            e["pole"] = bgs_pole[iso]
        rows[iso] = e
    unit = m["unit"] if m else b["unit"]
    world = None
    if m:
        world = m["world"].get("2025") or m["world"].get("2024")
    return {
        "unit": unit, "label": m["label"] if m else b["commodity"],
        "world": world, "worldYear": ("2025" if m and m["world"].get("2025") else "2024") if m else None,
        "usgs": {"commodity": m["commodity"], "series": m["detail"], "unit": m["unit"]} if m else None,
        "bgs": {"commodity": b["commodity"], "unit": b["unit"]} if b else None,
        "countries": rows,
    }

# ---- elevation ----------------------------------------------------------
print("loading ETOPO…", flush=True)
et = h5py.File(p("etopo60.nc"))
Z = et["z"][:]  # (10800, 21600) float32, lat ascending from -90
def elev(lon, lat):
    r = min(10799, max(0, int((lat + 90) * 60)))
    c = min(21599, max(0, int((lon + 180) * 60)))
    return int(round(float(Z[r, c])))

# ---- sites --------------------------------------------------------------
DEV = ["Producer", "Past Producer", "Prospect", "Occurrence", "Plant", "Unknown"]
OPS = ["Surface", "Underground", "Surface-Underground", "Placer", "Well/brine", "Offshore", "Processing Plant", "Unknown"]
def op_code(v):
    v = (v or "").strip()
    if v in ("Well", "Brine Operation", "Geothermal"):
        return 4
    return OPS.index(v) if v in OPS else 7

sites = collections.defaultdict(lambda: {k: [] for k in
        ["lon", "lat", "z", "name", "country", "state", "dev", "dep", "size", "with", "primary", "id", "yrs", "op", "src", "grp", "prod"]})
seen = collections.defaultdict(set)
names_of = {}

print("reading MRDS…", flush=True)
name2syms = collections.defaultdict(list)
for sym, names in MRDS.items():
    for n in names:
        name2syms[n].append(sym)
for tag, syms in GROUP_TAGS.items():
    for s in syms:
        name2syms[tag].append(s)

for r in csv.DictReader(open(p("mrds.csv"), encoding="latin-1")):
    parts = [x.strip() for c in (r["commod1"], r["commod2"], r["commod3"]) for x in c.split(",") if x.strip()]
    first = [x.strip() for x in r["commod1"].split(",") if x.strip()]
    hit = {}
    for x in parts:
        for s in name2syms.get(x, []):
            grp = x in GROUP_TAGS
            hit[s] = hit.get(s, True) and grp  # grp only if every match was a group listing
    if not hit:
        continue
    try:
        lat, lon = float(r["latitude"]), float(r["longitude"])
        assert -90 <= lat <= 90 and -180 <= lon <= 180 and not (lat == 0 and lon == 0)
    except Exception:
        continue
    fy, ly = r["yr_fst_prd"].strip(), r["yr_lst_prd"].strip()
    yrs = f"{fy}\u2013{ly}" if fy and ly and fy != ly else (fy or ly)
    z = elev(lon, lat)
    for s, grp in hit.items():
        key = (round(lat, 4), round(lon, 4), r["site_name"].strip().lower())
        if key in seen[s]:
            continue
        seen[s].add(key)
        own = set(MRDS.get(s, [])) | {k for k, v in GROUP_TAGS.items() if s in v}
        others = sorted({x for x in parts if x not in own})
        d = sites[s]
        d["lon"].append(round(lon, 4)); d["lat"].append(round(lat, 4)); d["z"].append(z)
        d["name"].append(r["site_name"].strip()); d["country"].append(r["country"].strip())
        d["state"].append(r["state"].strip())
        d["dev"].append(DEV.index(r["dev_stat"]) if r["dev_stat"] in DEV else 5)
        d["dep"].append(r["dep_type"].strip()); d["size"].append(r["prod_size"].strip())
        d["with"].append(", ".join(others[:6]))
        d["primary"].append(1 if any(x in own for x in first) else 0)
        d["id"].append(r["dep_id"]); d["yrs"].append(yrs); d["op"].append(op_code(r["oper_type"]))
        d["src"].append(1); d["grp"].append(1 if grp else 0); d["prod"].append("")

# ---- REE database, cross-referenced against MRDS -------------------------
print("merging REE database…", flush=True)
REE_TYPES = {"carb": "Carbonatite", "carb-re": "Carbonatite with residual enrichment", "alk-ig": "Alkalic igneous",
             "hyd-feox": "Hydrothermal Fe-oxide", "oth-ig-aff": "Other igneous-affiliated (pegmatites, veins)",
             "ion-ad": "Ion adsorption clay", "met": "Metamorphic", "placer-sh": "Placer, shoreline",
             "placer-al": "Placer, alluvial", "placer-unc": "Placer, uncertain origin", "placer-pal": "Paleoplacer",
             "phos": "Phosphorite", "oth-baux": "Bauxite- or laterite-hosted", "oth-f": "Fluorite deposit",
             "oth-pb": "Lead deposit", "oth-u": "Uranium deposit", "oth-unc": "Uncertain"}
res = collections.defaultdict(list)
for r in csv.DictReader(open(p("ree", "resource.csv"), encoding="latin-1")):
    res[r["rec_id"]].append(r["value"])
def ree_dev(st):
    s = st.lower()
    if "current producer" in s or s.startswith("producer"): return 0
    if "past" in s: return 1
    if "prospect" in s or "potential" in s: return 2
    if "occurrence" in s: return 3
    return 5
ree_stats = {"records": 0, "matched_mrds": 0, "added": 0}
ree_main = list(csv.DictReader(open(p("ree", "main.csv"), encoding="latin-1")))
for s in REE_ALL:
    d = sites[s]
    lat_a = np.array(d["lat"] or [0.0]); lon_a = np.array(d["lon"] or [0.0])
    for r in ree_main:
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except ValueError:
            continue
        if s == "La":
            ree_stats["records"] += 1
        # duplicate if an MRDS site for this element lies within ~5 km
        if d["lat"]:
            dist = np.hypot(lat_a - lat, (lon_a - lon) * math.cos(math.radians(lat)))
            j = int(dist.argmin())
            if dist[j] < 0.045:
                if s == "La":
                    ree_stats["matched_mrds"] += 1
                d["src"][j] |= 2
                continue
        if s == "La":
            ree_stats["added"] += 1
        d["lon"].append(round(lon, 4)); d["lat"].append(round(lat, 4)); d["z"].append(elev(lon, lat))
        d["name"].append(r["depname"].strip()); d["country"].append(r["country"].strip())
        d["state"].append(r["stprov"].strip()); d["dev"].append(ree_dev(r["status"]))
        d["dep"].append(REE_TYPES.get(r["deptype"], r["deptype"]))
        d["size"].append(""); d["with"].append("; ".join(res.get(r["rec_id"], [])[:2]))
        d["primary"].append(1); d["id"].append("ree:" + r["rec_id"]); d["yrs"].append("")
        d["op"].append(3 if r["deptype"].startswith("placer") else 7); d["src"].append(2); d["grp"].append(1); d["prod"].append("")

# ---- name -> element symbols (used by GA, MinCan, MineDB) -----------------
pub = list(csv.DictReader(open(p("pubchem.csv"))))
EL_BY_NAME = {r["Name"].lower(): r["Symbol"] for r in pub}
EL_BY_NAME.update({"aluminium": "Al", "sulphur": "S", "caesium": "Cs"})
NAME_MAP = {
    "iron ore": ["Fe"], "hematite": ["Fe"], "magnetite": ["Fe"], "iron ore pellets": ["Fe"], "pig iron": ["Fe"],
    "zircon": ["Zr"], "ilmenite": ["Ti"], "rutile": ["Ti"], "leucoxene": ["Ti"], "titanium dioxide": ["Ti"],
    "tin oxide/cassiterite": ["Sn"], "uranium oxide": ["U"], "manganese ore": ["Mn"], "rare earth oxides": ["REE"],
    "rare earths": ["REE"], "rare earth elements": ["REE"], "monazite": ["REE"], "xenotime": ["REE"],
    "vanadium pentoxide": ["V"], "tungsten trioxide (wolframite)": ["W"], "scheelite": ["W"], "wolframite": ["W"],
    "platinum group elements": ["PGE"], "pgm": ["PGE"], "pge": ["PGE"], "platinum group metals": ["PGE"],
    "alumina": ["Al"], "bauxite": ["Al"], "high purity alumina": ["Al"], "alumina hydrate": ["Al"],
    "phosphorus oxide": ["P"], "phosphate": ["P"], "phosphate rock": ["P"], "lithium oxide": ["Li"], "spodumene": ["Li"],
    "tantalum pentoxide": ["Ta"], "graphite": ["C"], "diamond - undifferentiated": ["C"], "diamonds": ["C"], "diamond": ["C"],
    "magnesite": ["Mg"], "magnesia (magnesium oxide)": ["Mg"], "fluorite": ["F"], "fluorspar": ["F"],
    "potash": ["K"], "potassium sulfate": ["K"], "salt": ["Na", "Cl"], "halite": ["Na", "Cl"], "gypsum": [],
    "barite": ["Ba"], "baryte": ["Ba"], "chromite": ["Cr"], "beryl": ["Be"], "celestite": ["Sr"], "borates": ["B"],
    "copper cathode": ["Cu"], "copper cathodes": ["Cu"], "refined nickel": ["Ni"], "refined zinc": ["Zn"],
    "columbium": ["Nb"], "tantalite": ["Ta"], "coltan": ["Nb", "Ta"], "pyrochlore": ["Nb"],
}
def name_syms(raw):
    """'(Silver)' -> (['Ag'], minor=True). Unknown names map to []."""
    t = (raw or "").strip()
    minor = t.startswith("(") or t.endswith(")")
    t = t.strip("() ").lower()
    if not t:
        return [], minor
    if t in NAME_MAP:
        out = NAME_MAP[t]
    elif t in EL_BY_NAME:
        out = [EL_BY_NAME[t]]
    else:
        first = re.split(r"[\s(/,-]", t)[0]
        out = [EL_BY_NAME[first]] if first in EL_BY_NAME else []
    exp = []
    for x in out:
        exp += GROUP_TAGS.get(x, [x])
    return exp, minor

# ---- spatial merge: add a site, or enrich an existing one within ~2 km ------
class Grid:
    def __init__(self, d):
        self.d, self.cells = d, collections.defaultdict(list)
        for i in range(len(d["lat"])):
            self.cells[(int(d["lat"][i] * 50), int(d["lon"][i] * 50))].append(i)
    def near(self, lat, lon, tol=0.006):
        ci, cj = int(lat * 50), int(lon * 50)
        best, bd = None, tol
        for a in (ci - 1, ci, ci + 1):
            for b in (cj - 1, cj, cj + 1):
                for i in self.cells.get((a, b), ()):
                    dd = math.hypot(self.d["lat"][i] - lat, (self.d["lon"][i] - lon) * math.cos(math.radians(lat)))
                    if dd < bd:
                        best, bd = i, dd
        return best
    def add(self, i):
        self.cells[(int(self.d["lat"][i] * 50), int(self.d["lon"][i] * 50))].append(i)
grids = {}
merge_stats = collections.defaultdict(lambda: {"records": 0, "matched": 0, "added": 0})
def merge_site(sym, bit, rec, prod=""):
    if not (-90 <= rec["lat"] <= 90 and -180 <= rec["lon"] <= 180):  # also rejects NaN
        return
    d = sites[sym]
    g = grids.get(sym) or grids.setdefault(sym, Grid(d))
    j = g.near(rec["lat"], rec["lon"])
    st = merge_stats[bit]
    if j is not None:
        d["src"][j] |= bit
        if prod and not d["prod"][j]:
            d["prod"][j] = prod
        st["matched"] += 1
        return
    st["added"] += 1
    for k in d:
        d[k].append(rec.get(k, "" if k in ("name", "country", "state", "dep", "size", "with", "yrs", "prod", "id") else 0))
    d["z"][-1] = elev(rec["lon"], rec["lat"]); d["src"][-1] = bit; d["prod"][-1] = prod
    d["dev"][-1] = rec.get("dev", 5); d["op"][-1] = rec.get("op", 7)
    g.add(len(d["lat"]) - 1)

# ---- Geoscience Australia -------------------------------------------------
print("merging Geoscience Australia…", flush=True)
GA_DEV = {"deposit": 2, "mineralized zone": 3, "project": 2}
for f in json.load(open(p("ga_occ.json"))):
    pr, g = f["properties"], f["geometry"]
    if not g:
        continue
    lon, lat = g["coordinates"][:2]
    parts = [x for x in (pr.get("commodity") or "").split(",") if x.strip()]
    per = {}
    for k, x in enumerate(parts):
        syms, minor = name_syms(x)
        for sy in syms:
            per.setdefault(sy, (k == 0 and not minor))
    if not per:
        continue
    names = [x.strip("() ") for x in parts]
    for sy, prim in per.items():
        merge_stats[4]["records"] += 1
        merge_site(sy, 4, {"lat": round(lat, 4), "lon": round(lon, 4), "name": pr.get("name") or "",
                           "country": "Australia", "dev": GA_DEV.get(pr.get("mineralOccurrenceType"), 5),
                           "dep": f"GA: {pr.get('mineralOccurrenceType') or 'occurrence'}", "primary": 1 if prim else 0,
                           "with": ", ".join(n for n in names if n and sy not in name_syms(n)[0])[:80],
                           "id": "ga:" + f["id"].split(".")[-1], "grp": 0})

# ---- MinCan (Canada) ------------------------------------------------------
print("merging MinCan…", flush=True)
import openpyxl
wb = openpyxl.load_workbook(p("mincan.xlsx"), read_only=True)
rows = list(wb[wb.sheetnames[1]].iter_rows(values_only=True))
hdr = rows[0]
for k, r in enumerate(rows[1:], 1):
    r = dict(zip(hdr, r))
    try:
        lat, lon = float(r["latitude"]), float(r["longitude"])
    except (TypeError, ValueError):
        continue
    def yr(v):
        m = re.search(r"\d{4}", str(v or ""))
        return int(m.group()) if m else None
    opens = [yr(r[f"open{i}"]) for i in (1, 2, 3) if yr(r.get(f"open{i}"))]
    closes = [yr(r[f"close{i}"]) for i in (1, 2, 3) if yr(r.get(f"close{i}"))]
    active = len(opens) > len(closes)
    yrs = f"{min(opens)}\u2013{'present' if active else (max(closes) if closes else '')}" if opens else ""
    comms = [r[f"commodity{i}"] for i in range(1, 9) if r.get(f"commodity{i}")]
    per = {}
    for i2, c in enumerate(comms):
        for sy in name_syms(str(c))[0]:
            per.setdefault(sy, i2 == 0)
    for sy, prim in per.items():
        merge_stats[8]["records"] += 1
        merge_site(sy, 8, {"lat": round(lat, 4), "lon": round(lon, 4),
                           "name": r.get("namemine") or r.get("company1") or "", "country": "Canada",
                           "state": r.get("province") or "", "dev": 0 if active else 1, "dep": "",
                           "primary": 1 if prim else 0, "with": str(r.get("commodityall") or "")[:80],
                           "id": f"mincan:{k}", "yrs": yrs, "grp": 0})

# ---- Global mine production database (Jasansky et al. 2023) ----------------
print("merging global mine production database…", flush=True)
import sqlite3, struct
con = sqlite3.connect(p("minedb", "data", "facilities.gpkg"))
def gpkg_point(g):
    """First coordinate of a GeoPackage geometry blob (Point or MultiPoint)."""
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get((g[3] >> 1) & 7, 0)
    o = 8 + env
    bo = "<" if g[o] == 1 else ">"
    typ = struct.unpack(bo + "I", g[o + 1:o + 5])[0] % 1000
    if typ == 1:
        return struct.unpack(bo + "2d", g[o + 5:o + 21])
    if typ == 4 and struct.unpack(bo + "I", g[o + 5:o + 9])[0] > 0:
        q = o + 9
        bo2 = "<" if g[q] == 1 else ">"
        return struct.unpack(bo2 + "2d", g[q + 5:q + 21])
    return None
fac = {}
for fid, geom, name, ftype, prim, prods, country, status in con.execute(
        "select facility_id, geom, facility_name, facility_type, primary_commodity, commodities_products, country, activity_status from facilities"):
    if not geom or "Mine" not in (ftype or ""):
        continue
    pt = gpkg_point(geom)
    if not pt:
        continue
    fac[fid] = {"lon": pt[0], "lat": pt[1], "name": name, "prim": prim, "prods": prods or "",
                "country": country or "", "status": status}
CODE = {"Me.U3O8": "U", "Me.Al2O3": "Al", "Me.Li2O": "Li", "Me.Ta2O5": "Ta", "Nm.dia": "C", "M.flu": "F", "Nm.PO": "P"}
latest = {}
for r in csv.DictReader(open(p("minedb", "data", "commodities.csv"))):
    code = r["commodity"]
    sy = CODE.get(code) or (code[3:] if code.startswith("Me.") and code[3:] in EL_BY_NAME.values() else None)
    if code == "Me.pgm":
        sy = "PGE"
    v = to_float(r["value_tonnes"])
    if not sy or v is None or r["facility_id"] not in fac:
        continue
    key = (r["facility_id"], sy)
    if key not in latest or int(r["year"]) > latest[key][0]:
        latest[key] = (int(r["year"]), v)
def tfmt(v):
    return f"{v:,.0f} t" if v >= 100 else f"{v:,.1f} t" if v >= 1 else f"{v * 1000:,.0f} kg"
for fid, f in fac.items():
    per = {}
    for i2, c in enumerate([x for x in f["prods"].split(",") if x.strip()]):
        for sy in name_syms(c)[0]:
            per.setdefault(sy, i2 == 0)
    for (ffid, sy), (yr, v) in latest.items():
        if ffid == fid:
            for s2 in GROUP_TAGS.get(sy, [sy]):
                per.setdefault(s2, False)
    for sy, prim in per.items():
        pr = latest.get((fid, sy)) or latest.get((fid, "PGE") if sy in PGE else (None, None))
        prod = f"{pr[0]}: {tfmt(pr[1])} (mine-level)" if pr else ""
        merge_stats[16]["records"] += 1
        merge_site(sy, 16, {"lat": round(f["lat"], 4), "lon": round(f["lon"], 4), "name": f["name"] or "",
                            "country": f["country"], "dev": 0 if (f["status"] or "").lower() == "active" or pr and pr[0] >= 2016 else 5,
                            "dep": "", "primary": 1 if prim else 0, "with": f["prods"][:80], "id": f"minedb:{fid}", "grp": 0},
                   prod)
print({ {4: "GA", 8: "MinCan", 16: "MineDB"}[k]: v for k, v in merge_stats.items()})

# ---- reserves + critical-mineral flags (USGS MCS 2026) ---------------------
def mcs_reserves(sym):
    if sym not in MCS:
        return None
    com = MCS[sym][0]
    rows = [r for r in mcs_rows if r["Commodity"] == com and r["Statistics"] == "Reserves" and r["Section"].startswith("World")]
    if not rows:
        return None
    dets = collections.Counter(r["Statistics_detail"] for r in rows if r["Country"] not in ("World total", "Other countries"))
    det = "Reserves" if "Reserves" in dets else (dets.most_common(1)[0][0] if dets else None)
    if not det:
        return None
    by, world = {}, None
    for r in rows:
        if r["Country"].strip() == "World total" and r["Statistics_detail"] in (det, det + ": rounded", det + ", rounded"):
            world = world or to_float(r["Value"])
        if r["Statistics_detail"] != det or r["Country"].strip() in ("World total", "Other countries"):
            continue
        iso = mcs_iso(r["Country"].strip())
        if iso:
            v = to_float(r["Value"])
            by[iso] = v if v is not None else r["Value"].strip()
    return {"detail": det, "unit": rows[0]["Unit"].strip() if det == "Reserves" else next(r["Unit"].strip() for r in rows if r["Statistics_detail"] == det),
            "world": world, "by": by}
CRIT = {}
for r in mcs_rows:
    CRIT.setdefault(r["Commodity"], r["Is critical mineral 2025"].strip().lower() == "yes")
def critical(sym, name):
    if sym in MCS and MCS[sym][0] in CRIT:
        return CRIT[MCS[sym][0]]
    return CRIT.get(name, CRIT.get(name + " (Natural)", None))

# ---- byproducts: host ores (USGS MCS 2026 commodity chapters) -------------
HOSTS = {"Ga": ["Al", "Zn"], "Ge": ["Zn"], "In": ["Zn"], "Cd": ["Zn"], "Se": ["Cu"], "Te": ["Cu"],
         "Re": ["Mo", "Cu"], "Bi": ["Pb", "W"], "Co": ["Cu", "Ni"], "Hf": ["Zr"], "Tl": ["Zn", "Pb"], "As": ["Cu", "Au"]}
def hosts_for(sym):
    out = {k: [] for k in ("lon", "lat", "z", "name", "country", "host", "id")}
    for h in HOSTS.get(sym, []):
        d = sites.get(h)
        if not d:
            continue
        for i in range(len(d["id"])):
            if d["dev"][i] in (0, 1) and d["primary"][i]:
                for k in ("lon", "lat", "z", "name", "country", "id"):
                    out[k].append(d[k][i])
                out["host"].append(h)
    return out if out["id"] else None

# ---- abundance by layer (GERM reservoir database) -------------------------
AMASS = {r["Symbol"]: float(r["AtomicMass"]) for r in pub if r["AtomicMass"]}
OXIDE = {"Si": (1, 2), "Ti": (1, 2), "Al": (2, 3), "Fe": (1, 1), "Mn": (1, 1), "Mg": (1, 1), "Ca": (1, 1), "Na": (2, 1),
         "K": (2, 1), "P": (2, 5), "Cr": (2, 3), "Ni": (1, 1), "H": (2, 1), "C": (1, 2), "S": (1, 3), "Co": (1, 1)}
GERM_UNIT = {"ppm": 1, "\u00b5g/g": 1, "\u00c2\u00b5g/g": 1, "ug/g": 1, "ppb": 1e-3, "ng/g": 1e-3, "ppt": 1e-6, "wt%": 1e4}
def germ(file, prefs):
    """Per element: median of all values given under the most-preferred reference available (ppm)."""
    rows = json.load(open(p("germ", file)))
    vals = collections.defaultdict(lambda: collections.defaultdict(list))
    for c in rows:
        el, val, unit, ref = c[2], to_float(c[3]), c[9], c[11]
        if val is None or ref not in prefs:
            continue
        if unit == "wt%ox" and el in OXIDE:
            n, o = OXIDE[el]
            ppm = val * 1e4 * n * AMASS[el] / (n * AMASS[el] + o * 15.999)
        elif unit in GERM_UNIT:
            ppm = val * GERM_UNIT[unit]
        else:
            continue
        vals[el][ref].append(ppm)
    best = {}
    for el, byref in vals.items():
        ref = min(byref, key=prefs.index)
        best[el] = (float(np.median(byref[ref])), prefs.index(ref), ref + (f" (median of {len(byref[ref])} values)" if len(byref[ref]) > 1 else ""))
    return best
CC = germ("r10.json", ["Rudnick & Gao 2004", "Taylor & McLennan 1995", "Wedepohl 1995"])
PM = germ("r30.json", ["McDonough & Sun 1995", "Palme & O'Neill 2004", "McDonough & Frey 1989"])
CORE = germ("r34.json", ["McDonough 2004", "McDonough 1998"])
M_CORE, M_BSE, M_CC = 1.94e24, 4.03e24, 2.1e22  # kg: core, bulk silicate Earth (mantle + crust), continental crust
def abundance(sym):
    if sym not in PM:
        return None
    pm = PM[sym][0]
    core = CORE[sym][0] if sym in CORE else 0.0
    tot = M_CORE * core + M_BSE * pm
    if tot <= 0:
        return None
    core_s = M_CORE * core / tot
    cc_s = min(M_CC * CC[sym][0] / tot, 1 - core_s) if sym in CC else None
    return {"core": round(core_s, 4), "crust": None if cc_s is None else round(cc_s, 4),
            "mantle": round(1 - core_s - (cc_s or 0), 4),
            "ppm": {"crust": CC.get(sym, (None,))[0], "mantle": pm, "core": core if sym in CORE else None},
            "refs": {"crust": CC.get(sym, (None, None, None))[2], "mantle": PM[sym][2], "core": CORE.get(sym, (None, None, "assumed ~0 (not tabulated)"))[2]}}

# ---- tomography slices (TX2011, Grand 2002) --------------------------------
print("rendering tomography slices…", flush=True)
from PIL import Image
tx = h5py.File(p("tx2011.nc"))
tdep, tlat, tlon, dvs = tx["depth"][:], tx["latitude"][:], tx["longitude"][:], tx["dvs"][:]
os.makedirs(os.path.join(OUT, "tomo"), exist_ok=True)
TOMO = []
order = np.argsort(tlon)
slices = []
for want, lim in [(200, 4.0), (600, 2.0), (1000, 1.5), (1500, 1.5), (2000, 1.5), (2500, 2.0), (2800, 3.0)]:
    k = int(np.argmin(np.abs(tdep - want)))
    sl = dvs[k][:, order]
    vals = [[None if (v > 1e3 or np.isnan(v)) else round(float(v), 2) for v in row] for row in sl]
    slices.append({"depth": int(tdep[k]), "limit": lim, "dvs": vals})
    TOMO.append({"depth": int(tdep[k]), "limit": lim})
json.dump({"model": "TX2011 (Grand 2002)", "units": "percent dVs relative to layer average",
           "lat": [float(x) for x in tlat], "lon": [float(x) for x in tlon[order]], "slices": slices},
          open(os.path.join(OUT, "tomo", "tx2011.json"), "w"), separators=(",", ":"))

# ---- write per-element files + index -------------------------------------
def position(z):
    if 57 <= z <= 71: return (z - 57 + 3, 9)   # lanthanides row
    if 89 <= z <= 103: return (z - 89 + 3, 10)  # actinides row
    periods = [(1, 2), (3, 10), (11, 18), (19, 36), (37, 54), (55, 86), (87, 118)]
    for per, (a, b) in enumerate(periods, 1):
        if a <= z <= b:
            i = z - a
            if per == 1: return (1 if z == 1 else 18, 1)
            if per in (2, 3): return (i + 1 if i < 2 else i + 11, per)
            if per in (4, 5): return (i + 1, per)
            # periods 6-7: skip the f-block (placed below)
            if i < 2: return (i + 1, per)
            return (i - 14 + 1, per) if i >= 17 else (3, per)
MRDS_DATE = datetime.date.fromtimestamp(os.path.getmtime(p("mrds.csv"))).isoformat()
SOURCES = {
    "mrds": {"name": "USGS Mineral Resources Data System (MRDS)", "url": "https://mrdata.usgs.gov/mrds/",
             "date": MRDS_DATE, "record": "https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id="},
    "ree": {"name": "USGS Rare earth element mines, deposits, and occurrences (Orris and Grauch, OF 02-189)",
            "url": "https://mrdata.usgs.gov/ree/", "date": "2002 (file 2016-03-25)",
            "record": "https://mrdata.usgs.gov/ree/show-ree.php?rec_id="},
    "usgs": {"name": "USGS Mineral Commodity Summaries 2026 data release", "url": "https://doi.org/10.5066/P1WKQ63T",
             "date": "2026-02-06"},
    "bgs": {"name": "BGS World Mineral Statistics (OGC API), 2024 production", "url": "https://ogcapi.bgs.ac.uk/collections/world-mineral-statistics",
            "date": "retrieved " + TODAY},
    "etopo": {"name": "NOAA ETOPO 2022, 60 arc-second surface elevation", "url": "https://doi.org/10.25921/fd45-gt74"},
    "ga": {"name": "Geoscience Australia mineral occurrences (Earth Resource WFS)", "url": "https://services.ga.gov.au/gis/earthresource/wfs",
           "date": "retrieved " + TODAY, "record": "http://pid.geoscience.gov.au/id/feature/ga/er/mineraloccurrence/"},
    "mincan": {"name": "MinCan: Past and Present Productive Mines of Canada, 1950-2022 (Dallaire-Fortier 2024), CC BY 4.0",
               "url": "https://doi.org/10.6084/m9.figshare.23740071", "date": "March 2024"},
    "minedb": {"name": "Open database on global coal and metal mine production (Jasansky et al. 2023), CC BY 4.0",
               "url": "https://doi.org/10.5281/zenodo.7369478", "date": "2023"},
    "germ": {"name": "GERM Reservoir Database (EarthRef): continental crust, primitive mantle, core", "url": "https://earthref.org/GERM/"},
    "tomo": {"name": "TX2011 shear-velocity model (Grand 2002), via EarthScope EMC", "url": "https://doi.org/10.17611/DP/9991721"},
}
index = []
for row in pub:
    z = int(row["AtomicNumber"]); sym = row["Symbol"]
    x, y = position(z)
    d = sites.get(sym)
    prod = production(sym)
    n = len(d["id"]) if d else 0
    res = mcs_reserves(sym)
    if prod and res:
        prod["reserves"] = res
    elif res and not prod:
        prod = {"unit": res["unit"], "label": MCS[sym][2], "world": None, "worldYear": None, "usgs": None, "bgs": None,
                "countries": {}, "reserves": res}
    ab = abundance(sym)
    hs = hosts_for(sym)
    crit = critical(sym, row["Name"])
    entry = {"z": z, "sym": sym, "name": row["Name"], "x": x, "y": y, "block": row["GroupBlock"],
             "state": row["StandardState"], "class": GOLD.get(sym), "sites": n, "critical": crit,
             "prod": bool(prod and prod["countries"]), "prodWorldOnly": bool(prod and not prod["countries"] and prod["world"]),
             "hosts": bool(hs)}
    if n or prod or ab or hs:
        out = {"element": {"z": z, "sym": sym, "name": row["Name"], "class": GOLD.get(sym), "critical": crit},
               "built": TODAY, "production": prod, "abundance": ab}
        if hs:
            out["hosts"] = hs
        if d:
            enc = dict(d)
            dicts = {}
            for k in ("country", "state", "dep", "with", "yrs", "prod"):
                vals = sorted(set(d[k]))
                idx = {v: i for i, v in enumerate(vals)}
                dicts[k] = vals
                enc[k] = [idx[v] for v in d[k]]
            out["sites"] = enc
            out["dict"] = dicts
            out["stats"] = {"sites": n, "groupListed": sum(d["grp"]),
                            "bySource": {str(b): sum(1 for v in d["src"] if v & b) for b in (1, 2, 4, 8, 16)}}
        json.dump(out, open(os.path.join(OUT, "el", sym + ".json"), "w"), separators=(",", ":"), ensure_ascii=False)
        entry["file"] = f"el/{sym}.json"
    index.append(entry)
json.dump({"built": TODAY, "sources": SOURCES, "codes": {"dev": DEV, "op": OPS},
           "reeStats": ree_stats, "mergeStats": {str(k): v for k, v in merge_stats.items()}, "tomo": TOMO,
           "hostMap": HOSTS, "layerMass": {"core": M_CORE, "bse": M_BSE, "cc": M_CC}, "elements": index},
          open(os.path.join(OUT, "elements.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print("REE:", ree_stats)
print("elements with sites:", sum(1 for e in index if e["sites"]), "with production:", sum(1 for e in index if e["prod"]))

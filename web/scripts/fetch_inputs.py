"""Download every raw input build_data.py needs into one folder (default: ../../inputs, outside the repo).

Usage: python scripts/fetch_inputs.py [input_dir] [--only name,name]
Files that already exist are skipped, so a failed run can be resumed. Roughly 0.6 GB, mostly ETOPO.
Live services (BGS, Geoscience Australia, EGDI, GERM) can change between runs; the rest are fixed releases.
"""
import html, io, json, os, re, shutil, subprocess, sys, time, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
DST = os.path.abspath(args[0] if args else os.path.join(HERE, "..", "..", "..", "inputs"))
ONLY = next((a.split("=", 1)[1].split(",") for a in sys.argv[1:] if a.startswith("--only=")), None)
os.makedirs(DST, exist_ok=True)
p = lambda *a: os.path.join(DST, *a)
UA = {"User-Agent": "earth-element-explorer data build (github.com/manleym05/earth-element-explorer)"}

def get(url, tries=5, timeout=300):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if t == tries - 1:
                raise
            print(f"  retry {t + 1} ({e})", flush=True)
            time.sleep(3 + 5 * t)

def download(url, path, tries=5):
    tmp = path + ".part"
    # curl first: some hosts (PubChem) answer urllib with 503 "server busy" but serve curl fine
    if shutil.which("curl") and subprocess.run(["curl", "-fsSL", "--retry", "5", "--retry-delay", "5", "-A", UA["User-Agent"],
                                                 "-o", tmp, url]).returncode == 0:
        os.replace(tmp, path)
        return
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            break
        except Exception as e:
            if t == tries - 1:
                raise
            print(f"  retry {t + 1} ({e})", flush=True)
            time.sleep(5 + 10 * t)
    os.replace(tmp, path)

def step(name, target):
    """Decorator: run only when target is missing (and name is selected)."""
    def wrap(fn):
        if ONLY and name not in ONLY:
            return fn
        if os.path.exists(p(target)):
            print(f"{name}: have {target}")
            return fn
        print(f"{name}: fetching…", flush=True)
        fn()
        print(f"{name}: done", flush=True)
        return fn
    return wrap

@step("mrds", "mrds.csv")
def _():
    z = zipfile.ZipFile(io.BytesIO(get("https://mrdata.usgs.gov/mrds/mrds-csv.zip")))
    name = next(n for n in z.namelist() if n.lower().endswith("mrds.csv"))
    open(p("mrds.csv"), "wb").write(z.read(name))
    info = z.getinfo(name)  # keep the file date: build_data.py reports it as the MRDS date
    t = time.mktime(info.date_time + (0, 0, -1))
    os.utime(p("mrds.csv"), (t, t))

@step("ree", os.path.join("ree", "main.csv"))
def _():
    z = zipfile.ZipFile(io.BytesIO(get("https://mrdata.usgs.gov/ree/ree-csv.zip")))
    os.makedirs(p("ree"), exist_ok=True)
    for want in ("main.csv", "resource.csv"):
        name = next(n for n in z.namelist() if n.lower().endswith(want))
        open(p("ree", want), "wb").write(z.read(name))

@step("mcs", "mcs2026.csv")
def _():
    item = json.loads(get("https://www.sciencebase.gov/catalog/item/696a75d5d4be0228872d3bf8?format=json"))
    f = next(f for f in item["files"] if f["name"] == "MCS2026_Commodities_Data.csv")
    download(f["url"], p("mcs2026.csv"))

@step("bgs", "bgs2024.json")
def _():
    base = ("https://ogcapi.bgs.ac.uk/collections/world-mineral-statistics/items?f=json&limit=500"
            "&bgs_statistic_type_trans=Production&year=2024-01-01")
    feats, off = [], 0
    while True:
        d = json.loads(get(f"{base}&offset={off}"))
        feats += d["features"]
        off += len(d["features"])
        if not d["features"] or off >= d.get("numberMatched", 0):
            break
    json.dump(feats, open(p("bgs2024.json"), "w"))
    print(f"  {len(feats)} features")

@step("etopo", "etopo60.nc")
def _():
    download("https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/"
             "ETOPO_2022_v1_60s_N90W180_surface.nc", p("etopo60.nc"))

@step("ne", "ne110.geojson")
def _():
    download("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
             "ne_110m_admin_0_countries.geojson", p("ne110.geojson"))

@step("pubchem", "pubchem.csv")
def _():
    download("https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/CSV", p("pubchem.csv"))

@step("ga", "ga_occ.json")
def _():
    base = ("https://services.ga.gov.au/gis/earthresource/wfs?service=WFS&version=2.0.0&request=GetFeature"
            "&typeNames=erl:MineralOccurrenceView&outputFormat=application/json&count=5000")
    feats, start = [], 0
    while True:
        d = json.loads(get(f"{base}&startIndex={start}"))
        feats += d["features"]
        start += len(d["features"])
        if len(d["features"]) < 5000:
            break
    json.dump(feats, open(p("ga_occ.json"), "w"))
    print(f"  {len(feats)} features")

@step("mincan", "mincan.xlsx")
def _():
    download("https://ndownloader.figshare.com/files/45011833", p("mincan.xlsx"))

@step("minedb", os.path.join("minedb", "data", "facilities.gpkg"))
def _():
    z = zipfile.ZipFile(io.BytesIO(get("https://zenodo.org/api/records/7369478/files/open_database_mine_production.zip/content")))
    for n in z.namelist():  # flatten any top-level folder so files land in minedb/data/
        m = re.search(r"(data/[^/]+)$", n)
        if m and not n.endswith("/"):
            os.makedirs(p("minedb", "data"), exist_ok=True)
            open(p("minedb", m.group(1)), "wb").write(z.read(n))

@step("germ", os.path.join("germ", "r34.json"))
def _():
    os.makedirs(p("germ"), exist_ok=True)
    for rid in ("10", "30", "34"):
        t = get(f"https://earthref.org/GERMRD/{rid}/").decode("utf-8", "replace")
        rows = []
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            if len(cells) == 13 and cells[0] and cells[0] != "Reservoir":
                rows.append(cells)
        json.dump(rows, open(p("germ", f"r{rid}.json"), "w", encoding="utf-8"), ensure_ascii=False)
        print(f"  r{rid}: {len(rows)} rows")

@step("tx2011", "tx2011.nc")
def _():
    download("https://data.earthscope.org/archive/seismology/products/emc/netcdf/TX2011_percent.r0.0-n4c.nc", p("tx2011.nc"))

EGDI_FIELDS = ["inspireid", "inspirens", "country", "name", "latitude", "longitude", "occurrence_type", "deposit_group",
               "deposit_type", "commodity", "inspire_commodity", "crm_2023_element", "commodity_importance",
               "mine_status", "mining_activity_types", "mineraloccurrencedbk_hidden"]
@step("egdi", "egdi_occ.json")
def _():
    # One feature per occurrence x commodity. The /4326/ path selects lat/lon output; paths without an EPSG code 404.
    base = ("https://maps.europe-geology.eu/wfs/4326/?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
            "&TYPENAMES=egdi_mineraloccurrences_inspire&OUTPUTFORMAT=geojson&COUNT=10000"
            "&SORTBY=id_hidden&PROPERTYNAME=" + ",".join(EGDI_FIELDS))
    rows, start = [], 0
    while True:
        d = json.loads(get(f"{base}&STARTINDEX={start}"))
        fs = d.get("features") or []
        rows += [f["properties"] for f in fs]
        start += len(fs)
        print(f"  {start}", flush=True)
        if len(fs) < 10000:
            break
    json.dump(rows, open(p("egdi_occ.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  {len(rows)} rows")

print("inputs in", DST)

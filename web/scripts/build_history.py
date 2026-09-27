"""Per-element production history 1970-2024 from BGS World Mineral Statistics, plus plate boundaries.

Inputs: bgs_hist.json (all 'Production' features, one list per year, from the BGS OGC API),
        pb2002.json (PB2002 plate boundaries, Bird 2003; GeoJSON by Ahlenius/Nordpil, ODC-By).
Outputs: data/hist/<Sym>.json, data/plates.json
"""
import json, os, sys, collections, importlib.util
SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
# reuse the element -> BGS commodity map from build_data.py without running it
txt = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_data.py")).read()
start = txt.index("BGS = {"); end = txt.index("# ---- Goldschmidt")
ns = {"LANTH": ["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"]}
exec(txt[start:end], ns)
BGS = ns["BGS"]
hist = json.load(open(os.path.join(SRC, "bgs_hist.json")))
years = sorted(int(y) for y in hist)
by_com = collections.defaultdict(list)
for y in years:
    for r in hist[str(y)]:
        by_com[r["bgs_commodity_trans"]].append((y, r))
os.makedirs(os.path.join(OUT, "hist"), exist_ok=True)
index = {}
for sym, (com, sub) in BGS.items():
    rows = [(y, r) for y, r in by_com.get(com, []) if sub is None or r["bgs_sub_commodity_trans"] == sub]
    if not rows:
        continue
    units = collections.Counter(r["units"] for _, r in rows)
    unit = units.most_common(1)[0][0]
    series, names, poles = collections.defaultdict(dict), {}, {}
    for y, r in rows:
        if r["units"] != unit or r["quantity"] is None:
            continue
        iso = r["country_iso3_code"] or r["country_trans"]
        series[iso][y] = series[iso].get(y, 0) + r["quantity"]
        names[iso] = r["country_trans"]
        if r.get("pole_of_inaccessibility_longitude") is not None:
            poles[iso] = [r["pole_of_inaccessibility_longitude"], r["pole_of_inaccessibility_latitude"]]
    out = {"element": sym, "commodity": com + (f" / {sub}" if sub else ""), "unit": unit, "years": years,
           "source": "BGS World Mineral Statistics", "countries": {}}
    for iso, s in series.items():
        vals = [round(s[y], 3) if y in s else None for y in years]
        if any(v for v in vals):
            out["countries"][iso] = {"name": names[iso], "pole": poles.get(iso), "v": vals}
    json.dump(out, open(os.path.join(OUT, "hist", sym + ".json"), "w"), separators=(",", ":"))
    index[sym] = {"unit": unit, "first": min(y for c in out["countries"].values() for y, v in zip(years, c["v"]) if v)}
# plates
pb = json.load(open(os.path.join(SRC, "pb2002.json")))
lines = [[[round(x, 2), round(y, 2)] for x, y in f["geometry"]["coordinates"]] for f in pb["features"] if f["geometry"]["type"] == "LineString"]
json.dump({"source": "PB2002 plate boundaries (Bird 2003), GeoJSON by Ahlenius/Nordpil, ODC-By 1.0", "lines": lines},
          open(os.path.join(OUT, "plates.json"), "w"), separators=(",", ":"))
e = json.load(open(os.path.join(OUT, "elements.json")))
for x in e["elements"]:
    x["hist"] = index.get(x["sym"])
json.dump(e, open(os.path.join(OUT, "elements.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print(len(index), "elements with history;", len(lines), "plate lines")

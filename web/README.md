# Earth Element Explorer

CesiumJS globe with a periodic-table selector. Pick an element to see where it is found (USGS deposit
records) and where it is produced (USGS + BGS country statistics), with adjustable-opacity layers and a
cutaway into Earth's interior.

## Run locally
    python3 -m http.server 8000     # from this folder, then open http://localhost:8000
Opening index.html directly won't work (browsers block fetch() from file://). Link to an element with a
hash, e.g. http://localhost:8000/#Nd

## Deploy (free)
Any static host works. The live site is Cloudflare Pages connected to the GitHub repo, with output
directory `web` and a one-line build command that writes `config.js` from the `CESIUM_ION_TOKEN`
environment variable (see the root README). Add the deployed domain to the Cesium ion token's Allowed URLs.

## Terrain and imagery
`config.js` holds a Cesium ion token (Community tier: free, non-commercial). Clear it to fall back to a
flat globe with public-domain Natural Earth imagery, or paste a token in the panel (kept in localStorage).
Commercial use needs a paid ion plan or self-hosted terrain.

## What's in it
- 118-element periodic table; 78 elements with mapped sites, 70 with production by country. Elements on
  the 2025 U.S. critical minerals list are marked.
- Sites from USGS MRDS, USGS REE database, Geoscience Australia, MinCan (Canada), the global mine
  production database (Jasansky et al. 2023) and EGDI (Europe; Polish records excluded, see below), merged
  within ~650 m. Cards list every source for a site.
- Production (USGS MCS 2026, cross-checked with BGS 2024) and reserves (USGS MCS 2026) by country.
- Byproduct elements (Ga, Ge, In, Cd, Se, Te, Re, Bi, Co, Hf, Tl, As) show producing host-ore mines as
  hollow rings: likely sources inferred from the host ore, not confirmed output.
- Interior: share of each element in crust, mantle and core, estimated from GERM reservoir concentrations
  (continental crust: Rudnick & Gao; primitive mantle: McDonough & Sun; core: McDonough) and layer masses.
- Seismic tomography: TX2011 (Grand 2002) shear-velocity slices at 200-2,800 km, shown through a
  translucent surface (the cutaway is off in this mode).
- Production history 1970-2024 (BGS) with a year slider and play button.
- Trade flows (UN Comtrade 2023): arcs from each top-6 exporter to its 5 largest destinations.
- Tectonic plate boundaries (PB2002, Bird 2003) as a toggle layer.
- Close-zoom terrain snapping: below ~400 km camera height, markers in view are snapped to Cesium terrain.
- Site search, and shareable links that keep the camera view: #Au@lon,lat,height,heading,pitch

## Layers
- Deposits and occurrences: USGS MRDS + USGS REE database. Color by status or mining method. Above
  ~3,000 km camera height, large sets switch to 2-degree density cells (toggle: Auto / Every site / Density).
- Production by country: USGS Mineral Commodity Summaries 2026 (2025 estimates, falling back to 2024),
  then BGS 2024 where USGS has no figure. Country cards show both sources and flag disagreements.
- Surface imagery: opacity slider makes the globe translucent to show the interior.
- Cutaway: opens a wedge facing the camera. Layer boundaries from PREM (Dziewonski & Anderson 1981);
  colors and uniform shells are illustrative. "Where most of it is" comes from the element's Goldschmidt
  class (siderophile / lithophile / chalcophile / atmophile), which is inferred, not mapped.

## Rebuild the data
    pip install h5py numpy openpyxl pillow
    python scripts/fetch_inputs.py              # every input below into ../../inputs (~0.6 GB; resumable)
    python scripts/build_data.py ../../inputs   # data/elements.json, data/el/*.json, data/countries.json, data/tomo/
    python scripts/build_history.py <folder>    # optional: data/hist/*.json + data/plates.json (needs bgs_hist.json, pb2002.json)
build_data.py keeps the history index from the previous elements.json, so the two scripts can run in either
order. Trade (data/trade.json) comes from scripts/fetch_trade.py. The inputs, by hand:
    curl -LO https://mrdata.usgs.gov/mrds/mrds-csv.zip && unzip mrds-csv.zip             # mrds.csv
    mkdir ree && curl -L https://mrdata.usgs.gov/ree/ree-csv.zip -o r.zip && unzip r.zip && cp ree/main.csv ree/resource.csv ree/
    # mcs2026.csv: MCS2026_Commodities_Data.csv from https://doi.org/10.5066/P1WKQ63T
    # bgs2024.json: all 2024 "Production" features from
    #   https://ogcapi.bgs.ac.uk/collections/world-mineral-statistics/items (paginate, limit 2000)
    # etopo60.nc: https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc
    # ne110.geojson: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
    # pubchem.csv: https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/CSV
    # ga_occ.json: all features of erl:MineralOccurrenceView from https://services.ga.gov.au/gis/earthresource/wfs (outputFormat=application/json, page 5000)
    # mincan.xlsx: https://ndownloader.figshare.com/files/45011833
    # minedb/: unzip https://zenodo.org/api/records/7369478/files/open_database_mine_production.zip/content
    # germ/r10.json, r30.json, r34.json: tables parsed from http://earthref.org/GERMRD/10/, /30/, /34/
    # tx2011.nc: https://data.earthscope.org/archive/seismology/products/emc/netcdf/TX2011_percent.r0.0-n4c.nc
    # egdi_occ.json: egdi_mineraloccurrences_inspire from https://maps.europe-geology.eu/wfs/4326/ (WFS 2.0, geojson,
    #   COUNT/STARTINDEX paging); the path must include an EPSG code, and the old mapname= form no longer works
    # bgs_hist.json: all 'Production' features for 1970-2024 from the BGS OGC API, keyed by year
    # pb2002.json: https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json
    # trade: see /home comment in scripts (UN Comtrade public preview API, 2023, HS codes per element)

## Known data limits (also shown in the app)
- MRDS is no longer systematically updated (file dated 2022-08-23) and is heavily U.S.-weighted.
  No marker does not mean no deposit.
- Many rare-earth and platinum-group sites are recorded only as the group, not the individual element;
  the app counts and labels these.
- Rare-earth production is reported for the group, so every lanthanide shows the same country map.
- USGS and BGS sometimes measure on different bases (ore vs. contained metal, oxide vs. element).
- Europe: EGDI harmonizes national survey records, so coverage and detail vary by country. Polish records
  are licensed CC BY-NC-ND (no derivatives) and are left out; Poland shows MRDS sites only. EGDI mine status
  and importance are mapped onto this app's status classes and may be coarser than the national source.
- Trade arcs show declared exports for one HS code per element; some codes are refined metal (gold,
  platinum, palladium) or shared across elements (rare earths; niobium/tantalum/vanadium), as noted in-app.
- Layer shares use continental crust only and primitive mantle for the whole mantle. Where a core value
  isn't tabulated the core share is treated as zero, and the panel says so.
- Marker elevations are ETOPO 2022 at ~1.8 km resolution; close up a marker can sit slightly off the ground.

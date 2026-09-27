# Earth Element Explorer

A 3D globe (CesiumJS) with a periodic-table picker: where each element is found, produced, stockpiled
as reserves and traded, plus a cutaway into Earth's interior. Built entirely on public data, with the
source shown for every record.

- `web/`: the app (static site) and the data pipeline (`web/scripts/`). Details in `web/README.md`.
- `mobile/`: Capacitor wrapper for iOS and Android. Details in `mobile/README-mobile.md`.

## Run locally
    cd web
    cp config.example.js config.js     # then paste a Cesium ion token (optional)
    python3 -m http.server 8000        # open http://localhost:8000

Without a token the globe is flat with bundled Natural Earth imagery; with one, you get Cesium World
Terrain and satellite imagery.

## Deploy
Live at https://earth-element-explorer.pages.dev (Cloudflare Pages, connected to this repo; every push to
`main` redeploys). Pages settings:
- Build command (writes `web/config.js` from an environment variable, so the token never enters git):

      printf 'window.EARTH_CONFIG={CESIUM_ION_TOKEN:"%s",CESIUM_VERSION:"1.145.0"};' "$CESIUM_ION_TOKEN" > web/config.js
- Build output directory: `web`
- Environment variable: `CESIUM_ION_TOKEN` = the ion token. If it's empty the site falls back to the flat
  globe.

Add the deployed domain to the token's Allowed URLs at ion.cesium.com.

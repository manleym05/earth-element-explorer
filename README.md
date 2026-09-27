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
Connect this repo to Cloudflare Pages: build command none, output directory `web`. Put the ion token in
`web/config.js` at deploy time, or commit it only if the repo stays private.

# Earth Element Explorer: mobile build

`www/` is generated from `../web` by `npm run sync` (it copies the app and bundles Cesium and fonts): Cesium, fonts and all data are bundled, so it runs offline
except for terrain and imagery tiles from Cesium ion. The wrapper is Capacitor 7 (iOS + Android).

## Before you submit: decisions only you can make
1. **Cesium ion license.** The token in `www/config.js` is on ion's free Community tier, which Cesium
   limits to non-commercial use. Confirm with Cesium (cesium.com/pricing) that a free public App Store
   app qualifies, or move to a paid plan. The fallback is to clear the token: the app then runs with a
   flat globe and bundled Natural Earth imagery, with no third-party calls at all.
2. **Token origins.** Native apps load from `capacitor://localhost` (iOS) and `https://localhost`
   (Android). Add both to the token's Allowed URLs at ion.cesium.com, or terrain won't load. Anyone can
   extract a token from an app bundle; the URL allowlist does not protect native apps, so watch usage.
3. **Data terms.** Confirm reuse terms for BGS World Mineral Statistics and UN Comtrade in a published
   app. USGS data is public domain; MinCan and the mine production database are CC BY 4.0; PB2002 is
   ODC-By. The app credits every source in its Sources panel.
4. **Bundle ID.** Replace `com.CHANGEME.earthexplorer` in `capacitor.config.json` with your own
   reverse-domain ID. It can't change after the first upload.
5. **Privacy policy.** Fill in the date and contact email in `www/privacy.html` and host it at a public
   URL (App Store Connect requires the URL).

## iOS (needs macOS + Xcode 16; Apple Developer Program, $99/year)
You're on Windows. Options: a Mac, a rented cloud Mac (e.g. MacinCloud), or a CI service that builds
Capacitor iOS apps from a Git repo (e.g. Codemagic, which has a free tier).
    npm install
    npm run prepare-www
    npx cap add ios
    npm run assets            # generates icons + splash from resources/
    npx cap sync
    npx cap open ios          # Xcode: set Team + signing, set version, Product > Archive > Distribute
In App Store Connect: create the app, upload screenshots (6.9" and 6.5" iPhone, 13" iPad if you support
iPad), description, keywords, category (Education or Reference), age rating, the privacy policy URL, and
the privacy label ("Data Not Collected" matches this app). Submit for review.
Review note to include: "Interactive 3D globe built on public USGS/BGS geological data; all features
work offline except terrain imagery." That pre-empts guideline 4.2 (minimum functionality for web-based
apps): this app has substantial native-feeling interaction, but reviewers look for it.

## Android (works on Windows; Google Play Console, $25 once)
    npm install
    npm run prepare-www
    npx cap add android
    npm run assets
    npx cap sync
    npx cap open android      # Android Studio: Build > Generate Signed App Bundle (.aab)
Upload the .aab in Play Console, complete the Data safety form ("no data collected"), content rating
and store listing. New personal developer accounts must run a closed test with testers before
production release; check Play Console for the current requirement.

## Updating the app
Change the web app in `../web`, then `npm run sync` (regenerates `www/`) and bump the version before uploading.

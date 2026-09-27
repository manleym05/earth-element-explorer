"""Build mobile/www from ../web: copy the app, bundle Cesium and fonts locally, point index.html at them.
Run from mobile/:  npm install  &&  python3 scripts/prepare_www.py  &&  npx cap sync
"""
import os, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); MOB = os.path.dirname(HERE); WEB = os.path.join(MOB, "..", "web")
WWW = os.path.join(MOB, "www")
shutil.rmtree(WWW, ignore_errors=True)
shutil.copytree(WEB, WWW, ignore=shutil.ignore_patterns("scripts", "README.md", "config.example.js"))
if not os.path.exists(os.path.join(WWW, "config.js")):
    shutil.copy(os.path.join(WEB, "config.example.js"), os.path.join(WWW, "config.js"))
shutil.copytree(os.path.join(MOB, "node_modules", "cesium", "Build", "Cesium"), os.path.join(WWW, "cesium"))
shutil.copytree(os.path.join(HERE, "fonts"), os.path.join(WWW, "fonts"))
shutil.copy(os.path.join(HERE, "fonts.css"), WWW)  # privacy.html comes along from web/
p = os.path.join(WWW, "index.html"); h = open(p).read()
h = re.sub(r"\s*<link rel=\"preconnect\"[^>]*>", "", h)
h = re.sub(r'<link href="https://fonts.googleapis.com[^"]*" rel="stylesheet">', '<link href="fonts.css" rel="stylesheet">', h)
h = h.replace("https://cdn.jsdelivr.net/npm/cesium@1.145.0/Build/Cesium/", "cesium/")
h = h.replace('<script src="config.js"></script>', '<script>window.CESIUM_BASE_URL = "cesium/";</script>\n  <script src="config.js"></script>')
open(p, "w").write(h)
print("mobile/www ready")

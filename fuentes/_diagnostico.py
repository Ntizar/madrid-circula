"""Diagnóstico: por qué la página no llega a estado listo en el navegador."""
import os
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = 8766
_libdirs = os.path.expanduser("~/.local/lib/chromium-libs/libdirs.txt")
if os.path.exists(_libdirs):
    with open(_libdirs) as fh:
        os.environ["LD_LIBRARY_PATH"] = fh.read().strip() + ":" + os.environ.get("LD_LIBRARY_PATH", "")
CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PUERTO), "--bind", "127.0.0.1"],
                       cwd=RAIZ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)

# ¿el CDN de MapLibre responde?
import urllib.request
for u in ["https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js",
          "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css"]:
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30)
        print(f"CDN {u.split('/')[-1]}: HTTP {r.status} · {len(r.read()) / 1024:.0f} KB")
    except Exception as e:
        print(f"CDN {u.split('/')[-1]}: FALLO {e}")

from playwright.sync_api import sync_playwright
try:
    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        pag = nav.new_page(viewport={"width": 1280, "height": 800})
        log = []
        pag.on("console", lambda m: log.append(f"[{m.type}] {m.text[:220]}"))
        pag.on("pageerror", lambda e: log.append("[pageerror] " + str(e)[:300]))
        pag.on("requestfailed", lambda r: log.append(f"[fallo red] {r.url[:120]} · {r.failure}"))
        pag.goto(f"http://127.0.0.1:{PUERTO}/index.html", wait_until="domcontentloaded")
        for espera in (5, 10, 20, 30):
            pag.wait_for_timeout(espera * 1000)
            estado = pag.evaluate("""() => ({
                titulo: document.title,
                debug: typeof window.MC_DEBUG,
                maplibre: typeof window.maplibregl,
                aviso: (document.getElementById('aviso-turno')||{}).textContent || '',
                ficha: (document.getElementById('ficha-sitio')||{}).textContent || '',
                kpis: [...document.querySelectorAll('.nz-kpi__value')].map(e => e.textContent).slice(0,4),
                barras: document.querySelectorAll('#serie-mensual .nz-chart-bar__col').length,
                canvas: document.querySelectorAll('#mapa canvas').length,
                hojas: document.styleSheets.length
            })""")
            print(f"--- a los {sum([5,10,20,30][:[5,10,20,30].index(espera)+1])}s ---")
            for k, v in estado.items():
                print(f"    {k}: {v!r}"[:240])
            if estado["debug"] == "object" or estado["barras"] > 0:
                break
        print("\n=== últimos mensajes ===")
        for m in log[-25:]:
            print("  " + m)
        pag.screenshot(path="/tmp/diagnostico.png")
        nav.close()
finally:
    srv.terminate()

"""Localiza el elemento que desborda a 320 px (y a 768 px).

El arnés 04 se queda en «hay desborde»; esto dice QUIÉN desborda, con tag, clases y ancho.
"""
import os
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = 8767
_libdirs = os.path.expanduser("~/.local/lib/chromium-libs/libdirs.txt")
if os.path.exists(_libdirs):
    with open(_libdirs) as fh:
        os.environ["LD_LIBRARY_PATH"] = fh.read().strip() + ":" + os.environ.get("LD_LIBRARY_PATH", "")
CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PUERTO), "--bind", "127.0.0.1"],
                       cwd=RAIZ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
from playwright.sync_api import sync_playwright

MEDIDA = """() => {
  const ancho = document.documentElement.clientWidth;
  const out = [];
  document.querySelectorAll('body *').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.right > ancho + 2 || r.width > ancho + 2) {
      out.push({
        tag: e.tagName.toLowerCase(),
        cls: (e.className && e.className.toString ? e.className.toString() : '').slice(0, 60),
        id: e.id || '',
        w: Math.round(r.width),
        der: Math.round(r.right),
        padre: e.parentElement ? (e.parentElement.tagName.toLowerCase() + '.' +
          (e.parentElement.className && e.parentElement.className.toString ? e.parentElement.className.toString().slice(0,40) : '')) : ''
      });
    }
  });
  out.sort((a, b) => b.w - a.w);
  return { ancho, sw: document.scrollingElement.scrollWidth, n: out.length, peores: out.slice(0, 12) };
}"""

try:
    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None,
                                args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        pag = nav.new_page(viewport={"width": 1440, "height": 900})
        pag.goto(f"http://127.0.0.1:{PUERTO}/index.html", wait_until="domcontentloaded")
        pag.wait_for_function("() => window.MC_DEBUG && window.MC_DEBUG.listo()", timeout=180000)
        pag.wait_for_timeout(2500)
        for ancho in (320, 768):
            pag.set_viewport_size({"width": ancho, "height": 900})
            pag.wait_for_timeout(600)
            r = pag.evaluate(MEDIDA)
            print(f"\n=== viewport {ancho} · clientWidth {r['ancho']} · scrollWidth {r['sw']} · elementos fuera: {r['n']} ===")
            for e in r["peores"]:
                print(f"   {e['w']:>6}px  der={e['der']:>5}  <{e['tag']} id={e['id']!r} class={e['cls']!r}>")
                print(f"            dentro de <{e['padre']}>")
        nav.close()
finally:
    srv.terminate()

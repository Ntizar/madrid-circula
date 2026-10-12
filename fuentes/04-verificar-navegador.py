"""Verificación en navegador real (headless) de Madrid Circula.

Mide, no admira: estilos computados del design system, recuento de puntos en el mapa,
KPIs con dato, gráficos, planificador de turnos, ficha de punto, desborde horizontal a
320/360/390 px y errores de consola.

Uso:  /home/nan/.mastermind/venv/bin/python fuentes/04-verificar-navegador.py
"""
import json
import os
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = 8765
salida = {"ok": [], "fallos": [], "avisos": []}

# Chromium en esta VM necesita las librerías que no puede instalar el sistema:
# están extraídas en ~/.local/lib/chromium-libs (scripts/chrome-libs.sh, sin root).
_libdirs = os.path.expanduser("~/.local/lib/chromium-libs/libdirs.txt")
if os.path.exists(_libdirs):
    with open(_libdirs) as fh:
        lp = fh.read().strip()
    if lp:
        os.environ["LD_LIBRARY_PATH"] = lp + ":" + os.environ.get("LD_LIBRARY_PATH", "")
CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")


def ok(t):
    salida["ok"].append(t)
    print("   OK  " + t)


def fallo(t):
    salida["fallos"].append(t)
    print("   XX  " + t)


def aviso(t):
    salida["avisos"].append(t)
    print("   !   " + t)


servidor = subprocess.Popen([sys.executable, "-m", "http.server", str(PUERTO), "--bind", "127.0.0.1"],
                            cwd=RAIZ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    from playwright.sync_api import sync_playwright
except ImportError as e:
    servidor.terminate()
    print("playwright no disponible:", e)
    sys.exit(2)

try:
    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None,
                                args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        pag = nav.new_page(viewport={"width": 1440, "height": 900})
        consola = []
        pag.on("console", lambda m: consola.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
        pag.on("pageerror", lambda e: consola.append("pageerror: " + str(e)))

        pag.goto(f"http://127.0.0.1:{PUERTO}/index.html", wait_until="domcontentloaded")
        pag.wait_for_function("() => window.MC_DEBUG && window.MC_DEBUG.listo()", timeout=180000)
        pag.wait_for_timeout(3000)

        # 1 · hojas de estilo y estilos computados (no basta con que las clases estén en el DOM)
        datos = pag.evaluate("""() => {
            const cs = getComputedStyle(document.querySelector('.nz-navbar'));
            const kpi = getComputedStyle(document.querySelector('.nz-kpi__value'));
            return {
              hojas: document.styleSheets.length,
              navbarDisplay: cs.display,
              navbarBg: cs.backgroundColor,
              kpiSize: kpi.fontSize,
              titulo: document.title,
              h1: document.querySelectorAll('h1').length,
              footer: document.querySelector('footer').textContent.trim(),
              enlacesAurora: [...document.querySelectorAll('link[href*="Aurora"]')].length
            };
        }""")
        ok(f"hojas de estilo cargadas: {datos['hojas']}") if datos["hojas"] >= 8 else fallo(f"solo {datos['hojas']} hojas de estilo")
        ok(f"navbar display={datos['navbarDisplay']}") if datos["navbarDisplay"] == "flex" else fallo(f"navbar display={datos['navbarDisplay']} (¿CSS caído?)")
        ok(f"KPI a {datos['kpiSize']}") if datos["kpiSize"] else fallo("KPI sin tamaño computado")
        ok("un único h1") if datos["h1"] == 1 else fallo(f"{datos['h1']} h1 en la página")
        ok("atribución exacta en el pie") if datos["footer"] == "Hecho con ❤️ por David Antizar" else fallo(f"pie: {datos['footer']!r}")
        ok(f"{datos['enlacesAurora']} hojas de Aurora por CDN pineado")

        # 2 · mapa: capas y datos reales
        m = pag.evaluate("""() => window.MC_DEBUG.info()""")
        ok(f"mapa con {m['capas']} capas y fuente de {m['puntos']} recipientes") if m["capas"] >= 5 and m["puntos"] > 40000 else fallo(f"mapa flojo: {m}")
        ok(f"islas: {m['islas']} · fracciones: {m['fracciones']}") if m["islas"] > 14000 else fallo("pocas islas en la fuente")

        # 3 · KPIs con dato
        kpis = pag.evaluate("""() => ({
            cont: document.getElementById('k-cont').textContent,
            islas: document.getElementById('k-islas').textContent,
            t2025: document.getElementById('k-t2025').textContent,
            kgdia: document.getElementById('k-kgdia').textContent,
            visibles: document.getElementById('badge-visibles').textContent,
            fracciones: document.querySelectorAll('#cuerpo-fracciones tr').length,
            lotes: document.querySelectorAll('#cuerpo-lotes tr').length,
            otros: document.querySelectorAll('#cuerpo-otros tr').length,
            barras: document.querySelectorAll('#serie-mensual .nz-chart-bar__col').length,
            distritos: document.querySelectorAll('#tabla-distritos .nz-chart-tablebar__row').length,
            celdas: document.querySelectorAll('#heatmap .nz-heatmap__cell').length,
            donut: document.querySelectorAll('#donut-segs circle').length,
            leyenda: document.querySelectorAll('#donut-leyenda .nz-legend__item').length
        })""")
        esperado = {"cont": "44.069", "islas": "14.282", "t2025": "1,19 M t"}
        for k, v in esperado.items():
            ok(f"KPI {k} = {kpis[k]}") if kpis[k] == v else fallo(f"KPI {k} = {kpis[k]!r}, se esperaba {v!r}")
        ok(f"t/día generadas: {kpis['kgdia']}")
        ok(f"{kpis['fracciones']} filas de fracciones · {kpis['lotes']} lotes · {kpis['otros']} flujos especiales") if kpis["fracciones"] == 5 and kpis["lotes"] == 3 else fallo(f"tablas: {kpis}")
        ok(f"serie mensual con {kpis['barras']} meses") if kpis["barras"] == 12 else fallo(f"barras: {kpis['barras']}")
        ok(f"ranking con {kpis['distritos']} distritos") if kpis["distritos"] == 21 else fallo(f"distritos: {kpis['distritos']}")
        ok(f"heatmap con {kpis['celdas']} celdas") if kpis["celdas"] == 60 else fallo(f"celdas: {kpis['celdas']}")
        ok(f"donut con {kpis['donut']} segmentos y leyenda de {kpis['leyenda']}") if kpis["donut"] == 5 else fallo("donut incompleto")

        # 4 · colores del mapa resueltos desde los datos (no colores inventados)
        col = pag.evaluate("() => window.MC_DEBUG.colorPunto(0)")
        ok(f"color del primer tipo en el mapa: {col}") if col and col.startswith("#") else fallo(f"color raro: {col}")

        # 5 · filtro por distrito + llenado
        # 1.842 es el valor recalculado de forma independiente sobre datos/red.json (Python),
        # no una estimación: si la web se desvía, el filtro está roto.
        f = pag.evaluate("""() => window.MC_DEBUG.filtrar('Carabanchel', 0)""")
        ok(f"filtro Carabanchel + Resto: {f['visibles']} recipientes · {f['litros']} L") if f["visibles"] == 1842 and f["litros"] == 2984850 else fallo(f"filtro: {f}")
        # el ciclo de servicio de Resto es de 24 h: a 48 h el cubo acaba de vaciarse (diente de sierra).
        l = pag.evaluate("""() => window.MC_DEBUG.llenado(48, false)""")
        ok(f"servicio a 48 h = instante post-vaciado: medio {l['medio']} % (coherente)") if l["medio"] == 0 else fallo(f"servicio a 48 h: {l}")
        l = pag.evaluate("""() => window.MC_DEBUG.llenado(12, true)""")
        ok(f"llenado a demanda a 12 h: medio {l['medio']} % · {l['llenos']} sobre el 80 %") if l["medio"] > 0 else fallo(f"llenado a demanda: {l}")

        # 6 · planificador de turnos
        t = pag.evaluate("""() => window.MC_DEBUG.planificar('Resto', 'Carabanchel', 3, 11000)""")
        ok(f"turnos planificados: {t['rutas']} · {t['paradas']} paradas · {t['km']} km · {t['kg']} kg") if t["rutas"] >= 2 and t["paradas"] > 20 else fallo(f"turnos: {t}")
        filas = pag.evaluate("() => document.querySelectorAll('#detalle-turnos tbody tr').length")
        ok(f"tabla de recorridos con {filas} filas") if filas >= 2 else fallo(f"filas de recorrido: {filas}")
        geom = pag.evaluate("() => window.MC_DEBUG.geometriaRutas()")
        ok(f"geometría de rutas en el mapa: {geom['lineas']} líneas, {geom['paradas']} paradas") if geom["lineas"] >= 2 else fallo(f"geom: {geom}")

        # 7 · ficha de un punto de recogida
        pag.evaluate("() => window.MC_DEBUG.verIsla(0)")
        pag.wait_for_timeout(400)
        ficha = pag.evaluate("""() => ({
            filas: document.querySelectorAll('#ficha-sitio tbody tr').length,
            texto: document.querySelector('#ficha-sitio').textContent.replace(/\\s+/g,' ').slice(0, 120)
        })""")
        ok(f"ficha del punto con {ficha['filas']} cubos") if ficha["filas"] >= 1 else fallo(f"ficha vacía: {ficha}")

        # 8 · desborde horizontal: la prueba objetiva del móvil
        for ancho in (320, 360, 390, 768, 1440):
            pag.set_viewport_size({"width": ancho, "height": 900})
            pag.wait_for_timeout(450)
            r = pag.evaluate("""() => ({sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth,
                                     fuera: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 2).length})""")
            ok(f"sin desborde a {ancho}px (scrollWidth {r['sw']} = clientWidth {r['cw']})") if r["sw"] <= r["cw"] + 1 else fallo(f"desborde a {ancho}px: {r}")
        pag.set_viewport_size({"width": 1440, "height": 900})

        # 9 · consola limpia
        errores = [c for c in consola if c.startswith("error") or c.startswith("pageerror")]
        if errores:
            for e in errores[:6]:
                fallo("consola: " + e[:180])
        else:
            ok(f"sin errores de consola ({len(consola)} avisos)")

        pag.screenshot(path=os.path.join(RAIZ, "captura-escritorio.png"), full_page=False)
        pag.set_viewport_size({"width": 390, "height": 844})
        pag.wait_for_timeout(500)
        pag.screenshot(path=os.path.join(RAIZ, "captura-movil.png"), full_page=False)
        nav.close()
finally:
    servidor.terminate()

print("\n== RESUMEN ==")
print(f"   comprobaciones superadas: {len(salida['ok'])}")
print(f"   fallos: {len(salida['fallos'])}")
print(f"   avisos: {len(salida['avisos'])}")
informe = ["# Verificación en navegador — Madrid Circula", "",
           f"Comprobaciones superadas: **{len(salida['ok'])}** · fallos: **{len(salida['fallos'])}**", "",
           "## Superadas"] + [f"- {t}" for t in salida["ok"]] + ["", "## Fallos"] + ([f"- {t}" for t in salida["fallos"]] or ["- ninguno"])
open(os.path.join(RAIZ, "VERIFICACION-NAVEGADOR.md"), "w", encoding="utf-8").write("\n".join(informe) + "\n")
sys.exit(1 if salida["fallos"] else 0)

"""Verificación de la instantánea estática del panel (demo/) en navegador real.

La demo no tiene backend: sirve el mismo panel de gestión con las respuestas de la API
capturadas. Esto comprueba lo que tiene que ser verdad para que la demo no engañe:

  · se entra directo a la sala de control (la instantánea trae sesión)
  · el cartel dice que es una instantánea y de qué día son los datos
  · la sala pinta sus indicadores, su mapa con cartografía del IGN y sus gráficos
  · se puede abrir el detalle de una ruta y navegar
  · ESCRIBIR NO SE PUEDE: planificar se rechaza y lo explica, en vez de fingir

Uso:  /home/nan/.mastermind/venv/bin/python demo/pruebas/verificar-demo.py
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUERTO = 8791
BASE = f"http://127.0.0.1:{PUERTO}"
DEMO = BASE + "/demo/"
DIA = json.loads(open(os.path.join(RAIZ, "demo", "api", "datos.json"), encoding="utf-8").read())["fecha"]

salida = {"ok": [], "fallos": [], "avisos": []}


def ok(t):
    salida["ok"].append(t)
    print("   OK  " + t)


def fallo(t):
    salida["fallos"].append(t)
    print("   XX  " + t)


def aviso(t):
    salida["avisos"].append(t)
    print("   !   " + t)


# ── servir el repositorio tal cual (la demo vive en /demo/) ───────────────────
sirviente = subprocess.Popen([sys.executable, "-m", "http.server", str(PUERTO)], cwd=RAIZ,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
nav = None
try:
    for _ in range(40):
        try:
            if urllib.request.urlopen(DEMO, timeout=5).status == 200:
                break
        except Exception:
            pass
        time.sleep(0.25)
    print(f"· demo servida en {DEMO} (sin backend, solo ficheros)")

    _libdirs = os.path.expanduser("~/.local/lib/chromium-libs/libdirs.txt")
    if os.path.exists(_libdirs):
        with open(_libdirs) as fh:
            lp = fh.read().strip()
        if lp:
            os.environ["LD_LIBRARY_PATH"] = lp + ":" + os.environ.get("LD_LIBRARY_PATH", "")
    CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None,
                                args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        pag = nav.new_page(viewport={"width": 1440, "height": 900})
        consola = []
        peticiones = []
        pag.on("console", lambda m: consola.append(m.type + ": " + m.text) if m.type == "error" else None)
        pag.on("pageerror", lambda e: consola.append("pageerror: " + str(e)))
        pag.on("request", lambda r: peticiones.append(r.url))

        pag.goto(DEMO, wait_until="domcontentloaded")

        # 1 · se entra directo a la sala, sin pedir credenciales
        try:
            pag.wait_for_function("() => window.MC_PANEL && window.MC_PANEL.listo === true", timeout=30000)
            ok("la instantánea entra directo a la aplicación (sin backend y sin credenciales)")
        except Exception:
            fallo("la aplicación no arrancó en la instantánea")
        if pag.is_hidden("#form-acceso") and pag.is_visible("#app"):
            ok("la pantalla de acceso queda fuera del camino")
        else:
            fallo("la pantalla de acceso sigue a la vista")

        # 2 · el cartel de honestidad
        try:
            pag.wait_for_selector("#demo-cartel", state="visible", timeout=8000)
            cartel = pag.inner_text("#demo-cartel")
            if "instantánea" in cartel.lower() and DIA in cartel and "no escribe" in cartel.lower():
                ok(f"el cartel avisa: instantánea de solo lectura, datos del {DIA}")
            else:
                fallo("el cartel no dice lo que tiene que decir: " + cartel[:160])
        except Exception as e:
            fallo(f"no aparece el cartel de la instantánea ({type(e).__name__})")

        # 3 · el campo de fecha apunta al día de la captura
        valor = pag.input_value("#sala-fecha")
        if valor == DIA:
            ok(f"la fecha del panel viene puesta al día de la captura ({DIA})")
        else:
            fallo(f"la fecha del panel es {valor} y la captura es del {DIA}")

        # 4 · la sala de control con datos dentro
        s = {"serie": [], "kpis": {"rutas": 0}, "rutas": [], "mapa": {"rutas": []}}
        try:
            pag.wait_for_function("() => window.MC_PANEL.sala && window.MC_PANEL.sala.kpis.rutas >= 5", timeout=25000)
            s = pag.evaluate("() => window.MC_PANEL.sala")
            k = s["kpis"]
            ok(f"sala de control: {k['rutas']} rutas · {k['paradas']} paradas · {k['kg_previstos']} kg previstos")
            if k["rutas"] == len(s["rutas"]) == len(s["mapa"]["rutas"]):
                ok("las rutas del día cuadran entre las cifras, la lista y el mapa")
            else:
                fallo("descuadre entre las cifras, la lista y el mapa")
        except Exception as e:
            fallo(f"la sala no cargó datos ({type(e).__name__})")

        pintados = pag.eval_on_selector_all("#sala-kpis .nz-kpi", "e => e.length")
        if pintados >= 8:
            ok(f"{pintados} indicadores pintados en la sala")
        else:
            fallo(f"solo {pintados} indicadores en la sala")

        # 5 · el mapa (capa propia + cartografía del IGN)
        capas = pag.evaluate("() => (window.MC_PANEL.salaMapa.getStyle().layers || []).map(l => l.id)")
        teselas = pag.evaluate("() => window.MC_PANEL.salaMapa.getStyle().sources.base.tiles[0]")
        if any(c.startswith("sala-") for c in capas) and "ign.es" in teselas:
            ok(f"el mapa pinta {len([c for c in capas if c.startswith('sala-')])} capas de rutas sobre el IGN")
        else:
            fallo(f"el mapa no está como debe: capas {capas} teselas {teselas}")
        pag.wait_for_timeout(2500)
        del_ign = [u for u in peticiones if "ign.es" in u]
        if len(del_ign) > 3:
            ok(f"y pide teselas del IGN de verdad ({len(del_ign)} peticiones)")
        else:
            aviso(f"solo {len(del_ign)} teselas del IGN pedidas (¿caché?)")

        # 6 · los gráficos, y ahora la línea tiene que dibujarse (hay varios días)
        barras = pag.eval_on_selector_all("#sala-barras .nz-chart-bar__col", "e => e.length")
        sectores = pag.eval_on_selector_all("#sala-donut .nz-chart-donut__seg", "e => e.length")
        lineas = pag.eval_on_selector_all("#sala-linea .nz-chart-line__path", "e => e.length")
        carga = pag.eval_on_selector_all("#sala-carga .nz-chart-bar__col", "e => e.length")
        dias = len(s["serie"])
        if barras and sectores and carga and lineas and dias >= 2:
            ok(f"gráficos: {barras} barras, {sectores} sectores, {carga} de carga y la línea de {dias} días")
        else:
            fallo(f"gráficos incompletos: barras {barras}, sectores {sectores}, carga {carga}, línea {lineas}, días {dias}")

        # 7 · se navega el panel: la lista de rutas y el detalle de una ruta
        pag.click('[data-vista="hoy"]')
        pag.wait_for_selector("#cuerpo-rutas tr", timeout=15000)
        filas = pag.eval_on_selector_all("#cuerpo-rutas tr", "e => e.length")
        if filas >= 5:
            ok(f"la lista de rutas trae {filas} filas de la instantánea")
        else:
            fallo(f"la lista de rutas solo trae {filas} filas")
        pag.click('#cuerpo-rutas tr button')
        try:
            pag.wait_for_function("() => window.MC_PANEL.vista === 'ruta' && window.MC_PANEL.ruta", timeout=15000)
            r = pag.evaluate("() => window.MC_PANEL.ruta")
            ok(f"se abre el detalle de una ruta: {r['fraccion']} en {r['distrito']} con {len(r['paradas'])} paradas")
        except Exception as e:
            fallo(f"no se pudo abrir el detalle de una ruta ({type(e).__name__})")

        # 8 · escribir NO se puede, y lo dice con claridad (ni finge ni revienta)
        pag.click('[data-vista="nueva"]')
        pag.wait_for_selector("#form-ruta", state="visible", timeout=10000)
        pag.fill("#n-fecha", DIA)
        pag.select_option("#n-fraccion", "Resto")
        pag.select_option("#n-distrito", "Carabanchel")
        pag.fill("#n-camion", "MAD-9999")
        pag.click("#btn-planificar")
        # El panel pone los errores del formulario en línea, en #nueva-error, y con la tilde
        # de por medio el texto es frágil: se busca un trozo sin tilde y se sondea sin prisa.
        dicho = ""
        for _ in range(60):
            try:
                if pag.is_visible("#nueva-error"):
                    dicho = pag.inner_text("#nueva-error") or ""
            except Exception:
                dicho = ""
            if "instant" in dicho.lower():
                break
            pag.wait_for_timeout(250)
        if "instant" in dicho.lower():
            ok("planificar se rechaza y lo explica: " + " ".join(dicho.split())[:110] + "…")
        else:
            fallo("planificar en la instantánea no dio el mensaje esperado; el panel dijo: " +
                  (" ".join(dicho.split())[:200] or "(nada)"))
        filas_despues = pag.eval_on_selector_all("#cuerpo-rutas tr", "e => e.length")
        if filas_despues == filas:
            ok("y no se ha colado ninguna ruta nueva (la instantánea no escribe)")
        else:
            fallo(f"las rutas pasaron de {filas} a {filas_despues}: algo escribió")

        # 9 · nada se desborda a 360 px, con la vista más densa en pantalla
        pag.click('[data-vista="sala"]')
        pag.wait_for_timeout(1500)
        pag.set_viewport_size({"width": 360, "height": 780})
        pag.wait_for_timeout(800)
        ancho = pag.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
        if ancho[0] <= ancho[1] + 1:
            ok(f"sin desborde a 360 px (ancho {ancho[0]} ≤ {ancho[1]})")
        else:
            fallo(f"se desborda a 360 px: {ancho[0]} sobre {ancho[1]}")

        # 10 · consola limpia
        graves = [c for c in consola if "favicon" not in c]
        if not graves:
            ok("sin errores en consola")
        else:
            fallo("errores en consola: " + " | ".join(graves[:4]))

    print()
    print(f"DEMO: {len(salida['ok'])} OK · {len(salida['fallos'])} fallos · {len(salida['avisos'])} avisos")
    if salida["fallos"]:
        for f in salida["fallos"]:
            print("   fallo: " + f)
        sys.exit(1)
finally:
    if nav:
        try:
            nav.close()
        except Exception:
            pass          # si salimos por fallo, el navegador ya puede estar cerrado
    sirviente.terminate()

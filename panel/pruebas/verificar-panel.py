"""Verificación del panel de gestión en navegador real (headless).

Recorre el ciclo completo como lo haría una persona: entra, planifica una ruta,
la asigna, entra como conductor, la inicia y marca una parada. Mide estado real
(window.MC_PANEL), peticiones reales al IGN, tablas con filas y errores de consola.

Uso:  /home/nan/.mastermind/venv/bin/python panel/pruebas/verificar-panel.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUERTO = 8771
BASE = f"http://127.0.0.1:{PUERTO}"
ADMIN = ("admin@pruebas.local", "clave-admin-1")
PLAN = ("plani@pruebas.local", "clave-plani-1")
COND = ("conductor@pruebas.local", "clave-cond-1")

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


def pedir(metodo, ruta, cuerpo=None, cookie=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    pet = urllib.request.Request(BASE + ruta, data=datos, method=metodo)
    pet.add_header("Content-Type", "application/json")
    if cookie:
        pet.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(pet, timeout=30) as r:
            return r.status, json.loads(r.read().decode()), r.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}"), None


# ── arranque de la API con base temporal y datos reales ───────────────────────
tmp = tempfile.mkdtemp(prefix="mc-panel-")
ruta_db = os.path.join(tmp, "panel.db")
print("· importando datos reales a una base temporal...")
subprocess.run([shutil.which("node"), "api/importar.js", ruta_db], cwd=RAIZ, check=True,
               stdout=subprocess.DEVNULL)
entorno = dict(os.environ, MC_DB=ruta_db, MC_PUERTO=str(PUERTO),
               MC_ADMIN_EMAIL=ADMIN[0], MC_ADMIN_CLAVE=ADMIN[1])
api = subprocess.Popen([shutil.which("node"), "api/servidor.js"], cwd=RAIZ, env=entorno,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try:
            if pedir("GET", "/api/salud")[0] == 200:
                break
        except Exception:
            pass
        time.sleep(0.5)
    code, salud, _ = pedir("GET", "/api/salud")
    if code == 200:
        ok(f"API en pie · {salud['datos']['islas']} islas · {salud['datos']['contenedores']} contenedores")
    else:
        fallo("la API no arranca")

    _, _, cookie_admin = pedir("POST", "/api/entrar", {"email": ADMIN[0], "clave": ADMIN[1]})
    for (email, clave, rol, nombre) in [
        (PLAN[0], PLAN[1], "planificador", "Pili Plan"),
        (COND[0], COND[1], "conductor", "Concha Conduce"),
    ]:
        c, d, _ = pedir("POST", "/api/usuarios",
                        {"email": email, "nombre": nombre, "rol": rol, "clave": clave},
                        cookie=cookie_admin)
        ok(f"cuenta de {rol} creada: {d.get('usuario', {}).get('email', d)}") if c == 201 else fallo(f"no se pudo crear {rol}: {d}")

    # ── navegador ─────────────────────────────────────────────────────────────
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
        pag.on("console", lambda m: consola.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
        pag.on("pageerror", lambda e: consola.append("pageerror: " + str(e)))
        pag.on("request", lambda r: peticiones.append(r.url))

        def entrar_como(email, clave):
            pag.wait_for_selector("#form-acceso", state="visible", timeout=15000)
            pag.fill("#inp-email", email)
            pag.fill("#inp-clave", clave)
            pag.click("#btn-entrar")
            pag.wait_for_function("() => window.MC_PANEL && window.MC_PANEL.listo === true", timeout=30000)

        try:
            pag.goto(BASE + "/", wait_until="domcontentloaded")
            # 1 · la portada del panel es el acceso
            if pag.is_visible("#form-acceso") and pag.is_hidden("#app"):
                ok("de entrada pide credenciales (la app está oculta)")
            else:
                fallo("la pantalla de acceso no aparece como debería")

            # 2 · entrar como admin
            entrar_como(*ADMIN)
            chip = pag.inner_text("#chip-usuario")
            if "admin" in chip:
                ok(f"entrada de admin · chip: {chip}")
            else:
                fallo(f"el chip de usuario no refleja el rol: {chip}")
            if pag.is_visible('[data-vista="admin"]') and pag.is_visible('[data-vista="nueva"]'):
                ok("el admin ve Planificar y Administración")
            else:
                fallo("al admin le faltan pestañas")

            # 3 · planificar una ruta desde el formulario
            pag.click('[data-vista="nueva"]')
            pag.fill("#n-fecha", "2026-10-25")
            pag.select_option("#n-turno", "mañana")
            pag.select_option("#n-fraccion", "Resto")
            pag.select_option("#n-distrito", "Carabanchel")
            pag.fill("#n-camion", "MAD-0001")
            pag.click("#btn-planificar")
            pag.wait_for_function("() => window.MC_PANEL.ruta && window.MC_PANEL.ruta.id > 0", timeout=30000)
            ruta = pag.evaluate("() => window.MC_PANEL.ruta")
            if ruta["paradas"] and ruta["km_planificados"] > 0 and ruta["kg_previstos"] > 0:
                ok(f"ruta planificada desde la UI: {ruta['islas_planificadas']} islas · "
                   f"{ruta['kg_previstos']} kg · {ruta['km_planificados']} km · {len(ruta['paradas'])} paradas")
            else:
                fallo(f"la ruta salió vacía: {ruta}")

            # 4 · el mapa: lienzo pintado, IGN pedido de verdad y paradas dibujadas
            pag.wait_for_selector("#mapa canvas", timeout=20000)
            time.sleep(3)
            ign = [u for u in peticiones if "ign.es" in u]
            if len(ign) > 3:
                ok(f"el mapa pide cartografía del IGN ({len(ign)} teselas)")
            else:
                fallo(f"el mapa no está pidiendo teselas del IGN ({len(ign)})")
            filas_paradas = pag.locator("#lista-paradas .mc-parada").count()
            if filas_paradas == len(ruta["paradas"]):
                ok(f"la lista de paradas pinta las {filas_paradas} paradas")
            else:
                fallo(f"paradas pintadas {filas_paradas} de {len(ruta['paradas'])}")
            if pag.locator("#kpis-ruta .nz-kpi").count() >= 5:
                ok("los indicadores de la ruta están rellenos")
            else:
                fallo("faltan indicadores en el detalle de la ruta")

            # 5 · asignar al conductor desde la UI
            # (un <option> dentro de un <select> nunca es "visible" para Playwright:
            #  se espera al select y a que las opciones lo incluyan)
            pag.wait_for_selector("#ruta-acciones select", timeout=15000)
            pag.wait_for_function(
                "() => Array.from(document.querySelectorAll('#ruta-acciones select option'))"
                ".some(o => o.textContent.includes('Concha'))", timeout=15000)
            opciones = pag.eval_on_selector_all("#ruta-acciones select option", "os => os.map(o => [o.value, o.textContent])")
            valor = [v for v, t in opciones if "Concha" in t]
            if valor:
                pag.select_option("#ruta-acciones select", valor[0])
                pag.click("#ruta-acciones button")
                pag.wait_for_function("() => window.MC_PANEL.ruta.estado === 'asignada'", timeout=20000)
                ok("ruta asignada desde el panel (estado: asignada)")
            else:
                fallo(f"el conductor no aparece en el selector: {opciones}")

            # 6 · la tabla de rutas la muestra con su etiqueta
            # El panel arranca filtrado al día de hoy (es un panel de operaciones del día),
            # así que para ver una ruta del 25/10 hay que ampliar el rango.
            pag.click('[data-vista="hoy"]')
            pag.fill("#f-desde", "2026-10-01")
            pag.fill("#f-hasta", "2026-10-31")
            pag.click("#btn-refrescar")
            pag.wait_for_selector("#cuerpo-rutas tr", timeout=15000)
            texto_tabla = pag.inner_text("#cuerpo-rutas").lower()
            if "carabanchel" in texto_tabla and "asignada" in texto_tabla:
                ok("la tabla de rutas lista la ruta con su estado")
            else:
                fallo(f"la tabla no muestra la ruta: {texto_tabla[:120]}")

            # 7 · administración: cuentas y auditoría
            pag.click('[data-vista="admin"]')
            pag.wait_for_selector("#cuerpo-usuarios tr", timeout=15000)
            n_usuarios = pag.locator("#cuerpo-usuarios tr").count()
            n_auditoria = pag.locator("#cuerpo-auditoria tr").count()
            if n_usuarios >= 3 and n_auditoria >= 3:
                ok(f"administración: {n_usuarios} cuentas y {n_auditoria} líneas de auditoría")
            else:
                fallo(f"administración incompleta: {n_usuarios} cuentas, {n_auditoria} auditoría")
            pag.fill("#u-nombre", "Nueva Cuenta")
            pag.fill("#u-email", "nueva@pruebas.local")
            pag.select_option("#u-rol", "invitado")
            pag.fill("#u-clave", "clave-nueva-1")
            pag.click("#btn-crear-usuario")
            pag.wait_for_function(
                "() => document.querySelector('#cuerpo-usuarios').innerText.includes('nueva@pruebas.local')",
                timeout=20000)
            ok("cuenta creada desde el formulario de administración")

            # 8 · salir y entrar como conductor: menos pestañas y puede trabajar
            pag.click("#btn-salir")
            entrar_como(*COND)
            if pag.is_hidden('[data-vista="admin"]') and pag.is_hidden('[data-vista="nueva"]'):
                ok("al conductor no le salen Planificar ni Administración")
            else:
                fallo("el conductor ve pestañas que no le tocan")

            pag.click('[data-vista="hoy"]')
            pag.fill("#f-desde", "2026-10-01")
            pag.fill("#f-hasta", "2026-10-31")
            pag.click("#btn-refrescar")
            pag.wait_for_selector("#cuerpo-rutas tr", timeout=15000)
            pag.click("#cuerpo-rutas tr button")
            pag.wait_for_function("() => window.MC_PANEL.vista === 'ruta'", timeout=15000)
            pag.wait_for_selector("#ruta-acciones button", timeout=10000)
            pag.click("#ruta-acciones button")  # iniciar
            pag.wait_for_function("() => window.MC_PANEL.ruta.estado === 'en_curso'", timeout=20000)
            ok("el conductor inicia su ruta desde el panel")

            pag.wait_for_selector("#lista-paradas .mc-parada button", timeout=10000)
            pag.click("#lista-paradas .mc-parada button")
            pag.wait_for_function("() => window.MC_PANEL.ruta.paradas[0].hecha === 1", timeout=20000)
            hechas = pag.evaluate("() => window.MC_PANEL.ruta.paradas.filter(p => p.hecha).length")
            ok(f"parada marcada como hecha ({hechas} de {len(ruta['paradas'])})")

            # 9 · en móvil no se desborda
            pag.set_viewport_size({"width": 360, "height": 780})
            time.sleep(0.6)
            ancho = pag.evaluate("() => document.documentElement.scrollWidth")
            if ancho <= 380:
                ok(f"a 360 px no se desborda (ancho real {ancho})")
            else:
                fallo(f"se desborda a 360 px: ancho {ancho}")

            # 10 · consola limpia
            # El 401 del sondeo inicial de sesión es esperado (el panel pregunta si ya
            # hay sesión abierta antes de pedir credenciales): se cuenta como aviso.
            graves = []
            for c in consola:
                if c.startswith(("error", "pageerror")):
                    if "401" in c:
                        aviso("sondeo de sesión sin cookie: 401 esperado")
                    else:
                        graves.append(c)
            if not graves:
                ok(f"sin errores de consola ({len(consola)} avisos)")
            else:
                fallo("errores de consola: " + " | ".join(graves[:3]))

            # 11 · el propio panel no se queja: su registro de errores tiene que estar vacío
            errores_panel = pag.evaluate("() => window.MC_PANEL.errores")
            if not errores_panel:
                ok("el panel no registró ningún error de aplicación")
            else:
                fallo("el panel registró errores: " + " | ".join(errores_panel[:3]))
        except Exception as e:
            fallo(f"excepción durante la verificación: {type(e).__name__}: {e}")
        finally:
            nav.close()
finally:
    api.terminate()
    try:
        api.wait(timeout=10)
    except Exception:
        api.kill()
    shutil.rmtree(tmp, ignore_errors=True)

print("\n" + "=" * 60)
print(f"PANEL: {len(salida['ok'])} OK · {len(salida['fallos'])} fallos · {len(salida['avisos'])} avisos")
print("=" * 60)
sys.exit(1 if salida["fallos"] else 0)

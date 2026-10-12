"""03 · Verifica los dataset construidos y emite el informe de verificación.

Nada se publica sin pasar por aquí: comprueba que los números que enseña la web
salen de las fuentes y no de una suposición.

Uso:  python3 fuentes/03-verificar.py
"""
import csv
import io
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
red = json.load(open(os.path.join(RAIZ, "datos", "red.json"), encoding="utf-8"))
ton = json.load(open(os.path.join(RAIZ, "datos", "toneladas.json"), encoding="utf-8"))
fallos, avisos, ok = [], [], []


def check(cond, texto, detalle=""):
    (ok if cond else fallos).append(f"{texto}{(' · ' + detalle) if detalle else ''}")
    return cond


# ── 1. Inventario de contenedores ───────────────────────────────────────────
r = red["resumen"]
check(r["contenedores"] == 44069, f"Contenedores válidos: {r['contenedores']}")
check(sum(r["descartes"].values()) == 182, "Descartes de inventario", str(r["descartes"]))
check(sum(r["por_fraccion"].values()) == r["contenedores"], "Suma por fracción = total")
check(len(red["islas"]) == 14282, f"Islas (puntos de recogida): {len(red['islas'])}")
check(len(red["puntos"]) == r["contenedores"], "Puntos = contenedores")
# cada punto apunta a una isla y a una fracción válidos
malos = sum(1 for p in red["puntos"] if not (0 <= p[0] < len(red["islas"]) and 0 <= p[1] < 5))
check(malos == 0, "Todas las referencias a isla/fracción son válidas")
# el mask de fracciones de cada isla coincide con los puntos que la usan
mask_calc = {}
for p in red["puntos"]:
    mask_calc[p[0]] = mask_calc.get(p[0], 0) | (1 << p[1])
check(all(red["islas"][i][5] == m for i, m in mask_calc.items()), "Máscara de fracciones por isla coherente")
# capacidad declarada
sin_cap = r["sin_capacidad_declarada"]
avisos.append(f"Contenedores sin capacidad deducible del modelo (soterrados): {sin_cap}")
check(len(red["litros"]) == len(red["modelos"]), "Tabla de capacidades alineada con modelos")

# ── 2. Toneladas ────────────────────────────────────────────────────────────
fechas, serie = ton["fechas"], ton["serie"]
check(fechas[0] == "2017-01" and fechas[-1] == "2026-06", f"Serie {fechas[0]} → {fechas[-1]} ({len(fechas)} meses)")
esperado_meses = (2026 - 2017) * 12 + 6
check(len(fechas) == esperado_meses, f"Cobertura mensual completa ({len(fechas)}/{esperado_meses})")
check(all(len(v) == len(fechas) for v in serie.values()), "Todas las series tienen la misma longitud")

# suma anual 2025 (contrastada a mano contra el CSV de 4 trimestres)
total_2025 = sum(sum(v[i] for i, f in enumerate(fechas) if f.startswith("2025")) for v in serie.values())
check(abs(total_2025 - 1187170) < 5, "Total 2025 = 1 187 170 t", f"calculado {total_2025:,.0f} t")
total_1s26 = sum(sum(v[i] for i, f in enumerate(fechas) if f.startswith("2026")) for v in serie.values())
check(abs(total_1s26 - 610163) < 5, "Total 1S-2026 = 610 163 t", f"calculado {total_1s26:,.0f} t")

# coherencia distritos ↔ serie
por_dist = ton["por_distrito"]
for anio in fechas[-2:][0][:4], "2026":
    pass
suma_dist_2026 = 0.0
for d, v in por_dist.items():
    m = v.get("mensual", {}).get("2026")
    if m:
        suma_dist_2026 += sum(sum(x) for x in m.values())
serie_2026 = sum(sum(v[i] for i, f in enumerate(fechas) if f.startswith("2026")) for v in serie.values())
check(abs(suma_dist_2026 - serie_2026) < 1, "Suma por distrito 2026 = serie 2026",
      f"{suma_dist_2026:,.0f} t vs {serie_2026:,.0f} t")
check(len(por_dist) == 22, f"Distritos con tonelaje: {len(por_dist)}")

# ── 3. Modelo de llenado ────────────────────────────────────────────────────
m = ton["modelo"]
check(len(m["kg_dia_por_contenedor"]) >= 20, "Distritos con modelo de llenado", f"{len(m['kg_dia_por_contenedor'])}")
for frac, kg in m["kg_dia_ciudad"].items():
    check(kg > 0, f"kg/día ciudad {frac}", f"{kg:,.0f}")
print("\n== Cruce con los indicadores oficiales publicados (frecuencia de vaciado) ==")
print(f"   {'fracción':<14}{'necesaria/sem':>15}{'servicio/sem':>15}{'holgura':>10}")
for frac in ["Resto", "PMB", "Papel-Cartón", "Orgánica", "Vidrio"]:
    nec = m["vaciados_semana_ciudad"].get(frac)
    ser = m["vaciados_semana_servicio"].get(frac)
    if nec and ser:
        print(f"   {frac:<14}{nec:>15.2f}{ser:>15.2f}{ser / nec:>9.1f}×")

# ── 4. Informe ──────────────────────────────────────────────────────────────
print("\n== COMPROBACIONES OK ==")
for t in ok:
    print("   ✓", t)
if avisos:
    print("\n== AVISOS ==")
    for t in avisos:
        print("   !", t)
if fallos:
    print("\n== FALLOS ==")
    for t in fallos:
        print("   ✗", t)
    print(f"\nRESULTADO: {len(fallos)} FALLOS")
    sys.exit(1)
print(f"\nRESULTADO: VÁLIDO ({len(ok)} comprobaciones)")

informe = ["# Verificación de Madrid Circula", "",
           f"Fecha: {red['generado']}", "",
           f"Comprobaciones superadas: **{len(ok)}** · fallos: **{len(fallos)}**", "", "## Comprobado"]
informe += [f"- {t}" for t in ok]
informe += ["", "## Avisos"] + [f"- {t}" for t in avisos]
informe += ["", "## Cruce con indicador oficial", "",
            "| Fracción | Vaciados/semana necesarios (derivado del tonelaje real) | Vaciados/semana del servicio (publicado/declarado) | Holgura |",
            "|---|---|---|---|"]
for frac in ["Resto", "PMB", "Papel-Cartón", "Orgánica", "Vidrio"]:
    nec = m["vaciados_semana_ciudad"].get(frac)
    ser = m["vaciados_semana_servicio"].get(frac)
    informe.append(f"| {frac} | {nec:.2f} | {ser:.2f} ({m['procedencia_servicio'][frac]}) | {ser / nec:.1f}× |")
open(os.path.join(RAIZ, "VERIFICACION.md"), "w", encoding="utf-8").write("\n".join(informe) + "\n")
print("   informe → VERIFICACION.md")

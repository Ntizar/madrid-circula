"""02 · Construye los dataset limpios de Madrid Circula.

Lee los CSV de crudo/ y escribe:
  datos/red.json        contenedores + islas (inventario 300276)
  datos/toneladas.json  toneladas reales por fracción/distrito/lote/mes (300143)
                        + parámetros del modelo de llenado derivados de dato real

Uso:  python3 fuentes/02-construir.py
"""
import csv
import io
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRUDO = os.path.join(RAIZ, "crudo")
DATOS = os.path.join(RAIZ, "datos")

# Distritos oficiales de Madrid (código INE municipal interno 1..21, + 99 sin distrito)
DISTRITOS = {
    "1": "Centro", "2": "Arganzuela", "3": "Retiro", "4": "Salamanca", "5": "Chamartín",
    "6": "Tetuán", "7": "Chamberí", "8": "Fuencarral - El Pardo", "9": "Moncloa - Aravaca",
    "10": "Latina", "11": "Carabanchel", "12": "Usera", "13": "Puente de Vallecas",
    "14": "Moratalaz", "15": "Ciudad Lineal", "16": "Hortaleza", "17": "Villaverde",
    "18": "Villa de Vallecas", "19": "Vicálvaro", "20": "San Blas - Canillejas",
    "21": "Barajas", "99": "Sin distrito",
}

# Las 5 fracciones de calle del inventario de contenedores ↔ su nombre en el dataset de toneladas
FRACCIONES = ["Resto", "PMB", "Papel-Cartón", "Orgánica", "Vidrio"]
FRACCION_A_RESIDUO = {"Resto": "RESTO", "PMB": "ENVASES", "Papel-Cartón": "PAPEL-CARTON",
                      "Orgánica": "ORGANICA", "Vidrio": "VIDRIO"}
# Color oficial del recipiente (Ordenanza 12/2022 de Limpieza y Gestión de Residuos)
COLORES = {"Resto": "#6b7280", "PMB": "#f2c200", "Papel-Cartón": "#1d4ed8",
           "Orgánica": "#8b5a2b", "Vidrio": "#2f9e44"}
# Densidad aparente declarada del residuo recogido (kg por litro de recipiente).
# Hipótesis técnica del modelo, no dato municipal: se publica en el método de la web.
DENSIDADES = {"Resto": 0.30, "PMB": 0.045, "Papel-Cartón": 0.12, "Orgánica": 0.45, "Vidrio": 0.50}
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
         "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def clave(s):
    """Normaliza un nombre para comparar entre datasets ('FUNCARRAL - EL PARDO' ≡ 'Fuencarral-El Pardo')."""
    s = sin_tildes((s or "").strip()).upper()
    s = re.sub(r"\s*-\s*", "-", s)
    return re.sub(r"\s+", " ", s)


def num(s):
    s = (s or "").strip().replace("\u00a0", "")
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


# Nombre canónico de cada residuo: los ficheros anchos (2017-2020) traen tildes
# y otro orden de palabras que los largos (2021+), y hay que fundirlos en uno.
ALIAS_RESIDUO = {
    "ORGANICA": "ORGANICA",
    "PAPEL-CARTON": "PAPEL-CARTON", "PAPEL CARTON": "PAPEL-CARTON", "CARTON": "PAPEL-CARTON",
    "CARTON COMERCIAL": "CARTON COMERCIAL", "CARTON LIMPIEZA VIARIA": "CARTON LIMPIEZA VIARIA",
    "RESIDUOS DEPOSITADOS MIGAS CALIENTES": "MIGAS CALIENTES",
    "CONTENEDORES ROPA USADA": "CONTENEDORES DE ROPA", "CONTENEDORES ROPA": "CONTENEDORES DE ROPA",
    "CONTENEDORES DE ROPA": "CONTENEDORES DE ROPA",
    "PAPEL INCAUTADO POLICIA": "PAPEL INCAUTADO POLICIA",
    "ENVASES": "ENVASES", "RESTO": "RESTO", "VIDRIO": "VIDRIO", "ROPA": "ROPA", "RCD": "RCD",
    "CLINICOS": "CLINICOS", "PUNTOS LIMPIOS": "PUNTOS LIMPIOS", "ANIMALES MUERTOS": "ANIMALES MUERTOS",
    "PILAS": "PILAS", "CAMA DE CABALLO": "CAMA DE CABALLO",
}
# Etiqueta legible para la web
ETIQUETA_RESIDUO = {
    "RESTO": "Resto", "ORGANICA": "Orgánica", "ENVASES": "Envases (PMB)", "VIDRIO": "Vidrio",
    "PAPEL-CARTON": "Papel-cartón", "RCD": "Escombros (RCD)", "CLINICOS": "Clínicos",
    "PUNTOS LIMPIOS": "Puntos limpios", "CARTON COMERCIAL": "Cartón comercial",
    "VIDRIO COMERCIAL": "Vidrio comercial", "ROPA": "Ropa usada", "CAMA DE CABALLO": "Cama de caballo",
    "MIGAS CALIENTES": "Migas calientes", "CARTON LIMPIEZA VIARIA": "Cartón de limpieza viaria",
    "PAPEL INCAUTADO POLICIA": "Papel incautado", "ANIMALES MUERTOS": "Animales muertos",
    "PILAS": "Pilas", "CONTENEDORES DE ROPA": "Contenedores de ropa",
}
CANON_DISTRITO = {clave(v): v for v in DISTRITOS.values()}


def canon_residuo(s):
    return ALIAS_RESIDUO.get(clave(s), clave(s))


def canon_distrito(nombre, codigo=None):
    if codigo and codigo in DISTRITOS:
        return DISTRITOS[codigo]
    return CANON_DISTRITO.get(clave(nombre), (nombre or "").strip().title() or "Sin distrito")



def leer(nombre):
    raw = open(os.path.join(CRUDO, nombre), "rb").read()
    try:
        txt = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        txt = raw.decode("latin-1")
    delim = ";" if txt.count(";") > txt.count(",") else ","
    return list(csv.DictReader(io.StringIO(txt), delimiter=delim))


# ─────────────────────────────────────────────────────────────────────────────
# 1. CONTENEDORES  (300276)
# ─────────────────────────────────────────────────────────────────────────────
print("== Leyendo inventario de contenedores ==")
filas = leer("inventario-contenedores.csv")
print(f"   filas en crudo: {len(filas)}")

distritos_vistos = {}
modelos, cargas, lotes_ok = {}, {}, {}
litros = []
islas_idx, islas, dirs_idx, direcciones = {}, [], {}, []
puntos = []
descartes = Counter()

for f in filas:
    frac = (f.get("Tipo Contenedor") or "").strip()
    if frac not in FRACCIONES:
        descartes["fracción desconocida: " + (frac or "vacío")] += 1
        continue
    try:
        lat = float((f.get("Latitud") or "").replace(",", "."))
        lon = float((f.get("Longitud") or "").replace(",", "."))
    except ValueError:
        descartes["coordenada ilegible"] += 1
        continue
    if not (40.30 < lat < 40.60 and -3.85 < lon < -3.55):
        descartes["coordenada fuera de Madrid"] += 1
        continue

    distrito = (f.get("Distrito") or "").strip()
    distrito_norm = canon_distrito(distrito)
    distritos_vistos[clave(distrito_norm)] = distrito_norm

    modelo = (f.get("Modelo") or "").strip()
    cap = re.search(r"(\d{3,5})", modelo)
    litros_val = int(cap.group(1)) if cap else 0
    if modelo not in modelos:
        modelos[modelo] = len(modelos)
        litros.append(litros_val)

    carga = (f.get("Carga") or "").strip() or "Sin dato"
    if carga not in cargas:
        cargas[carga] = len(cargas)

    lote = (f.get("Lote") or "").strip()
    if lote not in lotes_ok:
        lotes_ok[lote] = len(lotes_ok)

    dirv = (f.get("Dirección") or "").strip()
    if dirv not in dirs_idx:
        dirs_idx[dirv] = len(direcciones)
        direcciones.append(dirv)

    situado = (f.get("Código Situado") or "").strip()
    if not situado:  # sin punto de recogida: cada uno es su propia isla
        situado = f"SIN_PUNTO_{len(islas)}"
    if situado not in islas_idx:
        islas_idx[situado] = len(islas)
        islas.append([situado, round(lat, 5), round(lon, 5), distrito_norm, dirs_idx[dirv], 0])
    idx_isla = islas_idx[situado]
    islas[idx_isla][5] |= 1 << FRACCIONES.index(frac)

    puntos.append([idx_isla, FRACCIONES.index(frac), lotes_ok[lote], modelos[modelo], cargas[carga]])

print(f"   contenedores válidos: {len(puntos)} | descartes: {dict(descartes)}")
print(f"   islas (puntos de recogida): {len(islas)} | direcciones únicas: {len(direcciones)}")

distritos_ord = sorted({i[3] for i in islas}, key=lambda n: (-sum(1 for p in puntos if islas[p[0]][3] == n), n))

# contenedores por distrito y fracción (lo usa el modelo de llenado)
cont_por_dist_frac = defaultdict(Counter)
for p in puntos:
    cont_por_dist_frac[islas[p[0]][3]][FRACCIONES[p[1]]] += 1
# capacidad instalada por distrito y fracción
litros_por_dist_frac = defaultdict(Counter)
for p in puntos:
    litros_por_dist_frac[islas[p[0]][3]][FRACCIONES[p[1]]] += litros[p[3]]

red = {
    "generado": "2026-10-12",
    "fuente": "Ayuntamiento de Madrid · datos abiertos 300276 «Contenedores de papel-cartón, vidrio, envases, orgánica y restos» (inventario a 03-03-2026)",
    "licencia": "CC-BY 4.0",
    "fracciones": FRACCIONES,
    "colores": [COLORES[f] for f in FRACCIONES],
    "distritos": distritos_ord,
    "modelos": list(modelos),
    "litros": litros,
    "cargas": list(cargas),
    "lotes": list(lotes_ok),
    "direcciones": direcciones,
    "islas": islas,
    "puntos": puntos,
    "resumen": {
        "contenedores": len(puntos),
        "islas": len(islas),
        "descartes": dict(descartes),
        "por_fraccion": {f: sum(1 for p in puntos if FRACCIONES[p[1]] == f) for f in FRACCIONES},
        "por_distrito": {d: sum(1 for p in puntos if islas[p[0]][3] == d) for d in distritos_ord},
        "litros_instalados": sum(litros[p[3]] for p in puntos),
        "sin_capacidad_declarada": sum(1 for p in puntos if litros[p[3]] == 0),
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. TONELADAS  (300143)
# ─────────────────────────────────────────────────────────────────────────────
print("\n== Leyendo toneladas ==")
serie = defaultdict(lambda: defaultdict(float))          # residuo -> "AAAA-MM" -> t
por_distrito = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))   # distrito -> residuo -> "AAAA-MM"
por_lote = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))       # lote -> residuo -> "AAAA-MM"

ficheros = sorted(n for n in os.listdir(CRUDO) if n.startswith("toneladas-"))
for nombre in ficheros:
    filas = leer(nombre)
    if not filas:
        continue
    cols = list(filas[0].keys())
    if "Toneladas" in cols:  # formato largo
        n = 0
        for f in filas:
            t = num(f.get("Toneladas"))
            if t is None:
                continue
            anio = (f.get("Año") or "").strip()
            mes_txt = (f.get("Mes") or "").strip().lower()
            mes = MESES.get(mes_txt)
            if mes is None:
                try:
                    mes = int(mes_txt)
                except ValueError:
                    continue
            residuo = canon_residuo(f.get("Residuo") or "")
            cod = (f.get("Distrito") or "").strip()
            distrito = canon_distrito(f.get("Nombre distrito") or "", cod)
            lote = (f.get("Lote") or "").strip()
            fk = f"{anio}-{mes:02d}"
            serie[residuo][fk] += t
            por_distrito[distrito][residuo][fk] += t
            por_lote[lote][residuo][fk] += t
            n += 1
        print(f"   {nombre}: {n} filas largas")
    elif any("ENERO" in c.upper() for c in cols):  # formato ancho 2017-2020
        anio_col = re.search(r"'(\d\d)", cols[3] or "")
        anio = "20" + anio_col.group(1) if anio_col else "?"
        cols_mes = [c for c in cols if "(" in c]
        n = 0
        for f in filas:
            residuo = canon_residuo(f.get("FRACCIÓN") or f.get("FRACCION") or "")
            dist_raw = (f.get("DISTRITO") or "").strip()
            distrito = canon_distrito(dist_raw, dist_raw)
            lote = (f.get("LOTE ") or f.get("LOTE") or "").strip()
            for c in cols_mes:
                mes_txt = c.split("'")[0].strip().lower()
                mes = MESES.get(mes_txt)
                if mes is None:
                    continue
                t = num(f.get(c))
                if t is None:
                    continue
                fk = f"{anio}-{mes:02d}"
                serie[residuo][fk] += t
                por_distrito[distrito][residuo][fk] += t
                por_lote[lote][residuo][fk] += t
                n += 1
        print(f"   {nombre}: {n} celdas ({anio}, formato ancho)")

fechas = sorted({k for v in serie.values() for k in v})
anios = sorted({k[:4] for k in fechas})
print(f"   fracciones con tonelaje: {len(serie)} | meses: {len(fechas)} ({fechas[0]} → {fechas[-1]})")

# ─────────────────────────────────────────────────────────────────────────────
# 3. MODELO DE LLENADO (derivado de tonelaje real + inventario real)
# ─────────────────────────────────────────────────────────────────────────────
ultimos = fechas[-3:]  # últimos 3 meses publicados: media estable, sin estacionalidad de un mes suelto
kg_dia_por_contenedor = defaultdict(dict)
vaciados_semana = defaultdict(dict)
kg_dia_distrito = defaultdict(dict)
for distrito in DISTRITOS.values():
    for frac in FRACCIONES:
        residuo = FRACCION_A_RESIDUO[frac]
        t_total = sum(por_distrito[distrito][residuo].get(k, 0.0) for k in ultimos)
        if t_total <= 0:
            continue
        dias = sum(DIAS_MES[int(k[5:7]) - 1] for k in ultimos)
        kg_dia = t_total * 1000.0 / dias
        n_cont = cont_por_dist_frac[distrito].get(frac, 0)
        litros_medios = (litros_por_dist_frac[distrito].get(frac, 0) / n_cont) if n_cont else 0
        if not n_cont or not litros_medios:
            continue
        kg_dia_distrito[distrito][frac] = round(kg_dia, 1)
        por_cont = kg_dia / n_cont
        kg_dia_por_contenedor[distrito][frac] = round(por_cont, 3)
        cap_kg = litros_medios * DENSIDADES[frac]
        if por_cont > 0:
            dias_llenar = cap_kg / por_cont
            vaciados_semana[distrito][frac] = round(7.0 / dias_llenar, 2) if dias_llenar > 0 else None

media_cap_litros = {f: round(litros_por_dist_frac[d].get(f, 0) / cont_por_dist_frac[d].get(f, 1), 0)
                    for d in DISTRITOS.values() for f in FRACCIONES if cont_por_dist_frac[d].get(f)}

kg_dia_total = {f: round(sum(kg_dia_distrito[d].get(f, 0) for d in DISTRITOS.values()), 1) for f in FRACCIONES}
vaciados_ciudad = {}
for f in FRACCIONES:
    n_cont = sum(cont_por_dist_frac[d].get(f, 0) for d in DISTRITOS.values())
    kg_cont = kg_dia_total[f] / n_cont if n_cont else 0
    cap = media_cap_litros.get(f, 0) * DENSIDADES[f]
    vaciados_ciudad[f] = round(7.0 * kg_cont / cap, 2) if cap else None

toneladas = {
    "generado": "2026-10-12",
    "fuente": "Ayuntamiento de Madrid · datos abiertos 300143 «Recogida de residuos» (serie " + anios[0] + "-" + anios[-1] + ")",
    "licencia": "CC-BY 4.0",
    "unidad": "toneladas",
    "fechas": fechas,
    "fracciones": sorted(serie, key=lambda r: -sum(serie[r].values())),
    "etiquetas": {r: ETIQUETA_RESIDUO.get(r, r.title()) for r in serie},
    "serie": {r: [round(serie[r].get(k, 0.0), 2) for k in fechas] for r in serie},
    "anual": {r: {a: round(sum(serie[r].get(k, 0.0) for k in fechas if k[:4] == a), 1) for a in anios} for r in serie},
    "por_distrito": {
        d: {
            "anual": {r: {a: round(sum(por_distrito[d][r].get(k, 0.0) for k in fechas if k[:4] == a), 1) for a in anios}
                      for r in por_distrito[d] if any(por_distrito[d][r].values())},
            "mensual": {a: {r: [round(por_distrito[d][r].get(f"{a}-{m:02d}", 0.0), 1) for m in range(1, 13)]
                            for r in por_distrito[d] if any(por_distrito[d][r].values())}
                        for a in anios[-2:]},
        } for d in DISTRITOS.values() if d in por_distrito
    },
    "por_lote": {l: {r: {a: round(sum(por_lote[l][r].get(k, 0.0) for k in fechas if k[:4] == a), 1) for a in anios}
                     for r in por_lote[l] if any(por_lote[l][r].values())}
                 for l in por_lote},
    "modelo": {
        "meses_referencia": ultimos,
        "densidades_kg_l": DENSIDADES,
        "capacidad_media_litros": media_cap_litros,
        "kg_dia_distrito_fraccion": {d: dict(v) for d, v in kg_dia_distrito.items()},
        "contenedores_distrito_fraccion": {d: dict(cont_por_dist_frac[d]) for d in cont_por_dist_frac},
        "kg_dia_por_contenedor": {d: dict(v) for d, v in kg_dia_por_contenedor.items()},
        "vaciados_semana_derivados": {d: dict(v) for d, v in vaciados_semana.items()},
        "kg_dia_ciudad": kg_dia_total,
        "vaciados_semana_ciudad": vaciados_ciudad,
        "velocidad_media_kmh": 16,
        "segundos_por_parada": 95,
        "capacidad_camion_kg": {"Resto": 11000, "PMB": 3200, "Papel-Cartón": 5000,
                                "Orgánica": 9000, "Vidrio": 11000},
        # Frecuencia de vaciado que aplica hoy el servicio (vaciados por semana).
        # Papel-cartón y vidrio: indicador oficial publicado por el Ayuntamiento
        #   (presupuestos abiertos, programa 16210 «Gestión ambiental urbana»).
        # Resto, orgánica y PMB: parámetro de servicio declarado (recogida diaria
        #   en la mayor parte de la ciudad), no publicado en estos datasets.
        "vaciados_semana_servicio": {"Papel-Cartón": 3.0, "Vidrio": 0.46, "Resto": 7.0,
                                     "Orgánica": 7.0, "PMB": 6.0},
        "procedencia_servicio": {"Papel-Cartón": "publicado", "Vidrio": "publicado",
                                "Resto": "declarado", "Orgánica": "declarado", "PMB": "declarado"},
        "cobertura": {
            "t_sin_distrito": round(sum(serie["RESTO"].get(k, 0.0) + serie["ORGANICA"].get(k, 0.0)
                                        for k in ultimos), 1),
            "nota": "El modelo de zona cruza tonelaje y contenedores por distrito; los residuos "
                    "asignados a «Sin distrito» (código 99) quedan fuera del cálculo.",
        },
    },
}

os.makedirs(DATOS, exist_ok=True)
for nombre, contenido in (("red.json", red), ("toneladas.json", toneladas)):
    ruta = os.path.join(DATOS, nombre)
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(contenido, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"   escrito datos/{nombre}: {os.path.getsize(ruta) / 1e6:.2f} MB")

print("\n== Modelo de llenado (ciudad) ==")
for f in FRACCIONES:
    print(f"   {f:<14} kg/día {kg_dia_total[f]:>10,.0f} | capacidad media {media_cap_litros.get(f,0):>5.0f} L "
          f"| vaciados/semana derivados {vaciados_ciudad[f]}")
print("\nOK")

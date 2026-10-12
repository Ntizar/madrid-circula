"""01 · Descarga de las fuentes públicas de Madrid Circula.

Fuentes (todas datos abiertos del Ayuntamiento de Madrid, licencia CC-BY 4.0):
  - 300276 · Inventario de contenedores (fracción, modelo, lote, distrito, lat/lon)
  - 300143 · Recogida de residuos: toneladas por año/mes/lote/distrito/tipo

Uso:  python3 fuentes/01-descargar.py
Deja los CSV originales en crudo/ (no se versionan).
"""
import csv
import io
import json
import os
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
API = "https://datos.madrid.es/api/3/action/package_show?id="
CRUDO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "crudo")


def get(url, timeout=180):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def bajar(nombre, url):
    os.makedirs(CRUDO, exist_ok=True)
    destino = os.path.join(CRUDO, nombre)
    if os.path.exists(destino) and os.path.getsize(destino) > 500:
        print(f"  = ya estaba: {nombre} ({os.path.getsize(destino) / 1e6:.2f} MB)")
        return destino
    datos = get(url)
    open(destino, "wb").write(datos)
    print(f"  + descargado: {nombre} ({len(datos) / 1e6:.2f} MB)")
    return destino


print("== Contenedores (300276) ==")
pkg = json.loads(get(API + "300276-0-contenedor-papel-carton-todos"))["result"]
for r in pkg["resources"]:
    if r["format"] == "CSV":
        bajar("inventario-contenedores.csv", r["url"])

print("== Toneladas de recogida (300143) ==")
pkg = json.loads(get(API + "300143-0-recogida-residuos"))["result"]
n = 0
for r in pkg["resources"]:
    if r["format"] != "CSV":
        continue
    cola = r["url"].split("/")[-1]
    nombre = f"toneladas-{r['name'].split('-')[1]}-{cola if cola.endswith('.csv') else 'serie.csv'}"
    try:
        bajar(nombre, r["url"])
        n += 1
    except Exception as e:
        print(f"  ! fallo {r['name']}: {e}")

print(f"\nCSV de toneladas descargados: {n}")
print("Listo. Siguiente: python3 fuentes/02-construir.py")

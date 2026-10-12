# Madrid Circula

Gemelo digital operativo de la recogida de residuos de Madrid, en una sola página
estática: los **44 069 recipientes reales** del inventario municipal sobre el mapa,
las **1 187 170 toneladas** reales de 2025 repartidas por distrito y fracción, y un
modelo de llenado calibrado con esos mismos datos.

Todo el dato de partida es abierto y oficial del Ayuntamiento de Madrid (CC-BY 4.0).
Todo lo que la web muestra sale de dos ficheros JSON que este repositorio construye
con scripts reproducibles.

Hecho con ❤️ por David Antizar

---

## Qué se puede hacer en la web

| Cara | Qué enseña |
|---|---|
| **Fracción** | Los 44 069 recipientes con el color oficial de su contenedor. Filtros por distrito, lote de concesión y tipo de carga. Pincha un punto de recogida y sale su ficha: cubos, litros, kg/día y llenado. |
| **Llenado** | El modelo de llenado hora a hora, en dos modos: ciclo de servicio real o vaciado a demanda (umbral 80 %). Ranking de los puntos más cargados y contraste con el servicio publicado. |
| **Turnos** | Planificador de rutas sobre la geometría real de los puntos: fracción, distrito, número de camiones y caja. Da kg por recorrido, km, horas y ocupación, y los camiones se mueven por el mapa. |
| **Balance** | Serie mensual 2017-2026 por fracción, ranking de los 21 distritos, mapa de intensidad mes a mes, reparto anual, los 3 lotes de concesión y 11 flujos de residuos especiales. |

## Qué es real y qué es modelado

Esta es la parte que casi nunca se cuenta, así que aquí está dentro del propio producto
(pestaña **Método**):

**Real, del dataset oficial**
- Los 44 069 recipientes, su fracción, modelo, capacidad, lote, distrito, barrio y coordenada.
- Los 14 282 puntos de recogida (islas) y las 44 069 direcciones.
- Las toneladas por residuo, distrito, barrio y mes: 114 meses, de 2017 a 2026.
- Las frecuencias publicadas de papel-cartón y vidrio.

**Modelado, con los parámetros declarados a la vista**
- **Llenado**: no es dato público (los sensores del Ayuntamiento son plataforma privada).
  Se estima con los kg/día reales de cada distrito y fracción repartidos entre los cubos
  reales de ese distrito, sobre la capacidad real de cada modelo. Es una estimación
  calibrada, no una medida.
- **Densidad aparente** del residuo suelto (kg/litro): hipótesis técnica declarada.
- **Rutas**: vecino más cercano con mejora 2-opt sobre la geometría real. No son las
  rutas del operador.
- **Tiempos**: 16 km/h de media urbana, 95 s por parada y un 35 % de rodeo sobre la
  distancia en línea recta.

## El hallazgo

Con el dato real, un cubo de resto de Carabanchel recibe unos 59 kg al día y su
capacidad real ronda los 413 kg: cuando el camión lo vacía, está **al 14 % de su
capacidad**. Madrid vacía muchísimo antes de que el cubo se llene. La pestaña **Llenado**
permite comparar ese servicio con un vaciado a demanda y ver cuántos vaciados semanales
haría falta de verdad.

## Estructura

```
index.html                 la web entera (una página, sin build, sin dependencias propias)
datos/red.json             inventario limpio: recipientes, islas, distritos, lotes (1,8 MB)
datos/toneladas.json       tonelajes por fracción/distrito/mes/año + parámetros del modelo
fuentes/01-descargar.py    descarga los CSV originales a crudo/
fuentes/02-construir.py    construye datos/*.json desde crudo/
fuentes/03-verificar.py    21 comprobaciones sobre los ficheros publicados
fuentes/04-verificar-navegador.py  mide la web real en Chromium headless (31 comprobaciones)
VERIFICACION.md            informe de la verificación de datos
VERIFICACION-NAVEGADOR.md  informe de la verificación en navegador
```

## Reproducir el dato

```bash
python3 fuentes/01-descargar.py     # CSV originales → crudo/
python3 fuentes/02-construir.py     # crudo/ → datos/*.json
python3 fuentes/03-verificar.py     # 21 comprobaciones
```

## Verificar la web

```bash
python3 -m http.server 8000         # y abre http://localhost:8000
```

Para la verificación automática hace falta Playwright con Chromium:

```bash
python3 fuentes/04-verificar-navegador.py
```

Mide estilos computados, el número de puntos del mapa, los KPIs contra el dato,
el filtro por distrito, el modelo de llenado en los dos modos, el planificador de
turnos y el desborde horizontal a 320, 360, 390, 768 y 1440 px.

## Diseño

Interfaz con **Aurora v8.3.0** (pineada por CDN, nunca `@master`), mapa con **MapLibre GL JS**
y cartografía base Esri Dark Gray. Los colores de los contenedores son los oficiales de la
Ordenanza 12/2022: son dato, no decoración.

## Licencias

- Datos: Ayuntamiento de Madrid, datos abiertos, **CC-BY 4.0**.
- Código: úsalo como quieras, citando el origen de los datos.

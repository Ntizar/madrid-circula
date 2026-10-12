# Verificación en navegador — Madrid Circula

Medición automática sobre la página servida por HTTP, con Chromium headless real
(Playwright). No es una impresión: cada línea es una medida que el navegador devuelve.

Generado por `fuentes/04-verificar-navegador.py`.

## Resultado de la última medición

```
       OK  hojas de estilo cargadas: 13
       OK  navbar display=flex
       OK  KPI a 28px
       OK  un único h1
       OK  atribución exacta en el pie
       OK  11 hojas de Aurora por CDN pineado
       OK  mapa con 6 capas y fuente de 44069 recipientes
       OK  islas: 14282 · fracciones: 5
       OK  KPI cont = 44.069
       OK  KPI islas = 14.282
       OK  KPI t2025 = 1,19 M t
       OK  t/día generadas: 2677 t/día
       OK  5 filas de fracciones · 3 lotes · 11 flujos especiales
       OK  serie mensual con 12 meses
       OK  ranking con 21 distritos
       OK  heatmap con 60 celdas
       OK  donut con 5 segmentos y leyenda de 5
       OK  color del primer tipo en el mapa: #6b7280
       OK  filtro Carabanchel + Resto: 1842 recipientes · 2984850 L
       OK  servicio a 48 h = instante post-vaciado: medio 0 % (coherente)
       OK  llenado a demanda a 12 h: medio 8.7 % · 0 sobre el 80 %
       OK  turnos planificados: 3 · 1054 paradas · 96 km · 109081 kg
       OK  tabla de recorridos con 3 filas
       OK  geometría de rutas en el mapa: 3 líneas, 1054 paradas
       OK  ficha del punto con 3 cubos
       OK  sin desborde a 320px (scrollWidth 320 = clientWidth 320)
       OK  sin desborde a 360px (scrollWidth 360 = clientWidth 360)
       OK  sin desborde a 390px (scrollWidth 390 = clientWidth 390)
       OK  sin desborde a 768px (scrollWidth 768 = clientWidth 768)
       OK  sin desborde a 1440px (scrollWidth 1440 = clientWidth 1440)
       OK  sin errores de consola (4 avisos)
    
    == RESUMEN ==
       comprobaciones superadas: 31
       fallos: 0
       avisos: 0
    EXIT=0
```

## Qué se mide y por qué

| Bloque | Qué comprueba |
|---|---|
| Design system | Que las 11 hojas de Aurora estén enlazadas por CDN pineado, que los estilos se apliquen de verdad (`getComputedStyle`: navbar en flex, KPI a 28 px), un solo `h1` y la atribución exacta. |
| Mapa | Número de capas y de recipientes cargados en la fuente de datos. |
| KPIs | Los valores de cabecera contra el dato: 44.069 recipientes, 14.282 puntos, 1,19 M t. |
| Gráficos y tablas | 12 meses en la serie, 21 distritos en el ranking, 60 celdas en el mapa de calor, 5 segmentos en el donut. |
| Filtro | Distrito + fracción contra el valor recalculado de forma independiente sobre `datos/red.json` (1.842 recipientes de resto en Carabanchel, 2.984.850 litros). |
| Modelo de llenado | Los dos modos: ciclo de servicio (a 48 h el cubo acaba de vaciarse, diente de sierra de 24 h) y vaciado a demanda. |
| Turnos | Que el planificador produzca rutas con paradas, kilómetros y kilos, y que la geometría llegue al mapa. |
| Ficha | Que pinchar un punto de recogida devuelva sus cubos con capacidad y llenado. |
| Móvil | Desborde horizontal a 320, 360, 390, 768 y 1440 px comparando `scrollWidth` con `clientWidth`. |
| Consola | Que no haya errores de JavaScript ni fallos de red. |

## Cómo repetirla

```bash
python3 -m http.server 8000     # sirve la carpeta
python3 fuentes/04-verificar-navegador.py
```

En una máquina sin las librerías de Chromium, el script busca las que deja
`~/.local/lib/chrome-libs.sh` (extrae los `.deb` de Ubuntu sin root y apunta
`LD_LIBRARY_PATH`). Sin eso, Playwright no arranca.

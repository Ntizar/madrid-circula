# Madrid Circula

Gemelo digital de la recogida de residuos de Madrid: los **44 069 recipientes reales** del
inventario municipal sobre el mapa, las **1 187 170 toneladas** reales de 2025 repartidas por
distrito y fracción, un modelo de llenado calibrado con esos mismos datos y una **aplicación
de gestión** para planificar las rutas, asignarlas, ejecutarlas y cerrar el parte con los kilos.

Todo el dato de partida es abierto y oficial del Ayuntamiento de Madrid (CC-BY 4.0).

Hecho con ❤️ por David Antizar

---

## Las tres caras

| Cara | Qué es | Dónde vive |
|---|---|---|
| **Web pública** | El gemelo digital explicado: fracción, llenado, turnos y balance. Sin registro. | GitHub Pages (`index.html`) |
| **App de gestión** | Rutas planificadas, asignadas, en curso y cerradas, con partes y kilos reales. Con usuarios y roles. | `api/` + `panel/` (misma API, mismo origen) |
| **Sala de control** | El día entero de un vistazo: rutas sobre el mapa, avance, kilos por fracción, tendencia y carga media. | dentro de `panel/` |

**La demo está publicada y se puede ver sin instalar nada:**
**https://ntizar.github.io/madrid-circula/demo/** — es el mismo panel, con una captura real de
la API y sin backend detrás. Se navega entero (sala, rutas, detalle, gráficos, mapa con
cartografía del IGN) pero **no escribe**: planificar, asignar o cerrar se rechaza explicando
por qué. Para ver la gestión de verdad hay que levantar la API (abajo).

### Web pública

| Cara | Qué enseña |
|---|---|
| **Fracción** | Los 44 069 recipientes con el color oficial de su contenedor. Filtros por distrito, lote y tipo de carga. Pincha un punto y sale su ficha. |
| **Llenado** | El modelo de llenado hora a hora: ciclo de servicio real o vaciado a demanda (umbral 80 %). |
| **Turnos** | Planificador sobre la geometría real: fracción, distrito, camiones y caja. Con los camiones moviéndose por el mapa. |
| **Balance** | Serie mensual 2017-2026 por fracción, los 21 distritos, mapa de intensidad mes a mes, los 3 lotes y 11 flujos especiales. |

### App de gestión (usuarios y roles)

Cuatro roles con permisos reales: **admin** (todo, cuentas y auditoría), **planificador**
(crea y asigna rutas), **conductor** (solo ve las suyas: iniciar, marcar paradas con
incidencia y cerrar con los kilos) e **invitado** (mirar). Una ruta vive su ciclo
`borrador → asignada → en_curso → cerrada`, y todo queda en auditoría.

### Sala de control

Ocho indicadores del día, todas las rutas dibujadas juntas sobre el mapa (parada hecha en
verde, pendiente en el color de su fracción), lista de rutas con su barra de avance, kilos
por fracción, reparto del día en donut, tendencia de los últimos 14 días y **carga media por
fracción**. Con **modo directo**: los camiones avanzan por su recorrido.

## Qué es real y qué es modelado

Esta es la parte que casi nunca se cuenta, así que está dentro del propio producto.

**Real, del dataset oficial**
- Los 44 069 recipientes: fracción, modelo, capacidad, lote, distrito, barrio y coordenada.
- Los 14 282 puntos de recogida (islas) y las direcciones.
- Las toneladas por residuo, distrito, barrio y mes: 114 meses, de 2017 a 2026.
- Los kilos que cierra cada conductor en su parte, los km y las paradas de cada ruta.

**Modelado, con los parámetros declarados a la vista**
- **Llenado** de cada cubo: no es dato público (los sensores son plataforma privada).
- **Kilos previstos** de una ruta: las toneladas reales del distrito repartidas entre sus
  contenedores reales. No es una medición.
- **Carga media**: kg/día reales ÷ litros reales del inventario ÷ densidad declarada
  (Resto 0,30 · PMB 0,045 · Papel-Cartón 0,12 · Orgánica 0,45 · Vidrio 0,50 kg/l, meses de
  referencia 2026-04 a 2026-06), suponiendo que la recogida del día vacía el contenedor.
- **Rutas**: vecino más cercano con mejora 2-opt sobre la geometría real. No son las del operador.
- **Tiempos**: 16 km/h de media urbana y 95 s por parada.
- **Posición de los camiones**: no hay GPS público. El modo directo avanza cada camión por su
  orden de paradas: es una reconstrucción, no telemetría.

## El hallazgo

Con el dato real, un cubo de resto de Carabanchel recibe unos 59 kg al día y su capacidad real
ronda los 413 kg: cuando el camión lo vacía, está **al 14 % de su capacidad**. Madrid vacía
muchísimo antes de que el cubo se llene. La pestaña **Llenado** permite comparar ese servicio
con un vaciado a demanda.

## Estructura

```
index.html                 la web pública entera (una página, sin build, sin dependencias propias)
datos/red.json             inventario limpio: recipientes, islas, distritos, lotes (1,8 MB)
datos/toneladas.json       tonelajes por fracción/distrito/mes/año + parámetros del modelo
fuentes/01-descargar.py    descarga los CSV originales a crudo/
fuentes/02-construir.py    construye datos/*.json desde crudo/
fuentes/03-verificar.py    21 comprobaciones sobre los ficheros publicados
fuentes/04-verificar-navegador.py  mide la web real en Chromium headless (33 comprobaciones)

api/esquema.sql            esquema SQLite: islas, contenedores, rutas, paradas, partes, usuarios, auditoría
api/importar.js            carga datos/*.json en la base
api/servidor.js            la API y los estáticos del panel (node:http y node:sqlite, sin dependencias)
api/pruebas/api.test.js    peticiones HTTP de verdad contra un servidor de verdad (27 pruebas)

panel/index.html           el panel: acceso, rutas, detalle, kilos, administración y sala de control
panel/app.js               el panel, DOM a pelo (sin librerías de interfaz)
panel/panel.css            solo pegamento de maquetación: el resto es Aurora
panel/pruebas/verificar-panel.py   recorre el ciclo completo en navegador real (31 comprobaciones)

demo/index.html            la demo publicada: generada desde panel/index.html, no se toca a mano
demo/shim.js               el sustituto de fetch: sirve la captura y rechaza las escrituras
demo/api/datos.json        la captura de la API (instantánea de un día de trabajo)
demo/pruebas/verificar-demo.py     la demo se comprueba sola en navegador real (16 comprobaciones)
api/capturar-demo.js      genera la captura y la demo a partir del panel de verdad
```

## Reproducir el dato

```bash
python3 fuentes/01-descargar.py     # CSV originales → crudo/
python3 fuentes/02-construir.py     # crudo/ → datos/*.json
python3 fuentes/03-verificar.py     # 21 comprobaciones
```

## Levantar la web pública

```bash
python3 -m http.server 8000         # y abre http://localhost:8000
```

## Levantar la app de gestión

Hace falta **Node 24 o superior** (usa `node:sqlite`, así que no hay nada que instalar ni compilar).

```bash
node api/importar.js                # mete los datos reales en la base (14 282 islas, 44 069 contenedores)
MC_ADMIN_EMAIL=tu@correo MC_ADMIN_CLAVE=una-clave-larga node api/servidor.js
```

La primera vez crea la cuenta de administrador con esas variables y la imprime por consola
**una sola vez**. A partir de ahí se entra en `http://localhost:3000`, que sirve el panel desde
el mismo origen que la API (sin líos de cookies).

```bash
MC_PUERTO=3000                      # puerto (por defecto 3000)
MC_DB=ruta/a/la.db                  # base de datos (por defecto api/madrid-circula.db)
MC_ORIGENES=https://tu-web          # orígenes permitidos si el panel va en otro sitio
MC_SESION_HORAS=12                  # duración de la sesión
```

## Verificar

```bash
python3 fuentes/04-verificar-navegador.py   # la web pública, en Chromium headless
node --test api/pruebas/api.test.js         # la API: 27 pruebas con peticiones reales
python3 panel/pruebas/verificar-panel.py    # el panel: recorre el ciclo completo como una persona
python3 demo/pruebas/verificar-demo.py      # la demo publicada: que lea sí y que escribir no
```

Para rehacer la instantánea publicada (con otra fecha, o cuando cambie el panel):

```bash
node api/capturar-demo.js    # monta un día de trabajo real y regenera demo/
```

El arnés del panel entra, planifica, asigna, entra como conductor, inicia, marca una parada,
cierra y luego mira la sala como admin: comprueba que los gráficos cuadren con los datos, que
el mapa pida cartografía del IGN, que el camión se mueva en modo directo y que nada se desborde
a 360 px.

## Diseño

Interfaz con **Aurora v8.4.2** (pineada por CDN, nunca `@master`) y su **tema claro**, siguiendo
la receta canónica de dashboard. Mapa con **MapLibre GL JS** y cartografía base del **IGN**
(Instituto Geográfico Nacional, CC BY 4.0), con selector de gris, topográfico y ortofoto.
Ningún color a mano en la interfaz: todo sale de tokens, y los colores de los contenedores son
los oficiales de la Ordenanza 12/2022 porque son dato, no decoración.

## Licencias

- Datos: Ayuntamiento de Madrid, datos abiertos, **CC-BY 4.0**.
- Cartografía: IGN, **CC BY 4.0**.
- Código: úsalo como quieras, citando el origen de los datos.

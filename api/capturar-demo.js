// Captura una instantánea REAL de la API para publicar la demo estática del panel.
//
//   node api/capturar-demo.js
//
// Monta una base temporal con los datos reales del Ayuntamiento, construye un día de trabajo
// creíble (las cinco fracciones, distritos distintos, rutas asignadas, una en curso, dos
// cerradas con parte y una en otro día para que la tendencia tenga más de un punto) y guarda
// las respuestas de la API que necesita el panel en demo/api/datos.json.
//
// Además genera demo/index.html copiando el panel de verdad y colándole demo/shim.js: es el
// MISMO panel, con el suelo cambiado por debajo. Así la demo no se puede desviar del panel.
//
// Lo único que no es real en la instantánea son los partes de kilos de las rutas cerradas:
// se generan alrededor del modelo (es lo que haría un conductor en la calle), y la propia
// demo lo dice en su cartel.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crearServidor, crearUsuario } from "./servidor.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");
const TMP = mkdtempSync(join(tmpdir(), "mc-demo-"));
const RUTA_DB = join(TMP, "demo.db");
const SALIDA = join(RAIZ, "demo");

const DIA = new Date().toISOString().slice(0, 10);
const OTRO_DIA = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const DESDE = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

/** Distritos candidatos por fracción: se prueba el primero y, si no hay contenedores, el siguiente. */
const CANDIDATOS = {
  "Resto": ["Carabanchel", "Puente de Vallecas", "Latina"],
  "Papel-Cartón": ["Salamanca", "Chamberí", "Centro"],
  "Vidrio": ["Centro", "Salamanca", "Chamberí"],
  "Orgánica": ["Latina", "Carabanchel", "Puente de Vallecas"],
  "PMB": ["Tetuán", "Centro", "Salamanca"]
};

function diario(texto) { console.log("  " + texto); }

// ── base con los datos reales ────────────────────────────────────────────────
diario("cargando los datos reales en una base temporal…");
execFileSync(process.execPath, [join(AQUI, "importar.js"), RUTA_DB], { stdio: "pipe" });

const app = crearServidor({ rutaDb: RUTA_DB, origenes: "https://ntizar.github.io" });
await new Promise((listo) => app.servidor.listen(0, listo));
const BASE = `http://127.0.0.1:${app.servidor.address().port}`;

function cliente() {
  let cookie = "";
  return {
    async pide(metodo, ruta, cuerpo) {
      const r = await fetch(BASE + ruta, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
      });
      const puestas = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      const sesion = puestas.find((c) => c.startsWith("mc_sesion="));
      if (sesion) cookie = sesion.split(";")[0];
      let datos = null;
      try { datos = await r.json(); } catch { datos = null; }
      return { estado: r.status, datos };
    }
  };
}

// ── gente ────────────────────────────────────────────────────────────────────
// Nombres de mentira, que esto se publica.
crearUsuario(app.db, { email: "direccion@madrid-circula.demo", nombre: "Dirección de Servicio", rol: "admin", clave: "clave-de-la-demo" });
const ANA = crearUsuario(app.db, { email: "ana@madrid-circula.demo", nombre: "Ana Conduce", rol: "conductor", clave: "clave-de-la-demo" });
const BRUNO = crearUsuario(app.db, { email: "bruno@madrid-circula.demo", nombre: "Bruno Rueda", rol: "conductor", clave: "clave-de-la-demo" });
crearUsuario(app.db, { email: "pili@madrid-circula.demo", nombre: "Pili Planifica", rol: "planificador", clave: "clave-de-la-demo" });
diario("cuentas de la demo creadas (nombres de mentira)");

const admin = cliente();
const entra = await admin.pide("POST", "/api/entrar", { email: "direccion@madrid-circula.demo", clave: "clave-de-la-demo" });
if (entra.estado !== 200) throw new Error("no pude entrar como admin: " + JSON.stringify(entra.datos));

const plan = cliente();
await plan.pide("POST", "/api/entrar", { email: "pili@madrid-circula.demo", clave: "clave-de-la-demo" });

// ── un día de trabajo de verdad ──────────────────────────────────────────────
const turnos = ["mañana", "mañana", "tarde", "noche", "mañana"];
const camiones = ["MAD-4411", "MAD-4412", "MAD-4413", "MAD-4414", "MAD-4415"];
const creadas = [];

let n = 0;
for (const [fraccion, distritos] of Object.entries(CANDIDATOS)) {
  let hecha = null;
  for (const distrito of distritos) {
    const r = await plan.pide("POST", "/api/rutas", {
      fecha: DIA, turno: turnos[n], fraccion, distrito, camion: camiones[n]
    });
    if (r.estado === 201) { hecha = r.datos; break; }
  }
  if (!hecha) { diario(`¡ojo! no pude planificar ${fraccion} en ningún distrito candidato`); continue; }
  diario(`planificada ${fraccion} en ${hecha.distrito}: ${hecha.paradas.length} paradas, ${hecha.kg_previstos} kg`);
  creadas.push(hecha);
  n++;
}

if (creadas.length < 4) throw new Error(`solo pude crear ${creadas.length} rutas: revisa los candidatos`);

// Rutas en días anteriores, para que la tendencia de 14 días tenga varios puntos. Se cierran
// también, así la serie de kilos tiene más de un día. Los distritos van por orden de intento:
// no todos los distritos tienen contenedores de todas las fracciones (lo dice la API).
const extraCerradas = [];
const otros = [
  { dias: 3, fraccion: "Resto", distritos: ["Carabanchel", "Puente de Vallecas", "Latina"] },
  { dias: 6, fraccion: "Vidrio", distritos: ["Centro", "Salamanca", "Chamberí"] }
];
for (const o of otros) {
  const fecha = new Date(Date.now() - o.dias * 86400000).toISOString().slice(0, 10);
  let hecha = null;
  for (const distrito of o.distritos) {
    const r = await plan.pide("POST", "/api/rutas", { fecha, turno: "mañana", fraccion: o.fraccion, distrito, camion: "MAD-4416" });
    if (r.estado === 201) { hecha = r.datos; break; }
  }
  if (!hecha) { diario(`¡ojo! no pude planificar ${o.fraccion} para el ${fecha}`); continue; }
  diario(`planificada ${o.fraccion} en ${hecha.distrito} el ${fecha}: ${hecha.paradas.length} paradas, ${hecha.kg_previstos} kg`);
  extraCerradas.push({ ruta: hecha, conductor: BRUNO, ejecutar: "cerrar" });
}

// Asignar: dos a cada conductor, salvo una que se queda sin asignar (estado borrador).
const reparto = [
  { ruta: creadas[0], conductor: ANA, ejecutar: true },   // en curso, con paradas hechas
  { ruta: creadas[1], conductor: BRUNO, ejecutar: "cerrar" },
  { ruta: creadas[2], conductor: ANA, ejecutar: "cerrar" },
  { ruta: creadas[3], conductor: BRUNO, ejecutar: false },
  { ruta: creadas[4], conductor: null, ejecutar: false }
];

for (const paso of reparto.concat(extraCerradas)) {
  if (paso.conductor) {
    const a = await plan.pide("POST", `/api/rutas/${paso.ruta.id}/asignar`, { conductor_id: paso.conductor });
    if (a.estado !== 200) diario(`¡ojo! no pude asignar la ruta ${paso.ruta.id}: ${JSON.stringify(a.datos)}`);
  }
  if (!paso.ejecutar) continue;

  const quien = paso.conductor === ANA ? "ana" : "bruno";
  const cond = cliente();
  await cond.pide("POST", "/api/entrar", { email: `${quien}@madrid-circula.demo`, clave: "clave-de-la-demo" });
  const inicio = await cond.pide("POST", `/api/rutas/${paso.ruta.id}/iniciar`);
  if (inicio.estado !== 200) { diario(`¡ojo! no pude iniciar la ruta ${paso.ruta.id}: ${JSON.stringify(inicio.datos)}`); continue; }

  const detalle = await cond.pide("GET", `/api/rutas/${paso.ruta.id}`);
  const paradas = detalle.datos.paradas;

  if (paso.ejecutar === true) {
    // Se queda en curso: unas cuantas paradas hechas y una incidencia de verdad.
    const cuantas = Math.max(3, Math.round(paradas.length * 0.4));
    for (let i = 0; i < cuantas; i++) {
      const incidencia = i === 1 ? { tipo: "contenedor_lleno", texto: "Desbordado, no entra todo" } : null;
      await cond.pide("POST", `/api/rutas/${paso.ruta.id}/paradas/${paradas[i].id}`, { hecha: true, incidencia });
    }
    diario(`ruta ${paso.ruta.id} en curso con ${cuantas} de ${paradas.length} paradas hechas y una incidencia`);
  } else {
    // Se cierra con un parte: los kilos que habría cantado el conductor, alrededor del modelo.
    const temblor = 1 + ((paso.ruta.id % 11) - 5) / 100;   // entre -5 % y +5 %, siempre el mismo
    const kg = Math.round(paso.ruta.kg_previstos * temblor);
    for (const p of paradas) await cond.pide("POST", `/api/rutas/${paso.ruta.id}/paradas/${p.id}`, { hecha: true });
    const cierre = await cond.pide("POST", `/api/rutas/${paso.ruta.id}/cerrar`, {
      kg_fraccion: kg,
      observaciones: paso.ruta.id % 3 === 0 ? "Sin novedad" : "Un contenedor de difícil acceso"
    });
    if (cierre.estado === 200) {
      diario(`ruta ${paso.ruta.id} cerrada: ${kg} kg (${cierre.datos.parte.desvio_pct > 0 ? "+" : ""}${cierre.datos.parte.desvio_pct} % sobre lo previsto)`);
    } else {
      diario(`¡ojo! no pude cerrar la ruta ${paso.ruta.id}: ${JSON.stringify(cierre.datos)}`);
    }
  }
}

// ── la captura ───────────────────────────────────────────────────────────────
diario("capturando las respuestas de la API…");
const rutas = await admin.pide("GET", `/api/rutas?desde=${DESDE}&hasta=${DIA}`);
if (rutas.estado !== 200) throw new Error("no pude leer la lista de rutas");

const porId = {};
for (const r of rutas.datos.rutas) {
  const una = await admin.pide("GET", `/api/rutas/${r.id}`);
  if (una.estado === 200) porId[r.id] = una.datos;
}

const capturas = {
  capturado: DIA,
  fecha: DIA,
  yo: (await admin.pide("GET", "/api/yo")).datos,
  salud: (await admin.pide("GET", "/api/salud")).datos,
  marco: (await admin.pide("GET", "/api/marco")).datos,
  sala: (await admin.pide("GET", `/api/sala?fecha=${DIA}&dias=14`)).datos,
  rutas: rutas.datos,
  kilos: (await admin.pide("GET", `/api/kilos/resumen?desde=${DESDE}&hasta=${DIA}`)).datos,
  red: (await admin.pide("GET", "/api/red/resumen")).datos,
  usuarios: (await admin.pide("GET", "/api/usuarios")).datos,
  auditoria: (await admin.pide("GET", "/api/auditoria")).datos,
  conductores: (await admin.pide("GET", "/api/conductores")).datos,
  rutasPorId: porId
};

const s = capturas.sala;
if (!s || !s.kpis || s.kpis.rutas < 4) throw new Error("la sala de la captura sale pobre: " + JSON.stringify(s && s.kpis));
diario(`sala del ${DIA}: ${s.kpis.rutas} rutas · ${s.kpis.paradas} paradas · ${s.kpis.kg_previstos} kg previstos`);

// ── escribir la demo ─────────────────────────────────────────────────────────
mkdirSync(join(SALIDA, "api"), { recursive: true });
const destino = join(SALIDA, "api", "datos.json");
writeFileSync(destino, JSON.stringify(capturas));
diario(`escrito ${destino} (${(JSON.stringify(capturas).length / 1024).toFixed(0)} kB)`);

// El índice de la demo es el panel de verdad con las rutas de los ficheros cambiadas y el
// sustituto de fetch delante. Se regenera en cada captura: no hay copia que mantener.
let html = readFileSync(join(RAIZ, "panel", "index.html"), "utf8");
if (!html.includes('href="panel.css"') || !html.includes('src="app.js"')) {
  throw new Error("el panel cambió de nombres de fichero: revisa este generador");
}
html = html.replace(/href="panel\.css"/g, 'href="../panel/panel.css"');
html = html.replace(/src="app\.js"/g, 'src="../panel/app.js"');
html = html.replace('<script src="../panel/app.js"></script>',
  '<script src="shim.js"></script>\n  <script src="../panel/app.js"></script>');
html = html.replace("</head>",
  '  <meta name="robots" content="noindex">\n' +
  "  <!-- Generado por api/capturar-demo.js desde panel/index.html: no editar a mano. -->\n</head>");
writeFileSync(join(SALIDA, "index.html"), html);
diario("escrito demo/index.html (el panel de verdad, con el sustituto de fetch delante)");

app.cerrar();
rmSync(TMP, { recursive: true, force: true });

console.log(`
Instantánea lista. Para verla en local:
  python3 -m http.server 8000     →  http://localhost:8000/demo/

En cuanto se suba a GitHub Pages, la demo vive en:
  https://ntizar.github.io/madrid-circula/demo/
`);

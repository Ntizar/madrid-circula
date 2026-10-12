#!/usr/bin/env node
// Importa los datos REALES del Ayuntamiento (datos/red.json + datos/toneladas.json) a SQLite.
//
//   node api/importar.js [ruta-de-la-base]
//
// Reescribe solo las tablas de datos reales; usuarios, rutas y partes NO se tocan.
// Al terminar imprime lo que ha metido, para poder contrastarlo con la verdad conocida
// (44.069 contenedores · 14.282 islas · 21 distritos).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");
const RUTA_DB = process.argv[2] ? resolve(process.argv[2]) : join(AQUI, "madrid-circula.db");

const red = JSON.parse(readFileSync(join(RAIZ, "datos", "red.json"), "utf8"));
const ton = JSON.parse(readFileSync(join(RAIZ, "datos", "toneladas.json"), "utf8"));

mkdirSync(dirname(RUTA_DB), { recursive: true });
const db = new DatabaseSync(RUTA_DB);
db.exec(readFileSync(join(AQUI, "esquema.sql"), "utf8"));

const FR = red.fracciones;
const MODELOS = red.modelos;
const LITROS = red.litros;
const CARGAS = red.cargas;
const LOTES = red.lotes;
const DIRS = red.direcciones;

db.exec("BEGIN");
for (const t of ["contenedores", "islas", "kg_dia", "serie_mes", "meta"]) db.exec(`DELETE FROM ${t}`);

// ── 1 · islas y contenedores, partiendo de los puntos reales ──────────────────
const porIsla = new Map();
for (const [ii, fi, li, mi, ci] of red.puntos) {
  if (!porIsla.has(ii)) porIsla.set(ii, { n: 0, litros: 0, fracs: new Set() });
  const a = porIsla.get(ii);
  a.n += 1;
  a.litros += LITROS[mi] || 0;
  a.fracs.add(FR[fi]);
  void li; void ci;
}

const insIsla = db.prepare(
  "INSERT INTO islas (id,distrito,direccion,lat,lon,contenedores,litros,fracciones) VALUES (?,?,?,?,?,?,?,?)"
);
let nIslas = 0;
for (const [ii, a] of porIsla) {
  const [codigo, lat, lon, distrito, iDir, mascara] = red.islas[ii];
  void mascara;
  insIsla.run(codigo, distrito, DIRS[iDir] || null, lat, lon, a.n, a.litros, [...a.fracs].sort().join(","));
  nIslas += 1;
}

const insCont = db.prepare(
  "INSERT INTO contenedores (id,isla_id,fraccion,modelo,carga,lote,litros,distrito,lat,lon) VALUES (?,?,?,?,?,?,?,?,?,?)"
);
const cuentaIsla = new Map();
let nCont = 0;
for (const [ii, fi, li, mi, ci] of red.puntos) {
  const [codigo, lat, lon, distrito] = red.islas[ii];
  const k = (cuentaIsla.get(ii) || 0);
  cuentaIsla.set(ii, k + 1);
  insCont.run(`${codigo}#${k}`, codigo, FR[fi], MODELOS[mi] || null, CARGAS[ci] || null,
    LOTES[li] == null ? null : String(LOTES[li]), LITROS[mi] || 0, distrito, lat, lon);
  nCont += 1;
}

// ── 2 · kg/día por distrito y fracción (derivados de toneladas reales) ────────
// El origen puede venir como {distrito: {fraccion: numero}} o anidado con un objeto.
function paresKgDia(obj) {
  const salida = [];
  for (const [distrito, valor] of Object.entries(obj || {})) {
    if (!valor || typeof valor !== "object") continue;
    for (const [frac, v] of Object.entries(valor)) {
      const kg = typeof v === "number" ? v
        : (v && typeof v.kg === "number") ? v.kg
          : (v && typeof v.kg_dia === "number") ? v.kg_dia : null;
      if (kg !== null && Number.isFinite(kg)) salida.push([distrito, frac, kg]);
    }
  }
  return salida;
}
const insKg = db.prepare("INSERT OR REPLACE INTO kg_dia (distrito,fraccion,kg_dia) VALUES (?,?,?)");
let nKg = 0;
for (const [d, f, kg] of paresKgDia(ton.modelo?.kg_dia_distrito_fraccion)) {
  insKg.run(d, f, kg);
  nKg += 1;
}

// ── 3 · serie mensual real (ciudad) ──────────────────────────────────────────
const insSerie = db.prepare("INSERT OR REPLACE INTO serie_mes (mes,fraccion,kg) VALUES (?,?,?)");
let nSerie = 0;
for (const [frac, valores] of Object.entries(ton.serie || {})) {
  if (!Array.isArray(valores)) continue;
  valores.forEach((v, i) => {
    if (typeof v === "number" && ton.fechas[i]) { insSerie.run(ton.fechas[i], frac, v); nSerie += 1; }
  });
}

// ── 4 · metadatos: lo que la web ya sabe interpretar, tal cual ───────────────
const insMeta = db.prepare("INSERT OR REPLACE INTO meta (clave,valor) VALUES (?,?)");
const metas = {
  generado: red.generado, fuente: red.fuente, licencia: red.licencia,
  fracciones: FR, colores: red.colores, distritos: red.distritos,
  modelos: MODELOS, litros: LITROS, cargas: CARGAS, lotes: LOTES,
  resumen: red.resumen, unidad_toneladas: ton.unidad, fechas: ton.fechas,
  anual: ton.anual, por_distrito: ton.por_distrito, etiquetas: ton.etiquetas,
  modelo_llenado: ton.modelo,
  parametros: ton.modelo   // velocidad, segundos por parada y capacidades: dueño único
};
for (const [clave, valor] of Object.entries(metas)) insMeta.run(clave, JSON.stringify(valor));
db.exec("COMMIT");

console.log(`base: ${RUTA_DB}`);
console.log(`  islas:        ${nIslas}`);
console.log(`  contenedores: ${nCont}`);
console.log(`  kg_dia:       ${nKg} filas (distrito × fracción)`);
console.log(`  serie_mes:    ${nSerie} filas (${(ton.fechas || []).length} meses x ${Object.keys(ton.serie || {}).length} fracciones)`);
console.log(`  meta:         ${Object.keys(metas).length} bloques`);
const reparto = db.prepare("SELECT fraccion, COUNT(*) n FROM contenedores GROUP BY fraccion ORDER BY n DESC").all();
console.log("  reparto:", reparto.map((r) => `${r.fraccion}=${r.n}`).join(" · "));

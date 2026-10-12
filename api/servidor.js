#!/usr/bin/env node
// MADRID CIRCULA · API de gestión de rutas de recogida de residuos.
//
// Sin dependencias: node:http + node:sqlite + node:crypto. Arranca con `node api/servidor.js`.
//
// Roles: admin (todo) > planificador (crea y asigna rutas) > conductor (ejecuta y cierra
// sus rutas) > invitado (solo lectura). El estado de una ruta manda: borrador → asignada →
// en_curso → cerrada; una ruta cerrada ya no se toca.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");
const VERSION = "1.0.0";

const NIVEL = { invitado: 0, conductor: 1, planificador: 2, admin: 3 };

class ErrorHttp extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

// ── utilidades ────────────────────────────────────────────────────────────────
/** Crea una cuenta. Único sitio donde se hashea una contraseña: lo usan la API y el arranque. */
export function crearUsuario(db, { email, nombre, rol, clave }) {
  const sal = randomBytes(16).toString("hex");
  const r = db.prepare(
    "INSERT INTO usuarios (email,nombre,rol,hash,sal,activo,creado_en) VALUES (?,?,?,?,?,1,?)"
  ).run(email, nombre, rol, hashear(clave, sal), sal, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function haversine(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function rutaKm(paradas) {
  let km = 0;
  for (let i = 1; i < paradas.length; i++) km += haversine(paradas[i - 1], paradas[i]);
  return km;
}

/** Vecino más cercano desde el centroide + 2-opt: heurístico declarado, no pretendo óptimo. */
function ordenar(paradas) {
  if (paradas.length < 3) return paradas.slice();
  const cx = paradas.reduce((s, p) => s + p.lat, 0) / paradas.length;
  const cy = paradas.reduce((s, p) => s + p.lon, 0) / paradas.length;
  const restantes = paradas.slice();
  const orden = [];
  let actual = { lat: cx, lon: cy };
  while (restantes.length) {
    let mejor = 0;
    let mejorD = Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const d = haversine(actual, restantes[i]);
      if (d < mejorD) { mejorD = d; mejor = i; }
    }
    actual = restantes[mejor];
    orden.push(restantes.splice(mejor, 1)[0]);
  }
  for (let mejora = 0; mejora < 12; mejora++) {
    let cambiado = false;
    for (let i = 1; i < orden.length - 2; i++) {
      for (let j = i + 1; j < orden.length - 1; j++) {
        const a = orden[i - 1], b = orden[i], c = orden[j], d = orden[j + 1];
        if (haversine(a, c) + haversine(b, d) + 0.0001 < haversine(a, b) + haversine(c, d)) {
          const trozo = orden.splice(i, j - i + 1).reverse();
          orden.splice(i, 0, ...trozo);
          cambiado = true;
        }
      }
    }
    if (!cambiado) break;
  }
  return orden;
}

function hashear(clave, sal) {
  return scryptSync(String(clave), sal, 64).toString("hex");
}
function iguales(a, b) {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
const ahora = () => new Date().toISOString();

// ── servidor ──────────────────────────────────────────────────────────────────
export function crearServidor(opciones = {}) {
  const rutaDb = opciones.rutaDb || process.env.MC_DB || join(AQUI, "madrid-circula.db");
  const origenes = (opciones.origenes || process.env.MC_ORIGENES ||
    "https://ntizar.github.io,http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim());
  const horasSesion = Number(opciones.horasSesion || process.env.MC_SESION_HORAS || 12);
  const samesite = process.env.MC_SAMESITE || (opciones.samesite ?? "Lax");
  const dirPanel = opciones.dirPanel || join(RAIZ, "panel");

  const db = new DatabaseSync(rutaDb);
  db.exec(readFileSync(join(AQUI, "esquema.sql"), "utf8"));
  const params = JSON.parse((db.prepare("SELECT valor FROM meta WHERE clave='parametros'").get() || {}).valor || "{}");
  const capacidades = params.capacidad_camion_kg || { Resto: 11000, PMB: 3200, "Papel-Cartón": 5000, "Orgánica": 9000, Vidrio: 11000 };
  const velocidad = params.velocidad_media_kmh || 16;
  const segPorParada = params.segundos_por_parada || 95;

  function anotar(usuarioId, accion, entidad, entidadId, detalle) {
    db.prepare("INSERT INTO auditoria (usuario_id,accion,entidad,entidad_id,detalle,ts) VALUES (?,?,?,?,?,?)")
      .run(usuarioId ?? null, accion, entidad ?? null, entidadId == null ? null : String(entidadId),
        detalle ? JSON.stringify(detalle) : null, ahora());
  }

  // ── sesiones y permisos ─────────────────────────────────────────────────────
  function usuarioDe(req) {
    const cabecera = req.headers.cookie || "";
    const trozo = cabecera.split(";").map((s) => s.trim()).find((s) => s.startsWith("mc_sesion="));
    if (!trozo) return null;
    const token = decodeURIComponent(trozo.slice("mc_sesion=".length));
    const fila = db.prepare(
      `SELECT u.*, s.expira_en FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token = ? AND u.activo = 1`
    ).get(token);
    if (!fila) return null;
    if (new Date(fila.expira_en).getTime() < Date.now()) {
      db.prepare("DELETE FROM sesiones WHERE token = ?").run(token);
      return null;
    }
    return { id: fila.id, email: fila.email, nombre: fila.nombre, rol: fila.rol };
  }

  function exigir(req, minimo) {
    const u = usuarioDe(req);
    if (!u) throw new ErrorHttp(401, "Hace falta entrar con tu cuenta");
    if (NIVEL[u.rol] < NIVEL[minimo]) {
      throw new ErrorHttp(403, `Tu rol (${u.rol}) no permite esta acción`,
        { hace_falta: minimo, tienes: u.rol });
    }
    return u;
  }

  // ── planificación ───────────────────────────────────────────────────────────
  /**
   * Elige islas reales del distrito con contenedores de esa fracción y las ordena.
   * Los kg por isla se derivan de las toneladas REALES del distrito: kg/día del distrito
   * repartidos entre los contenedores de esa fracción que hay en él. Nada al azar.
   */
  function planificar({ distrito, fraccion, fecha, turno, maxIslas, conductorId }) {
    const islas = db.prepare(
      `SELECT i.id, i.distrito, i.direccion, i.lat, i.lon, COUNT(c.id) contenedores, COALESCE(SUM(c.litros),0) litros
       FROM islas i JOIN contenedores c ON c.isla_id = i.id
       WHERE c.fraccion = ? AND (? IS NULL OR i.distrito = ?)
       GROUP BY i.id ORDER BY i.id`
    ).all(fraccion, distrito ?? null, distrito ?? null);
    if (!islas.length) throw new ErrorHttp(400, `No hay contenedores de ${fraccion} en ${distrito || "Madrid"}`);

    const yaHechas = new Set(db.prepare(
      `SELECT p.isla_id FROM paradas p JOIN rutas r ON r.id = p.ruta_id
       WHERE r.fecha = ? AND r.turno = ? AND r.fraccion = ? AND r.estado != 'anulada'`
    ).all(fecha, turno, fraccion).map((f) => f.isla_id));

    const totalCont = islas.reduce((s, i) => s + i.contenedores, 0);
    const kgDia = (db.prepare("SELECT kg_dia FROM kg_dia WHERE distrito = ? AND fraccion = ?").get(distrito, fraccion) || {}).kg_dia || 0;
    const kgPorContenedor = totalCont ? kgDia / totalCont : 0;
    let tope = capacidades[fraccion] || 8000;
    if (maxIslas) tope = Infinity;

    const candidatas = [];
    let acumulado = 0;
    for (const i of islas) {
      if (yaHechas.has(i.id)) continue;
      const kg = kgPorContenedor * i.contenedores;
      candidatas.push({ ...i, kg_previstos: kg });
      acumulado += kg;
      if (kg > 0 && acumulado >= tope) break;
      if (maxIslas && candidatas.length >= maxIslas) break;
    }
    if (!candidatas.length) throw new ErrorHttp(400, "Todas las islas de ese distrito y fracción ya están en otra ruta de ese turno");

    const orden = ordenar(candidatas);
    const km = rutaKm(orden);
    const horas = km / velocidad + (orden.length * segPorParada) / 3600;
    return {
      paradas: orden, km,
      horas,
      contenedores: orden.reduce((s, i) => s + i.contenedores, 0),
      litros: orden.reduce((s, i) => s + i.litros, 0),
      kg: orden.reduce((s, i) => s + i.kg_previstos, 0)
    };
  }

  function leerRuta(id) {
    const ruta = db.prepare("SELECT * FROM rutas WHERE id = ?").get(id);
    if (!ruta) throw new ErrorHttp(404, "Esa ruta no existe");
    ruta.paradas = db.prepare(
      `SELECT id, orden, isla_id, direccion, lat, lon, contenedores, litros, kg_previstos, hecha, hecha_en
       FROM paradas WHERE ruta_id = ? ORDER BY orden`
    ).all(id);
    ruta.parte = db.prepare("SELECT * FROM partes WHERE ruta_id = ?").get(id) || null;
    ruta.incidencias = db.prepare(
      "SELECT id, parada_id, tipo, texto, creada_por, creada_en FROM incidencias WHERE ruta_id = ? ORDER BY id"
    ).all(id);
    return ruta;
  }

  // ── rutas HTTP ──────────────────────────────────────────────────────────────
  const rutas = [];
  const add = (metodo, patron, manejador) => rutas.push({ metodo, patron, manejador });

  add("GET", /^\/api\/salud$/, () => ({
    ok: true, version: VERSION,
    hora: ahora(),
    base: rutaDb,
    datos: {
      islas: db.prepare("SELECT COUNT(*) n FROM islas").get().n,
      contenedores: db.prepare("SELECT COUNT(*) n FROM contenedores").get().n,
      distritos: db.prepare("SELECT COUNT(DISTINCT distrito) n FROM islas").get().n,
      rutas: db.prepare("SELECT COUNT(*) n FROM rutas").get().n,
      usuarios: db.prepare("SELECT COUNT(*) n FROM usuarios").get().n
    }
  }));

  add("GET", /^\/api\/marco$/, () => {
    const leer = (c) => JSON.parse(db.prepare("SELECT valor FROM meta WHERE clave = ?").get(c).valor);
    return {
      generado: leer("generado"), fuente: leer("fuente"), licencia: leer("licencia"),
      fracciones: leer("fracciones"), colores: leer("colores"), distritos: leer("distritos"),
      resumen: leer("resumen"), parametros: params,
      turnos: ["mañana", "tarde", "noche"],
      estados: ["borrador", "asignada", "en_curso", "cerrada", "anulada"],
      roles: Object.keys(NIVEL)
    };
  });

  add("GET", /^\/api\/red\/resumen$/, () => {
    const porFraccion = db.prepare(
      "SELECT fraccion, COUNT(*) contenedores, SUM(litros) litros, COUNT(DISTINCT isla_id) islas FROM contenedores GROUP BY fraccion ORDER BY contenedores DESC"
    ).all();
    const porDistrito = db.prepare(
      "SELECT distrito, COUNT(*) contenedores, SUM(litros) litros, COUNT(DISTINCT isla_id) islas FROM contenedores GROUP BY distrito ORDER BY contenedores DESC"
    ).all();
    return { porFraccion, porDistrito };
  });

  add("GET", /^\/api\/islas$/, (req, _p, url) => {
    const q = url.searchParams;
    const limite = Math.min(Number(q.get("limite") || 500), 5000);
    const condiciones = [];
    const valores = [];
    for (const [campo, columna] of [["distrito", "i.distrito"], ["id", "i.id"]]) {
      const v = q.get(campo);
      if (v) { condiciones.push(`${columna} = ?`); valores.push(v); }
    }
    const frac = q.get("fraccion");
    if (frac) {
      condiciones.push("EXISTS (SELECT 1 FROM contenedores c WHERE c.isla_id = i.id AND c.fraccion = ?)");
      valores.push(frac);
    }
    const bbox = q.get("bbox");
    if (bbox) {
      const [o, s, e, n] = bbox.split(",").map(Number);
      condiciones.push("i.lon >= ? AND i.lat >= ? AND i.lon <= ? AND i.lat <= ?");
      valores.push(o, s, e, n);
    }
    const donde = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const filas = db.prepare(
      `SELECT i.id, i.distrito, i.direccion, i.lat, i.lon, i.contenedores, i.litros, i.fracciones
       FROM islas i ${donde} ORDER BY i.contenedores DESC LIMIT ?`
    ).all(...valores, limite);
    return { total: filas.length, islas: filas };
  });

  add("POST", /^\/api\/entrar$/, async (req, _p, _url, cuerpo, res) => {
    const email = String(cuerpo.email || "").trim();
    const clave = String(cuerpo.clave || "");
    const u = db.prepare("SELECT * FROM usuarios WHERE email = ? AND activo = 1").get(email);
    if (!u || !iguales(hashear(clave, u.sal), u.hash)) throw new ErrorHttp(401, "Email o contraseña incorrectos");
    const token = randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + horasSesion * 3600_000).toISOString();
    db.prepare("INSERT INTO sesiones (token,usuario_id,creada_en,expira_en) VALUES (?,?,?,?)")
      .run(token, u.id, ahora(), expira);
    db.prepare("UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?").run(ahora(), u.id);
    db.prepare("DELETE FROM sesiones WHERE expira_en < ?").run(ahora());
    anotar(u.id, "entrar", "usuarios", u.id, { email: u.email });
    const seguro = samesite === "None" ? "; Secure" : "";
    res.setHeader("Set-Cookie",
      `mc_sesion=${token}; HttpOnly; Path=/; SameSite=${samesite}${seguro}; Max-Age=${horasSesion * 3600}`);
    return { usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol }, expira_en: expira };
  });

  add("POST", /^\/api\/salir$/, (req, _p, _url, _c, res) => {
    const cabecera = req.headers.cookie || "";
    const trozo = cabecera.split(";").map((s) => s.trim()).find((s) => s.startsWith("mc_sesion="));
    if (trozo) db.prepare("DELETE FROM sesiones WHERE token = ?").run(decodeURIComponent(trozo.slice("mc_sesion=".length)));
    res.setHeader("Set-Cookie", "mc_sesion=; HttpOnly; Path=/; Max-Age=0");
    return { ok: true };
  });

  add("GET", /^\/api\/yo$/, (req) => {
    const u = usuarioDe(req);
    if (!u) throw new ErrorHttp(401, "No hay sesión abierta");
    return { usuario: u, permisos: Object.fromEntries(Object.entries(NIVEL).map(([r, n]) => [r, n <= NIVEL[u.rol]])) };
  });

  // ── usuarios (solo admin) ───────────────────────────────────────────────────
  add("GET", /^\/api\/usuarios$/, (req) => {
    exigir(req, "admin");
    return {
      usuarios: db.prepare(
        "SELECT id, email, nombre, rol, activo, creado_en, ultimo_acceso FROM usuarios ORDER BY id"
      ).all()
    };
  });

  add("GET", /^\/api\/conductores$/, (req) => {
    exigir(req, "planificador");
    return {
      conductores: db.prepare(
        `SELECT id, nombre, rol FROM usuarios
         WHERE activo = 1 AND rol IN ('conductor', 'planificador', 'admin') ORDER BY nombre`
      ).all()
    };
  });

  add("POST", /^\/api\/usuarios$/, (req, _p, _url, cuerpo, res) => {
    const quien = exigir(req, "admin");
    const email = String(cuerpo.email || "").trim();
    const nombre = String(cuerpo.nombre || "").trim();
    const rol = String(cuerpo.rol || "invitado");
    const clave = String(cuerpo.clave || "");
    if (!email.includes("@")) throw new ErrorHttp(400, "Email no válido");
    if (!nombre) throw new ErrorHttp(400, "Falta el nombre");
    if (!(rol in NIVEL)) throw new ErrorHttp(400, `Rol desconocido: ${rol}`);
    if (clave.length < 8) throw new ErrorHttp(400, "La contraseña necesita al menos 8 caracteres");
    if (db.prepare("SELECT 1 FROM usuarios WHERE email = ?").get(email)) throw new ErrorHttp(409, "Ya existe una cuenta con ese email");
    const id = crearUsuario(db, { email, nombre, rol, clave });
    anotar(quien.id, "crear", "usuarios", id, { email, rol });
    res.__codigo = 201;
    return { usuario: { id, email, nombre, rol } };
  });

  add("PATCH", /^\/api\/usuarios\/(\d+)$/, (req, p, _url, cuerpo) => {
    const quien = exigir(req, "admin");
    const id = Number(p[0]);
    const u = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(id);
    if (!u) throw new ErrorHttp(404, "Ese usuario no existe");
    if (cuerpo.rol) {
      if (!(cuerpo.rol in NIVEL)) throw new ErrorHttp(400, "Rol desconocido");
      if (u.rol === "admin" && cuerpo.rol !== "admin" && db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol='admin' AND activo=1").get().n <= 1) {
        throw new ErrorHttp(400, "No puedes dejar el sistema sin ningún administrador");
      }
      db.prepare("UPDATE usuarios SET rol = ? WHERE id = ?").run(cuerpo.rol, id);
    }
    if (typeof cuerpo.activo === "boolean") db.prepare("UPDATE usuarios SET activo = ? WHERE id = ?").run(cuerpo.activo ? 1 : 0, id);
    if (cuerpo.clave) {
      if (String(cuerpo.clave).length < 8) throw new ErrorHttp(400, "La contraseña necesita al menos 8 caracteres");
      const sal = randomBytes(16).toString("hex");
      db.prepare("UPDATE usuarios SET hash = ?, sal = ? WHERE id = ?").run(hashear(cuerpo.clave, sal), sal, id);
      db.prepare("DELETE FROM sesiones WHERE usuario_id = ?").run(id);
    }
    anotar(quien.id, "editar", "usuarios", id, cuerpo);
    return { usuario: db.prepare("SELECT id,email,nombre,rol,activo FROM usuarios WHERE id = ?").get(id) };
  });

  // ── rutas ───────────────────────────────────────────────────────────────────
  add("GET", /^\/api\/rutas$/, (req, _p, url) => {
    const u = exigir(req, "invitado");
    const q = url.searchParams;
    const cond = [];
    const val = [];
    if (u.rol === "conductor") { cond.push("r.conductor_id = ?"); val.push(u.id); }
    for (const [campo, col] of [["fecha", "r.fecha"], ["estado", "r.estado"], ["distrito", "r.distrito"], ["fraccion", "r.fraccion"]]) {
      const v = q.get(campo);
      if (v) { cond.push(`${col} = ?`); val.push(v); }
    }
    const desde = q.get("desde");
    if (desde) { cond.push("r.fecha >= ?"); val.push(desde); }
    const hasta = q.get("hasta");
    if (hasta) { cond.push("r.fecha <= ?"); val.push(hasta); }
    const donde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
    const filas = db.prepare(
      `SELECT r.*, u.nombre conductor, p.kg_total, p.kg_fraccion, p.desvio_pct
       FROM rutas r LEFT JOIN usuarios u ON u.id = r.conductor_id
       LEFT JOIN partes p ON p.ruta_id = r.id
       ${donde} ORDER BY r.fecha DESC, r.turno LIMIT 500`
    ).all(...val);
    return { total: filas.length, rutas: filas };
  });

  add("POST", /^\/api\/rutas$/, (req, _p, _url, cuerpo, res) => {
    const u = exigir(req, "planificador");
    const { fecha, turno, fraccion } = cuerpo;
    const distrito = cuerpo.distrito || null;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorHttp(400, "Fecha no válida (YYYY-MM-DD)");
    if (!["mañana", "tarde", "noche"].includes(turno)) throw new ErrorHttp(400, "Turno no válido");
    if (!fraccion) throw new ErrorHttp(400, "Falta la fracción");
    const plan = planificar({
      distrito, fraccion, fecha, turno,
      maxIslas: cuerpo.max_islas ? Number(cuerpo.max_islas) : null,
      conductorId: cuerpo.conductor_id || null
    });
    const estado = cuerpo.conductor_id ? "asignada" : "borrador";
    const r = db.prepare(
      `INSERT INTO rutas (fecha,turno,fraccion,distrito,camion,conductor_id,estado,islas_planificadas,
        contenedores,litros,kg_previstos,km_planificados,horas_previstas,creada_por,creada_en,asignada_en,notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(fecha, turno, fraccion, distrito, cuerpo.camion || null, cuerpo.conductor_id || null, estado,
      plan.paradas.length, plan.contenedores, plan.litros, Math.round(plan.kg), Number(plan.km.toFixed(3)),
      Number(plan.horas.toFixed(2)), u.id, ahora(), estado === "asignada" ? ahora() : null, cuerpo.notas || null);
    const id = Number(r.lastInsertRowid);
    const insP = db.prepare(
      "INSERT INTO paradas (ruta_id,orden,isla_id,direccion,lat,lon,contenedores,litros,kg_previstos) VALUES (?,?,?,?,?,?,?,?,?)"
    );
    plan.paradas.forEach((p, i) => insP.run(id, i + 1, p.id, p.direccion, p.lat, p.lon, p.contenedores, p.litros, Math.round(p.kg_previstos)));
    anotar(u.id, "crear", "rutas", id, { fecha, turno, fraccion, distrito, islas: plan.paradas.length });
    res.__codigo = 201;   // creado: 201, no 200
    return leerRuta(id);
  });

  add("GET", /^\/api\/rutas\/(\d+)$/, (req, p) => {
    const u = exigir(req, "invitado");
    const r = leerRuta(Number(p[0]));
    if (u.rol === "conductor" && r.conductor_id !== u.id) {
      throw new ErrorHttp(403, "Esta ruta no es tuya");
    }
    return r;
  });

  add("PATCH", /^\/api\/rutas\/(\d+)$/, (req, p, _url, cuerpo) => {
    const u = exigir(req, "planificador");
    const id = Number(p[0]);
    const r = db.prepare("SELECT * FROM rutas WHERE id = ?").get(id);
    if (!r) throw new ErrorHttp(404, "Esa ruta no existe");
    if (r.estado === "cerrada" || r.estado === "anulada") {
      throw new ErrorHttp(409, `Una ruta ${r.estado} ya no se puede editar`);
    }
    const cambios = {};
    for (const campo of ["camion", "notas", "distrito", "turno", "fecha"]) {
      if (cuerpo[campo] !== undefined) cambios[campo] = cuerpo[campo];
    }
    const claves = Object.keys(cambios);
    if (claves.length) {
      db.prepare(`UPDATE rutas SET ${claves.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
        .run(...claves.map((c) => cambios[c]), id);
      anotar(u.id, "editar", "rutas", id, cambios);
    }
    return leerRuta(id);
  });

  add("POST", /^\/api\/rutas\/(\d+)\/asignar$/, (req, p, _url, cuerpo) => {
    const u = exigir(req, "planificador");
    const id = Number(p[0]);
    const r = db.prepare("SELECT * FROM rutas WHERE id = ?").get(id);
    if (!r) throw new ErrorHttp(404, "Esa ruta no existe");
    if (!["borrador", "asignada"].includes(r.estado)) throw new ErrorHttp(409, `No se puede asignar una ruta ${r.estado}`);
    const conductorId = Number(cuerpo.conductor_id || 0);
    const c = db.prepare("SELECT * FROM usuarios WHERE id = ? AND activo = 1").get(conductorId);
    if (!c) throw new ErrorHttp(400, "Ese conductor no existe o está de baja");
    if (!["conductor", "planificador", "admin"].includes(c.rol)) throw new ErrorHttp(400, "Ese usuario no conduce");
    db.prepare("UPDATE rutas SET conductor_id = ?, camion = COALESCE(?, camion), estado = 'asignada', asignada_en = ? WHERE id = ?")
      .run(conductorId, cuerpo.camion || null, ahora(), id);
    anotar(u.id, "asignar", "rutas", id, { conductor_id: conductorId });
    return leerRuta(id);
  });

  add("POST", /^\/api\/rutas\/(\d+)\/iniciar$/, (req, p) => {
    const u = exigir(req, "conductor");
    const id = Number(p[0]);
    const r = db.prepare("SELECT * FROM rutas WHERE id = ?").get(id);
    if (!r) throw new ErrorHttp(404, "Esa ruta no existe");
    if (u.rol === "conductor" && r.conductor_id !== u.id) throw new ErrorHttp(403, "Esta ruta no es tuya");
    if (r.estado !== "asignada") throw new ErrorHttp(409, `Para iniciar tiene que estar asignada (ahora: ${r.estado})`);
    db.prepare("UPDATE rutas SET estado = 'en_curso', iniciada_en = ? WHERE id = ?").run(ahora(), id);
    anotar(u.id, "iniciar", "rutas", id, null);
    return leerRuta(id);
  });

  add("POST", /^\/api\/rutas\/(\d+)\/paradas\/(\d+)$/, (req, p, _url, cuerpo) => {
    const u = exigir(req, "conductor");
    const id = Number(p[0]);
    const pid = Number(p[1]);
    const r = db.prepare("SELECT * FROM rutas WHERE id = ?").get(id);
    if (!r) throw new ErrorHttp(404, "Esa ruta no existe");
    if (u.rol === "conductor" && r.conductor_id !== u.id) throw new ErrorHttp(403, "Esta ruta no es tuya");
    if (r.estado !== "en_curso") throw new ErrorHttp(409, `Solo se marcan paradas en una ruta en curso (ahora: ${r.estado})`);
    const parada = db.prepare("SELECT * FROM paradas WHERE id = ? AND ruta_id = ?").get(pid, id);
    if (!parada) throw new ErrorHttp(404, "Esa parada no es de esta ruta");
    const hecha = cuerpo.hecha === false ? 0 : 1;
    db.prepare("UPDATE paradas SET hecha = ?, hecha_en = ? WHERE id = ?").run(hecha, hecha ? ahora() : null, pid);
    if (cuerpo.incidencia) {
      db.prepare("INSERT INTO incidencias (ruta_id,parada_id,tipo,texto,creada_por,creada_en) VALUES (?,?,?,?,?,?)")
        .run(id, pid, String(cuerpo.incidencia.tipo || "otra"), cuerpo.incidencia.texto || null, u.id, ahora());
      anotar(u.id, "incidencia", "rutas", id, { parada_id: pid, ...cuerpo.incidencia });
    }
    return leerRuta(id);
  });

  add("POST", /^\/api\/rutas\/(\d+)\/cerrar$/, (req, p, _url, cuerpo) => {
    const u = exigir(req, "conductor");
    const id = Number(p[0]);
    const r = db.prepare("SELECT * FROM rutas WHERE id = ?").get(id);
    if (!r) throw new ErrorHttp(404, "Esa ruta no existe");
    if (u.rol === "conductor" && r.conductor_id !== u.id) throw new ErrorHttp(403, "Esta ruta no es tuya");
    if (r.estado === "cerrada") throw new ErrorHttp(409, "Esta ruta ya está cerrada");
    if (r.estado !== "en_curso") throw new ErrorHttp(409, `Para cerrar hay que haberla iniciado (ahora: ${r.estado})`);
    const kg = Number(cuerpo.kg_fraccion);
    if (!Number.isFinite(kg) || kg <= 0) throw new ErrorHttp(400, "Hacen falta los kilos recogidos (kg_fraccion)");
    const desvio = r.kg_previstos > 0 ? Number((((kg - r.kg_previstos) / r.kg_previstos) * 100).toFixed(1)) : null;
    db.prepare("INSERT INTO partes (ruta_id,conductor_id,cerrado_en,kg_total,kg_fraccion,desvio_pct,observaciones) VALUES (?,?,?,?,?,?,?)")
      .run(id, r.conductor_id ?? u.id, ahora(), kg, kg, desvio, cuerpo.observaciones || null);
    db.prepare("UPDATE rutas SET estado = 'cerrada', cerrada_en = ? WHERE id = ?").run(ahora(), id);
    if (Array.isArray(cuerpo.incidencias)) {
      for (const inc of cuerpo.incidencias) {
        db.prepare("INSERT INTO incidencias (ruta_id,parada_id,tipo,texto,creada_por,creada_en) VALUES (?,?,?,?,?,?)")
          .run(id, inc.parada_id || null, String(inc.tipo || "otra"), inc.texto || null, u.id, ahora());
      }
    }
    anotar(u.id, "cerrar", "rutas", id, { kg_fraccion: kg, desvio_pct: desvio });
    return leerRuta(id);
  });

  add("GET", /^\/api\/partes$/, (req, _p, url) => {
    const u = exigir(req, "invitado");
    const q = url.searchParams;
    const cond = [];
    const val = [];
    if (u.rol === "conductor") { cond.push("r.conductor_id = ?"); val.push(u.id); }
    const desde = q.get("desde");
    if (desde) { cond.push("r.fecha >= ?"); val.push(desde); }
    const hasta = q.get("hasta");
    if (hasta) { cond.push("r.fecha <= ?"); val.push(hasta); }
    if (q.get("distrito")) { cond.push("r.distrito = ?"); val.push(q.get("distrito")); }
    const donde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
    return {
      partes: db.prepare(
        `SELECT p.id, p.ruta_id, r.fecha, r.turno, r.fraccion, r.distrito, r.camion, u.nombre conductor,
                p.cerrado_en, p.kg_total, p.desvio_pct, r.km_planificados, r.islas_planificadas, p.observaciones
         FROM partes p JOIN rutas r ON r.id = p.ruta_id LEFT JOIN usuarios u ON u.id = p.conductor_id
         ${donde} ORDER BY r.fecha DESC, p.id DESC LIMIT 500`
      ).all(...val)
    };
  });

  add("GET", /^\/api\/kilos\/resumen$/, (req, _p, url) => {
    exigir(req, "invitado");
    const q = url.searchParams;
    const cond = ["r.estado = 'cerrada'"];
    const val = [];
    const desde = q.get("desde") || "2000-01-01";
    const hasta = q.get("hasta") || "2100-01-01";
    cond.push("r.fecha >= ?", "r.fecha <= ?");
    val.push(desde, hasta);
    const base = `FROM partes p JOIN rutas r ON r.id = p.ruta_id WHERE ${cond.join(" AND ")}`;
    const unido = `FROM partes p JOIN rutas r ON r.id = p.ruta_id JOIN usuarios u ON u.id = r.conductor_id WHERE ${cond.join(" AND ")}`;
    return {
      porFraccion: db.prepare(`SELECT r.fraccion, COUNT(*) rutas, SUM(p.kg_total) kg, SUM(r.km_planificados) km ${base} GROUP BY r.fraccion ORDER BY kg DESC`).all(...val),
      porDistrito: db.prepare(`SELECT r.distrito, COUNT(*) rutas, SUM(p.kg_total) kg ${base} GROUP BY r.distrito ORDER BY kg DESC`).all(...val),
      porDia: db.prepare(`SELECT r.fecha, SUM(p.kg_total) kg, COUNT(*) rutas ${base} GROUP BY r.fecha ORDER BY r.fecha`).all(...val),
      porConductor: db.prepare(`SELECT u.nombre conductor, COUNT(*) rutas, SUM(p.kg_total) kg ${unido} GROUP BY u.id ORDER BY kg DESC`).all(...val),
      desvioMedio: db.prepare(`SELECT AVG(p.desvio_pct) media, COUNT(*) n ${base} AND p.desvio_pct IS NOT NULL`).get(...val)
    };
  });

  add("GET", /^\/api\/auditoria$/, (req, _p, url) => {
    exigir(req, "admin");
    const limite = Math.min(Number(url.searchParams.get("limite") || 200), 1000);
    return {
      auditoria: db.prepare(
        `SELECT a.id, a.ts, a.accion, a.entidad, a.entidad_id, a.detalle, u.email
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT ?`
      ).all(limite)
    };
  });

  // ── estáticos del panel (mismo origen en producción: sin líos de cookies) ────
  const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
  function estatico(req, res, url) {
    if (req.method !== "GET") return false;
    let rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const fichero = normalize(join(dirPanel, rel));
    if (!fichero.startsWith(dirPanel) || !existsSync(fichero) || statSync(fichero).isDirectory()) return false;
    const tipo = TIPOS[extname(fichero).toLowerCase()];
    if (!tipo) return false;
    res.setHeader("Content-Type", tipo);
    res.setHeader("Cache-Control", "no-cache");
    res.end(readFileSync(fichero));
    return true;
  }

  function leerCuerpo(req) {
    return new Promise((resolver, rechazar) => {
      let datos = "";
      req.on("data", (t) => {
        datos += t;
        if (datos.length > 1_000_000) { rechazar(new ErrorHttp(413, "Cuerpo demasiado grande")); req.destroy(); }
      });
      req.on("end", () => {
        if (!datos) return resolver({});
        try { resolver(JSON.parse(datos)); }
        catch { rechazar(new ErrorHttp(400, "El cuerpo no es JSON válido")); }
      });
      req.on("error", rechazar);
    });
  }

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const origen = req.headers.origin;
    if (origen && (origenes.includes(origen) || origenes.includes("*"))) {
      res.setHeader("Access-Control-Allow-Origin", origen);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");

    if (!url.pathname.startsWith("/api/")) {
      if (estatico(req, res, url)) return;
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "No encontrado. La API vive en /api/" }));
    }

    for (const r of rutas) {
      if (r.metodo !== req.method) continue;
      const m = r.patron.exec(url.pathname);
      if (!m) continue;
      try {
        const cuerpo = ["POST", "PATCH", "PUT"].includes(req.method) ? await leerCuerpo(req) : {};
        const salida = await r.manejador(req, m.slice(1), url, cuerpo, res);
        const codigo = res.__codigo || 200;
        res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(salida));
      } catch (e) {
        const codigo = e instanceof ErrorHttp ? e.codigo : 500;
        if (codigo === 500) console.error("error en", req.method, url.pathname, e);
        res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: e.message, ...(e.detalle ? { detalle: e.detalle } : {}) }));
      }
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: `No existe ${req.method} ${url.pathname}` }));
  });

  return { servidor, db, rutaDb, params, cerrar: () => { db.close(); servidor.close(); } };
}

// ── arranque directo ──────────────────────────────────────────────────────────
const esPrincipal = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (esPrincipal) {
  const { servidor, db, rutaDb } = crearServidor();
  // Primera vez: si no hay ninguna cuenta, se crea la del administrador.
  if (db.prepare("SELECT COUNT(*) n FROM usuarios").get().n === 0) {
    const email = process.env.MC_ADMIN_EMAIL || "admin@madridcircula.local";
    const clave = process.env.MC_ADMIN_CLAVE || randomBytes(9).toString("base64url");
    crearUsuario(db, { email, nombre: "Administración", rol: "admin", clave });
    console.log(`\n  Primera puesta en marcha. Cuenta de administrador:\n    ${email}\n    ${clave}\n  Guárdala: no se vuelve a mostrar.\n`);
  }
  const puerto = Number(process.env.MC_PUERTO || 3000);
  servidor.listen(puerto, () => {
    console.log(`MADRID CIRCULA · API v${VERSION} en http://localhost:${puerto}`);
    console.log(`  base: ${rutaDb}`);
  });
}

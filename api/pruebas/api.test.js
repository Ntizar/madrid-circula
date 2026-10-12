// Pruebas de la API. Peticiones HTTP de verdad contra un servidor de verdad,
// con una base temporal y los datos reales dentro.
//
//   node --test api/pruebas/
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crearServidor, crearUsuario } from "../servidor.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../..");
const TMP = mkdtempSync(join(tmpdir(), "mc-pruebas-"));
const RUTA_DB = join(TMP, "pruebas.db");

execFileSync(process.execPath, [join(RAIZ, "api", "importar.js"), RUTA_DB], { stdio: "pipe" });

const app = crearServidor({ rutaDb: RUTA_DB, origenes: "https://ntizar.github.io" });
await new Promise((listo) => app.servidor.listen(0, listo));
const BASE = `http://127.0.0.1:${app.servidor.address().port}`;

const IDS = {
  admin: crearUsuario(app.db, { email: "admin@pruebas.es", nombre: "Ada Admin", rol: "admin", clave: "clave-admin-1" }),
  plan: crearUsuario(app.db, { email: "plan@pruebas.es", nombre: "Pili Plan", rol: "planificador", clave: "clave-plan-1" }),
  cond1: crearUsuario(app.db, { email: "cond1@pruebas.es", nombre: "Concha Uno", rol: "conductor", clave: "clave-cond1-1" }),
  cond2: crearUsuario(app.db, { email: "cond2@pruebas.es", nombre: "Cosme Dos", rol: "conductor", clave: "clave-cond2-1" }),
  invitado: crearUsuario(app.db, { email: "invitado@pruebas.es", nombre: "Curioso", rol: "invitado", clave: "clave-invitado-1" })
};

function cliente() {
  let cookie = "";
  return {
    cookie: () => cookie,
    async pide(metodo, ruta, cuerpo, cabeceras = {}) {
      const r = await fetch(BASE + ruta, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...cabeceras },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
      });
      const puestas = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      const sesion = puestas.find((c) => c.startsWith("mc_sesion="));
      if (sesion) cookie = sesion.split(";")[0];
      let datos = null;
      try { datos = await r.json(); } catch { datos = null; }
      return { estado: r.status, datos, cabeceras: r.headers };
    }
  };
}

async function entrar(email, clave) {
  const c = cliente();
  const r = await c.pide("POST", "/api/entrar", { email, clave });
  assert.equal(r.estado, 200, `no pude entrar como ${email}: ${JSON.stringify(r.datos)}`);
  return c;
}

const anon = cliente();
let admin, plan, cond1, cond2, invitado;
let ruta;

after(() => {
  app.cerrar();
  rmSync(TMP, { recursive: true, force: true });
});

test("T01 · salud: los datos reales están dentro", async () => {
  const r = await anon.pide("GET", "/api/salud");
  assert.equal(r.estado, 200);
  assert.equal(r.datos.datos.islas, 14282, "islas reales");
  assert.equal(r.datos.datos.contenedores, 44069, "contenedores reales");
  assert.equal(r.datos.datos.distritos, 21, "distritos reales");
  assert.equal(r.datos.datos.usuarios, 5, "cuentas de prueba");
});

test("T02 · marco: fracciones, distritos y parámetros declarados", async () => {
  const r = await anon.pide("GET", "/api/marco");
  assert.equal(r.estado, 200);
  assert.equal(r.datos.fracciones.length, 5);
  assert.equal(r.datos.distritos.length, 21);
  assert.equal(r.datos.parametros.capacidad_camion_kg.Resto, 11000);
  assert.equal(r.datos.parametros.velocidad_media_kmh, 16);
  assert.ok(r.datos.licencia.includes("CC-BY"), "la licencia viaja con los datos");
});

test("T03 · red: el reparto por fracción suma los contenedores reales", async () => {
  const r = await anon.pide("GET", "/api/red/resumen");
  const suma = r.datos.porFraccion.reduce((s, f) => s + f.contenedores, 0);
  assert.equal(suma, 44069);
  assert.equal(r.datos.porFraccion.length, 5);
  assert.equal(r.datos.porDistrito.length, 21);
});

test("T04 · islas: se pueden filtrar por distrito y fracción", async () => {
  const r = await anon.pide("GET", "/api/islas?distrito=Carabanchel&fraccion=Resto&limite=50");
  assert.equal(r.estado, 200);
  assert.ok(r.datos.islas.length > 0, "hay islas de Resto en Carabanchel");
  assert.ok(r.datos.islas.every((i) => i.distrito === "Carabanchel"));
  assert.ok(r.datos.islas.every((i) => i.fracciones.includes("Resto")));
});

test("T05 · sin sesión no hay usuario", async () => {
  assert.equal((await anon.pide("GET", "/api/yo")).estado, 401);
});

test("T06 · contraseña incorrecta no entra", async () => {
  const r = await anon.pide("POST", "/api/entrar", { email: "admin@pruebas.es", clave: "no-es-la-buena" });
  assert.equal(r.estado, 401);
});

test("T07 · el invitado entra y sus permisos son de lectura", async () => {
  invitado = await entrar("invitado@pruebas.es", "clave-invitado-1");
  const r = await invitado.pide("GET", "/api/yo");
  assert.equal(r.datos.usuario.rol, "invitado");
  assert.equal(r.datos.permisos.invitado, true);
  assert.equal(r.datos.permisos.planificador, false);
  assert.equal(r.datos.permisos.admin, false);
});

test("T08 · el invitado lee rutas pero no las crea", async () => {
  assert.equal((await invitado.pide("GET", "/api/rutas")).estado, 200);
  const r = await invitado.pide("POST", "/api/rutas", { fecha: "2026-10-20", turno: "mañana", fraccion: "Resto" });
  assert.equal(r.estado, 403);
});

test("T09 · el planificador crea una ruta planificada de verdad", async () => {
  plan = await entrar("plan@pruebas.es", "clave-plan-1");
  const r = await plan.pide("POST", "/api/rutas", {
    fecha: "2026-10-20", turno: "mañana", fraccion: "Resto", distrito: "Carabanchel", camion: "MAD-1234"
  });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  ruta = r.datos;
  assert.equal(ruta.estado, "borrador");
  assert.ok(ruta.paradas.length > 0, "tiene paradas");
  assert.ok(ruta.km_planificados > 0, "tiene kilómetros");
  assert.ok(ruta.kg_previstos > 0, "tiene kilos previstos");
  assert.ok(ruta.horas_previstas > 0);
  assert.ok(ruta.kg_previstos <= 11000 * 1.3, `no se pasa de la capacidad del camión (${ruta.kg_previstos})`);
});

test("T10 · las paradas van ordenadas y sin repetir isla", async () => {
  const islas = ruta.paradas.map((p) => p.isla_id);
  assert.equal(new Set(islas).size, islas.length, "ninguna isla repetida");
  assert.deepEqual(ruta.paradas.map((p) => p.orden), ruta.paradas.map((_, i) => i + 1));
  assert.ok(ruta.paradas.every((p) => p.contenedores > 0));
  const km = ruta.km_planificados;
  assert.ok(km < 200, `una ruta urbana no puede medir ${km} km`);
});

test("T11 · un conductor ajeno no ve la ruta de otro", async () => {
  cond2 = await entrar("cond2@pruebas.es", "clave-cond2-1");
  assert.equal((await cond2.pide("GET", `/api/rutas/${ruta.id}`)).estado, 403);
});

test("T12 · asignar la ruta a un conductor", async () => {
  const r = await plan.pide("POST", `/api/rutas/${ruta.id}/asignar`, { conductor_id: IDS.cond1 });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, "asignada");
  assert.equal(r.datos.conductor_id, IDS.cond1);
  cond1 = await entrar("cond1@pruebas.es", "clave-cond1-1");
  const suya = await cond1.pide("GET", `/api/rutas/${ruta.id}`);
  assert.equal(suya.estado, 200, "el conductor asignado sí la ve");
});

test("T13 · el conductor inicia la ruta (y hay dos puertas cerradas antes)", async () => {
  const nueva = await plan.pide("POST", "/api/rutas", { fecha: "2026-10-21", turno: "tarde", fraccion: "Vidrio", distrito: "Centro" });
  // una ruta en borrador no se puede iniciar: primero hay que asignarla
  const borrador = await plan.pide("POST", `/api/rutas/${nueva.datos.id}/iniciar`);
  assert.equal(borrador.estado, 409, "un borrador no se inicia");
  // y un conductor al que no se le ha asignado no puede tocarla (ni mirarla)
  const ajeno = await cond1.pide("POST", `/api/rutas/${nueva.datos.id}/iniciar`);
  assert.equal(ajeno.estado, 403, "no es suya");
  const r = await cond1.pide("POST", `/api/rutas/${ruta.id}/iniciar`);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.estado, "en_curso");
  assert.ok(r.datos.iniciada_en);
});

test("T14 · marcar una parada hecha y dejar una incidencia", async () => {
  const parada = ruta.paradas[0];
  const r = await cond1.pide("POST", `/api/rutas/${ruta.id}/paradas/${parada.id}`, {
    hecha: true, incidencia: { tipo: "contenedor_lleno", texto: "Desbordado, no entra todo" }
  });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.paradas[0].hecha, 1);
  assert.equal(r.datos.incidencias.length, 1);
  assert.equal(r.datos.incidencias[0].tipo, "contenedor_lleno");
  assert.equal(r.datos.incidencias[0].parada_id, parada.id);
});

test("T15 · cerrar la ruta con los kilos de verdad", async () => {
  const kg = Math.round(ruta.kg_previstos);
  const r = await cond1.pide("POST", `/api/rutas/${ruta.id}/cerrar`, { kg_fraccion: kg, observaciones: "Sin novedad" });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, "cerrada");
  assert.equal(r.datos.parte.kg_total, kg);
  assert.equal(r.datos.parte.desvio_pct, 0, "cerrando con los previstos el desvío es 0");
  assert.equal(r.datos.parte.observaciones, "Sin novedad");
  assert.ok(r.datos.cerrada_en);
});

test("T16 · una ruta no se cierra dos veces", async () => {
  const r = await cond1.pide("POST", `/api/rutas/${ruta.id}/cerrar`, { kg_fraccion: 100 });
  assert.equal(r.estado, 409);
});

test("T17 · una ruta cerrada ya no se edita", async () => {
  const r = await plan.pide("PATCH", `/api/rutas/${ruta.id}`, { camion: "OTRO-CAMION" });
  assert.equal(r.estado, 409);
  assert.ok(r.datos.error.includes("cerrada"));
});

test("T18 · un conductor no crea cuentas", async () => {
  const r = await cond1.pide("POST", "/api/usuarios", { email: "x@y.es", nombre: "X", rol: "admin", clave: "12345678" });
  assert.equal(r.estado, 403);
});

test("T19 · el admin crea cuentas y no admite duplicados", async () => {
  admin = await entrar("admin@pruebas.es", "clave-admin-1");
  const alta = await admin.pide("POST", "/api/usuarios", { email: "nueva@pruebas.es", nombre: "Nueva", rol: "planificador", clave: "clave-nueva-1" });
  assert.equal(alta.estado, 201, JSON.stringify(alta.datos));
  assert.equal(alta.datos.usuario.rol, "planificador");
  const repetida = await admin.pide("POST", "/api/usuarios", { email: "nueva@pruebas.es", nombre: "Otra", rol: "invitado", clave: "clave-otra-1" });
  assert.equal(repetida.estado, 409);
  const corta = await admin.pide("POST", "/api/usuarios", { email: "corta@pruebas.es", nombre: "Corta", rol: "invitado", clave: "123" });
  assert.equal(corta.estado, 400);
  const nueva = await entrar("nueva@pruebas.es", "clave-nueva-1");
  assert.equal((await nueva.pide("GET", "/api/yo")).datos.usuario.nombre, "Nueva");
});

test("T20 · los kilos cerrados aparecen en el resumen", async () => {
  const r = await plan.pide("GET", "/api/kilos/resumen?desde=2026-10-01&hasta=2026-10-31");
  assert.equal(r.estado, 200);
  const resto = r.datos.porFraccion.find((f) => f.fraccion === "Resto");
  assert.ok(resto, "hay parte de Resto");
  assert.equal(resto.kg, Math.round(ruta.kg_previstos));
  assert.equal(r.datos.porDistrito[0].distrito, "Carabanchel");
  assert.equal(r.datos.porDia.length, 1);
  assert.equal(r.datos.desvioMedio.n, 1);
});

test("T21 · la auditoría guarda quién hizo qué (y solo el admin la ve)", async () => {
  const r = await admin.pide("GET", "/api/auditoria");
  assert.equal(r.estado, 200);
  const acciones = r.datos.auditoria.map((a) => a.accion);
  for (const esperada of ["entrar", "crear", "asignar", "iniciar", "cerrar"]) {
    assert.ok(acciones.includes(esperada), `falta la acción ${esperada}`);
  }
  assert.ok(r.datos.auditoria.some((a) => a.email === "cond1@pruebas.es"), "queda el autor");
  assert.equal((await invitado.pide("GET", "/api/auditoria")).estado, 403);
});

test("T22 · CORS: la web pública puede leer la API", async () => {
  const r = await anon.pide("GET", "/api/salud", undefined, { Origin: "https://ntizar.github.io" });
  assert.equal(r.cabeceras.get("access-control-allow-origin"), "https://ntizar.github.io");
  assert.equal(r.cabeceras.get("access-control-allow-credentials"), "true");
  const ajeno = await anon.pide("GET", "/api/salud", undefined, { Origin: "https://sitio-raro.example" });
  assert.equal(ajeno.cabeceras.get("access-control-allow-origin"), null, "un origen no autorizado no recibe permiso");
});

test("T23 · dos rutas del mismo turno no repiten las mismas islas", async () => {
  const a = await plan.pide("POST", "/api/rutas", { fecha: "2026-11-02", turno: "mañana", fraccion: "Papel-Cartón", distrito: "Salamanca", max_islas: 12 });
  const b = await plan.pide("POST", "/api/rutas", { fecha: "2026-11-02", turno: "mañana", fraccion: "Papel-Cartón", distrito: "Salamanca", max_islas: 12 });
  assert.equal(a.estado, 201, JSON.stringify(a.datos));
  assert.equal(b.estado, 201, JSON.stringify(b.datos));
  const islasA = new Set(a.datos.paradas.map((p) => p.isla_id));
  const repetidas = b.datos.paradas.filter((p) => islasA.has(p.isla_id));
  assert.equal(repetidas.length, 0, "la segunda ruta no pisa la primera");
});

test("T25 · el planificador ve la lista de conductores (y el invitado no)", async () => {
  const r = await plan.pide("GET", "/api/conductores");
  assert.equal(r.estado, 200);
  const roles = r.datos.conductores.map((c) => c.rol);
  assert.ok(roles.includes("conductor"), "aparecen los conductores");
  assert.ok(!roles.includes("invitado"), "un invitado no conduce");
  assert.ok(r.datos.conductores.every((c) => c.nombre && c.id));
  assert.equal((await invitado.pide("GET", "/api/conductores")).estado, 403);
});

test("T27 · la ruta nunca sale sobrecargada", async () => {
  // El tope es la capacidad del camión para esa fracción (11.000 kg en Resto).
  // Si no cabe una isla entera, se deja fuera: antes se pasaba 15 kg de largo.
  const r = await plan.pide("POST", "/api/rutas", {
    fecha: "2026-11-10", turno: "mañana", fraccion: "Resto", distrito: "Carabanchel"
  });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  const tope = 11000;
  assert.ok(r.datos.kg_previstos <= tope,
    `se pasa del tope: ${r.datos.kg_previstos} kg sobre ${tope}`);
  assert.ok(r.datos.paradas.length > 1, "y aun así lleva paradas de sobra");
  const sumaParadas = r.datos.paradas.reduce((s, p) => s + p.kg_previstos, 0);
  assert.ok(Math.abs(sumaParadas - r.datos.kg_previstos) < r.datos.paradas.length,
    "los kilos de la ruta cuadran con la suma de sus paradas");
  const conTope = await plan.pide("POST", "/api/rutas", {
    fecha: "2026-11-11", turno: "tarde", fraccion: "Vidrio", distrito: "Centro", max_islas: 5
  });
  assert.equal(conTope.datos.paradas.length, 5, "el tope de islas se respeta (ni una más)");
});

test("T28 · la sala de control cuadra y respeta los permisos", async () => {
  const FECHA = "2026-11-10";
  // La ruta de ese día (creada en T27) se la damos a Concha para poder comprobar el filtro.
  const lista = await plan.pide("GET", `/api/rutas?fecha=${FECHA}`);
  assert.ok(lista.datos.rutas.length >= 1, "T27 dejó una ruta ese día");
  const idRuta = lista.datos.rutas[0].id;
  const asig = await plan.pide("POST", `/api/rutas/${idRuta}/asignar`, { conductor_id: IDS.cond1 });
  assert.equal(asig.estado, 200, JSON.stringify(asig.datos));

  const sala = await plan.pide("GET", `/api/sala?fecha=${FECHA}`);
  assert.equal(sala.estado, 200);
  const s = sala.datos;
  assert.equal(s.fecha, FECHA);
  assert.ok(s.kpis.rutas >= 1, "el día tiene rutas");
  assert.equal(s.kpis.rutas, s.rutas.length, "el recuento de rutas cuadra");
  assert.ok(s.kpis.sin_asignar <= s.kpis.rutas);
  assert.equal(s.kpis.kg_previstos,
    Math.round(s.rutas.reduce((t, r) => t + r.kg_previstos, 0)), "los kilos previstos son la suma de las rutas");
  const sumaFrac = s.porFraccion.reduce((t, f) => t + f.kg_previstos, 0);
  assert.ok(Math.abs(sumaFrac - s.kpis.kg_previstos) <= s.porFraccion.length, "el reparto por fracción cuadra con el total");
  assert.equal(s.porTurno.reduce((t, x) => t + x.rutas, 0), s.kpis.rutas, "el reparto por turno reparte todas las rutas");

  // El mapa trae la línea y las paradas de cada ruta del día.
  assert.ok(s.mapa.rutas.length >= 1, "hay geometría para pintar");
  const m = s.mapa.rutas[0];
  assert.equal(m.linea.length, m.paradas.length, "un punto de línea por parada");
  assert.ok(m.linea.length > 1, "la línea tiene recorrido");
  assert.ok(m.linea.every(([lon, lat]) => lon < 0 && lat > 0), "la línea va en [lon, lat], como pide GeoJSON");
  assert.ok(m.paradas.every((p) => p.lat > 40 && p.lat < 41 && p.lon > -4.6 && p.lon < -3.1), "coordenadas dentro de Madrid");

  // El modelo de carga: varias fracciones, con su densidad declarada y en rango creíble.
  const conCarga = s.red.porFraccion.filter((f) => f.carga_pct != null);
  assert.ok(conCarga.length >= 3, "hay carga calculada para varias fracciones");
  assert.ok(conCarga.every((f) => f.densidad > 0 && f.carga_pct > 0 && f.carga_pct < 400), "cargas creíbles y con densidad declarada");
  assert.ok(s.modelo.meses_referencia && s.modelo.meses_referencia.length >= 1, "el modelo declara sus meses de referencia");
  assert.ok(s.red.porDistrito.length >= 20, "la red llega a todos los distritos");
  assert.ok(s.serie.some((d) => d.fecha === FECHA), "la serie incluye el día pedido");

  // Permisos: el conductor solo ve lo suyo; el invitado ve la sala (es lectura).
  const suya = await cond1.pide("GET", `/api/sala?fecha=${FECHA}`);
  assert.equal(suya.estado, 200);
  assert.equal(suya.datos.rutas.length, 1, "Concha solo ve su ruta");
  assert.ok(suya.datos.rutas.every((r) => r.conductor_id === IDS.cond1));
  const deOtro = await cond2.pide("GET", `/api/sala?fecha=${FECHA}`);
  assert.equal(deOtro.datos.rutas.length, 0, "Cosme no ve la ruta de Concha");
  assert.equal((await invitado.pide("GET", "/api/sala")).estado, 200, "el invitado puede mirar la sala");
  assert.equal((await anon.pide("GET", "/api/sala")).estado, 401, "sin cuenta, no");
});

test("T26 · datos malos se rechazan con un mensaje claro", async () => {
  const fecha = await plan.pide("POST", "/api/rutas", { fecha: "20-10-2026", turno: "mañana", fraccion: "Resto" });
  assert.equal(fecha.estado, 400);
  assert.ok(fecha.datos.error.includes("Fecha"));
  const turno = await plan.pide("POST", "/api/rutas", { fecha: "2026-10-22", turno: "madrugada", fraccion: "Resto" });
  assert.equal(turno.estado, 400);
  const frac = await plan.pide("POST", "/api/rutas", { fecha: "2026-10-22", turno: "mañana", fraccion: "Plutonio" });
  assert.equal(frac.estado, 400, "una fracción inventada no cuela");
  const rutaInexistente = await plan.pide("GET", "/api/rutas/99999");
  assert.equal(rutaInexistente.estado, 404);
});

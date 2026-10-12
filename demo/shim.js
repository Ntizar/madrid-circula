/* Madrid Circula · instantánea estática del panel (para GitHub Pages).
 *
 * Sirve el MISMO panel de gestión, sin backend: intercepta las llamadas del panel a /api y
 * las responde con una captura real de la API guardada en api/datos.json. No hay ni una línea
 * de interfaz duplicada: se carga antes que app.js y cambia el suelo por debajo.
 *
 * Reglas de honestidad de esta instantánea:
 *   - Se lee de verdad, pero NO se escribe: cualquier planificar/asignar/cerrar se rechaza
 *     con un mensaje que lo explica, en vez de fingir que funciona.
 *   - Dice la fecha de la captura y avisa de qué partes son de ejemplo (los partes de kilos).
 */
(function () {
  "use strict";

  var DATOS = null;
  var fetchReal = window.fetch.bind(window);

  function cargar() {
    if (!DATOS) {
      DATOS = fetchReal("api/datos.json", { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("No pude leer api/datos.json");
        return r.json();
      });
    }
    return DATOS;
  }

  function respuesta(codigo, cuerpo) {
    return new Response(JSON.stringify(cuerpo), {
      status: codigo,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  var NO_SE_ESCRIBE = {
    error: "Esto es una instantánea de solo lectura con datos reales capturados de la API. " +
      "Planificar, asignar, marcar paradas o crear cuentas necesita el servidor de verdad."
  };

  /** A qué captura corresponde cada ruta que pide el panel. */
  function busca(d, camino) {
    if (camino === "/api/yo") return d.yo;
    if (camino === "/api/marco") return d.marco;
    if (camino === "/api/salud") return d.salud;
    if (camino === "/api/red/resumen") return d.red;
    if (camino.indexOf("/api/sala") === 0) return d.sala;
    if (camino.indexOf("/api/kilos") === 0) return d.kilos;
    if (camino === "/api/usuarios") return d.usuarios;
    if (camino === "/api/auditoria") return d.auditoria;
    if (camino === "/api/conductores") return d.conductores;
    if (camino.indexOf("/api/rutas/") === 0) {
      var id = camino.slice("/api/rutas/".length).split("?")[0];
      return (d.rutasPorId || {})[id] || null;
    }
    if (camino.indexOf("/api/rutas") === 0) return d.rutas;
    return null;
  }

  window.fetch = function (url, opciones) {
    var camino = String(url);
    if (camino.indexOf("/api") !== 0) return fetchReal(url, opciones);

    var metodo = ((opciones && opciones.method) || "GET").toUpperCase();

    // Entrar y salir sí funcionan: así se puede ver la pantalla de acceso y volver a entrar.
    if (camino === "/api/entrar" && metodo === "POST") {
      document.documentElement.setAttribute("data-mc-demo", "sesion");
      return cargar().then(function (d) { return respuesta(200, { usuario: d.yo.usuario, expira_en: null }); });
    }
    if (camino === "/api/salir") {
      document.documentElement.removeAttribute("data-mc-demo");
      return Promise.resolve(respuesta(200, { ok: true }));
    }
    if (metodo !== "GET") return Promise.resolve(respuesta(403, NO_SE_ESCRIBE));

    return cargar().then(function (d) {
      var datos = busca(d, camino.split("?")[0]);
      if (!datos) return respuesta(404, { error: "Esa parte no está en la instantánea: " + camino });
      return respuesta(200, datos);
    });
  };

  /** Cartel bien visible: qué es esto, de cuándo son los datos y qué no se puede hacer. */
  function cartel(d) {
    var marco = document.querySelector("main.mc-cuerpo") || document.querySelector("main");
    if (!marco || document.getElementById("demo-cartel")) return;
    var caja = document.createElement("div");
    caja.id = "demo-cartel";
    caja.className = "nz-alert nz-alert--warning";
    caja.setAttribute("role", "note");
    caja.innerHTML =
      '<span class="nz-alert__icon" aria-hidden="true">' +
      '<svg class="nz-icon nz-icon--sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>' +
      "</span><div class=\"nz-alert__body\">" +
      '<p class="nz-alert__title">Instantánea de solo lectura</p>' +
      '<p class="nz-alert__msg">Este es el panel de gestión de verdad, sin servidor detrás: los datos son ' +
      "una captura real de la API del <b>" + (d.capturado || "") + "</b> y la fecha está fija a ese día. " +
      "Se puede navegar, abrir rutas, mirar la sala de control y el mapa; <b>planificar, asignar, marcar " +
      "paradas o crear cuentas no escribe nada</b>, porque eso necesita la base de datos. " +
      "Los partes de kilos de las rutas cerradas son de ejemplo, generados alrededor del modelo: en " +
      "producción los cierra el conductor en la calle.</p></div>";
    marco.insertBefore(caja, marco.firstChild);
  }

  // El panel pregunta «¿hay sesión?» nada más cargar. En la instantánea la hay: así se entra
  // directo a la sala de control.
  document.addEventListener("DOMContentLoaded", function () {
    cargar().then(function (d) {
      if (d.fecha) {
        var campo = document.getElementById("sala-fecha");
        if (campo) campo.value = d.fecha;
      }
      cartel(d);
    }).catch(function () { /* si no hay captura, el panel mostrará su propio mensaje */ });
  });
})();

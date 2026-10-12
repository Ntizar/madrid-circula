/* Madrid Circula · panel de gestión.
   Habla con la API del mismo origen (/api/...). Sin librerías: DOM a pelo.
   El estado que ve el arnés de verificación va en window.MC_PANEL. */

(function () {
  "use strict";

  var MARCO = null;          // fracciones, distritos, colores, parámetros del modelo
  var USUARIO = null;        // quién ha entrado
  var PERMISOS = {};
  var VISTA = "";
  var RUTA = null;           // ruta abierta en el detalle
  var MAPA = null;
  var COL = {};
  var NIVEL = { invitado: 0, conductor: 1, planificador: 2, admin: 3 };

  var PANEL = { usuario: null, vista: "", rutas: [], ruta: null, sala: null, kilos: null, usuarios: [], auditoria: [], errores: [], listo: false };
  window.MC_PANEL = PANEL;

  // ── utilidades ─────────────────────────────────────────────────────────────
  function $(sel) { return document.querySelector(sel); }
  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }
  function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function num(v, dec) {
    if (v === null || v === undefined) return "—";
    return Number(v).toLocaleString("es-ES", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }
  function fechaCorta(iso) {
    if (!iso) return "—";
    var p = String(iso).slice(0, 10).split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function tono(nombre, porDefecto) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(nombre);
    return (v || "").trim() || porDefecto;
  }
  function leerTokenes() {
    COL = {
      marca: tono("--nz-brand", "#0f7a4a"),
      exito: tono("--nz-success", "#1f7a3d"),
      aviso: tono("--nz-accent", "#b26a00"),
      peligro: tono("--nz-danger", "#b3261e"),
      info: tono("--nz-info", "#1d6fa5"),
      fondo: tono("--nz-bg", "#ffffff"),
      hundido: tono("--nz-bg-inset", "#eef1f4"),
      tenue: tono("--nz-text-mute", "#6b7280")
    };
  }

  function aviso(texto, tipo) {
    var TONO = { success: "nz-toast--success", danger: "nz-toast--danger", warning: "nz-toast--warning" };
    var caja = el("div", "nz-toast " + (TONO[tipo] || ""), texto);
    $("#avisos").appendChild(caja);
    setTimeout(function () { caja.remove(); }, 6000);
    if (tipo === "danger") PANEL.errores.push(texto);
  }

  var BADGE = { borrador: "nz-badge--neutral", asignada: "nz-badge--info", en_curso: "nz-badge--warning", cerrada: "nz-badge--success", anulada: "nz-badge--danger" };

  // ── API ────────────────────────────────────────────────────────────────────
  function pide(metodo, ruta, cuerpo) {
    return fetch("/api" + ruta, {
      method: metodo,
      credentials: "include",
      headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (datos) {
        if (!r.ok) {
          var e = new Error(datos.error || ("Error " + r.status));
          e.codigo = r.status;
          e.datos = datos;
          throw e;
        }
        return datos;
      });
    });
  }

  function puede(minimo) { return (NIVEL[USUARIO ? USUARIO.rol : ""] || 0) >= NIVEL[minimo]; }

  // ── acceso ─────────────────────────────────────────────────────────────────
  function entrar(e) {
    if (e) e.preventDefault();
    var error = $("#acceso-error");
    error.hidden = true;
    $("#btn-entrar").disabled = true;
    pide("POST", "/entrar", { email: $("#inp-email").value.trim(), clave: $("#inp-clave").value })
      .then(function (r) {
        USUARIO = r.usuario;
        return pide("GET", "/yo");
      })
      .then(function (r) { PERMISOS = r.permisos; return arrancar(); })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
        PANEL.errores.push(err.message);
      })
      .finally(function () { $("#btn-entrar").disabled = false; });
  }

  function salir() {
    pide("POST", "/salir").finally(function () { location.reload(); });
  }

  // ── arranque ───────────────────────────────────────────────────────────────
  function arrancar() {
    return pide("GET", "/marco").then(function (m) {
      MARCO = m;
      leerTokenes();
      PANEL.usuario = USUARIO;
      $("#acceso").hidden = true;
      $("#app").hidden = false;
      $("#chip-usuario").textContent = USUARIO.nombre + " · " + USUARIO.rol;
      rellenarSelect("#n-fraccion", MARCO.fracciones.map(function (f) { return { v: f, t: f }; }));
      rellenarSelect("#n-distrito", [{ v: "", t: "Todos los distritos" }].concat(
        MARCO.distritos.map(function (d) { return { v: d, t: d }; })));
      $("#n-fecha").value = hoy();
      $("#f-desde").value = hoy();
      $("#f-hasta").value = hoy();
      $("#k-desde").value = hoy().slice(0, 8) + "01";
      $("#k-hasta").value = hoy();
      cargarConductores();
      // Se aterriza en la sala de control: es el retrato del día, de dónde se tira.
      ir("sala");
      PANEL.listo = true;
    });
  }

  function hoy() { return new Date().toISOString().slice(0, 10); }

  function rellenarSelect(sel, opciones) {
    var s = $(sel);
    if (!s) return;
    vaciar(s);
    opciones.forEach(function (o) {
      var op = el("option", null, o.t);
      op.value = o.v;
      s.appendChild(op);
    });
  }

  function cargarConductores() {
    if (!puede("planificador")) return Promise.resolve();
    return pide("GET", "/conductores").then(function (r) {
      var lista = [{ v: "", t: "Sin asignar" }].concat(r.conductores.map(function (c) { return { v: String(c.id), t: c.nombre }; }));
      rellenarSelect("#n-conductor", lista);
      MARCO.conductores = r.conductores;
    }).catch(function () { /* sin lista: se puede asignar luego desde el detalle */ });
  }

  // ── navegación ─────────────────────────────────────────────────────────────
  function ir(vista, dato) {
    VISTA = vista;
    PANEL.vista = vista;
    ["hoy", "ruta", "nueva", "kilos", "admin", "sala"].forEach(function (v) {
      $("#v-" + v).hidden = v !== vista;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-vista") === vista);
      b.hidden = !puede(b.getAttribute("data-minimo"));
    });
    if (vista === "sala") { verSala(); relojSala(true); } else { relojSala(false); pararDirecto(); }
    if (vista === "hoy") verHoy();
    if (vista === "nueva") verNueva();
    if (vista === "kilos") verKilos();
    if (vista === "admin") verAdmin();
    if (vista === "ruta" && dato) verRuta(dato);
  }

  function kpi(etiqueta, valor, pie, destacado) {
    var c = el("div", "nz-kpi");
    c.appendChild(el("span", "nz-kpi__label", etiqueta));
    c.appendChild(el("span", "nz-kpi__value" + (destacado ? " nz-kpi__value--brand" : ""), valor));
    if (pie) c.appendChild(el("span", "nz-kpi__delta nz-kpi__delta--flat", pie));
    return c;
  }

  // ── vista: rutas ───────────────────────────────────────────────────────────
  function verHoy() {
    var q = "?desde=" + $("#f-desde").value + "&hasta=" + $("#f-hasta").value +
      ($("#f-estado").value ? "&estado=" + $("#f-estado").value : "");
    return pide("GET", "/rutas" + q).then(function (r) {
      var rutas = r.rutas;
      PANEL.rutas = rutas;
      $("#contador-rutas").textContent = rutas.length + (rutas.length === 1 ? " ruta" : " rutas");
      $("#rutas-vacio").hidden = rutas.length > 0;

      var porEstado = {};
      var kgPrev = 0, kgReal = 0, km = 0;
      rutas.forEach(function (x) {
        porEstado[x.estado] = (porEstado[x.estado] || 0) + 1;
        kgPrev += x.kg_previstos || 0;
        kgReal += x.kg_total || 0;
        km += x.km_planificados || 0;
      });
      var rejilla = $("#kpis-hoy");
      vaciar(rejilla);
      rejilla.appendChild(kpi("Rutas en el filtro", num(rutas.length), Object.keys(porEstado).map(function (k) { return k + ": " + porEstado[k]; }).join(" · ")));
      rejilla.appendChild(kpi("Kilos previstos", num(Math.round(kgPrev)) + " kg", "lo que el modelo calcula", true));
      rejilla.appendChild(kpi("Kilos recogidos", num(Math.round(kgReal)) + " kg", rutas.length ? Math.round((kgReal / (kgPrev || 1)) * 100) + " % de lo previsto" : "sin partes cerrados"));
      rejilla.appendChild(kpi("Recorrido planificado", num(km, 1) + " km", "suma de rutas del filtro"));

      var cuerpo = $("#cuerpo-rutas");
      vaciar(cuerpo);
      rutas.forEach(function (x) {
        var tr = el("tr");
        tr.appendChild(el("td", null, fechaCorta(x.fecha)));
        tr.appendChild(el("td", null, x.turno));
        tr.appendChild(el("td", null, x.distrito || "Madrid"));
        tr.appendChild(el("td", null, x.fraccion));
        tr.appendChild(el("td", "nz-table__num", num(x.islas_planificadas)));
        tr.appendChild(el("td", "nz-table__num", num(x.kg_previstos) + " kg"));
        tr.appendChild(el("td", "nz-table__num", x.kg_total ? num(x.kg_total) + " kg" + (x.desvio_pct !== null && x.desvio_pct !== undefined ? " (" + (x.desvio_pct > 0 ? "+" : "") + x.desvio_pct + " %)" : "") : "—"));
        tr.appendChild(el("td", null, x.conductor || (x.estado === "borrador" ? "sin asignar" : "—")));
        var td = el("td");
        td.appendChild(el("span", "nz-badge " + (BADGE[x.estado] || "nz-badge--neutral") + " nz-badge--sm", x.estado));
        tr.appendChild(td);
        var tda = el("td");
        var caja = el("div", "mc-tabla-acciones");
        var ver = el("button", "nz-btn nz-btn--ghost nz-btn--sm", "Abrir");
        ver.addEventListener("click", function () { ir("ruta", x.id); });
        caja.appendChild(ver);
        tda.appendChild(caja);
        tr.appendChild(tda);
        cuerpo.appendChild(tr);
      });
      return rutas;
    });
  }

  // ── vista: detalle de ruta ─────────────────────────────────────────────────
  function verRuta(id) {
    return pide("GET", "/rutas/" + id).then(function (r) {
      RUTA = r;
      PANEL.ruta = r;
      $("#ruta-titulo").textContent = "Ruta #" + r.id + " · " + (r.distrito || "Madrid") + " · " + r.fraccion;
      var est = $("#ruta-estado");
      est.className = "nz-badge " + (BADGE[r.estado] || "nz-badge--neutral");
      est.textContent = r.estado;
      $("#ruta-notas").textContent = r.notas ? "Notas: " + r.notas : "";

      var k = $("#kpis-ruta");
      vaciar(k);
      k.appendChild(kpi("Fecha y turno", fechaCorta(r.fecha) + " · " + r.turno));
      k.appendChild(kpi("Camión y conductor", (r.camion || "sin camión") + " · " + (r.conductor || "sin asignar")));
      k.appendChild(kpi("Paradas", num(r.islas_planificadas), num(r.contenedores) + " contenedores"));
      k.appendChild(kpi("Previsto", num(r.kg_previstos) + " kg", num(r.litros) + " L de capacidad instalada", true));
      k.appendChild(kpi("Recorrido", num(r.km_planificados, 1) + " km", num(r.horas_previstas, 1) + " h estimadas"));
      if (r.parte) k.appendChild(kpi("Recogido", num(r.parte.kg_total) + " kg", (r.parte.desvio_pct > 0 ? "+" : "") + r.parte.desvio_pct + " % sobre lo previsto", true));

      pintarAcciones(r);
      pintarParadas(r);
      pintarIncidencias(r);
      pintarMapa(r);
      return r;
    });
  }

  function pintarAcciones(r) {
    var caja = $("#ruta-acciones");
    vaciar(caja);

    if (puede("planificador") && (r.estado === "borrador" || r.estado === "asignada")) {
      var sel = el("select", "nz-select");
      (MARCO.conductores || []).forEach(function (c) {
        var o = el("option", null, c.nombre + (c.rol !== "conductor" ? " (" + c.rol + ")" : ""));
        o.value = String(c.id);
        if (r.conductor_id === c.id) o.selected = true;
        sel.appendChild(o);
      });
      var b = el("button", "nz-btn nz-btn--sm", "Asignar");
      b.addEventListener("click", function () {
        if (!sel.value) return aviso("Elige un conductor", "warning");
        accion("POST", "/rutas/" + r.id + "/asignar", { conductor_id: Number(sel.value) }, "Ruta asignada");
      });
      caja.appendChild(sel);
      caja.appendChild(b);
    }

    if (r.estado === "asignada" && (puede("planificador") || r.conductor_id === (USUARIO || {}).id)) {
      var bi = el("button", "nz-btn nz-btn--sm", "Iniciar ruta");
      bi.addEventListener("click", function () { accion("POST", "/rutas/" + r.id + "/iniciar", {}, "Ruta iniciada"); });
      caja.appendChild(bi);
    }

    if (r.estado === "en_curso") {
      var kg = el("input", "nz-input");
      kg.type = "number";
      kg.placeholder = "kg recogidos";
      kg.id = "cierre-kg";
      var obs = el("input", "nz-input");
      obs.type = "text";
      obs.placeholder = "observaciones";
      obs.id = "cierre-obs";
      var bc = el("button", "nz-btn nz-btn--sm", "Cerrar con parte");
      bc.addEventListener("click", function () {
        var v = Number($("#cierre-kg").value);
        if (!v || v <= 0) return aviso("Los kilos recogidos tienen que ser mayores que cero", "warning");
        accion("POST", "/rutas/" + r.id + "/cerrar", { kg_fraccion: v, observaciones: $("#cierre-obs").value }, "Ruta cerrada con parte");
      });
      caja.appendChild(kg);
      caja.appendChild(obs);
      caja.appendChild(bc);
    }

    if (r.estado === "cerrada") caja.appendChild(el("span", "nz-badge nz-badge--success nz-badge--sm", "cerrada el " + fechaCorta(r.cerrada_en)));
    if (r.estado === "borrador") caja.appendChild(el("span", "nz-badge nz-badge--neutral nz-badge--sm", "sin asignar: no se puede iniciar"));
  }

  function accion(metodo, ruta, cuerpo, textoOk) {
    pide(metodo, ruta, cuerpo)
      .then(function (r) {
        aviso(textoOk, "success");
        RUTA = r;
        PANEL.ruta = r;
        return verRuta(r.id);
      })
      .catch(function (e) { aviso(e.message, "danger"); });
  }

  function pintarParadas(r) {
    var hechas = r.paradas.filter(function (p) { return p.hecha; }).length;
    $("#contador-paradas").textContent = hechas + " de " + r.paradas.length + " hechas";
    var caja = $("#lista-paradas");
    vaciar(caja);
    if (!r.paradas.length) { caja.appendChild(el("p", "mc-vacio", "Esta ruta no tiene paradas.")); return; }
    r.paradas.forEach(function (p) {
      var fila = el("div", "mc-parada" + (p.hecha ? " mc-parada--hecha" : ""));
      fila.appendChild(el("span", "mc-parada__n", p.orden + "."));
      var info = el("div", "mc-parada__dir");
      info.appendChild(el("div", null, p.direccion || p.isla_id));
      info.appendChild(el("div", "nz-text--small nz-text--muted", p.contenedores + " contenedores · " + num(p.kg_previstos) + " kg previstos"));
      fila.appendChild(info);

      var acc = el("div", "mc-acciones");
      if (r.estado === "en_curso") {
        var b = el("button", "nz-btn nz-btn--ghost nz-btn--sm", p.hecha ? "Deshacer" : "Hecha");
        b.addEventListener("click", function () {
          accion("POST", "/rutas/" + r.id + "/paradas/" + p.id, { hecha: !p.hecha }, p.hecha ? "Parada desmarcada" : "Parada marcada");
        });
        acc.appendChild(b);
        var bi = el("button", "nz-btn nz-btn--ghost nz-btn--sm", "Incidencia");
        bi.addEventListener("click", function () { incidenciaRapida(r, p, info); });
        acc.appendChild(bi);
      } else {
        acc.appendChild(el("span", "nz-badge nz-badge--neutral nz-badge--sm", p.hecha ? "hecha" : "pendiente"));
      }
      fila.appendChild(acc);
      caja.appendChild(fila);
    });
  }

  function incidenciaRapida(r, p, contenedor) {
    if (contenedor.querySelector(".mc-incidencia")) return;
    var caja = el("div", "mc-incidencia");
    var sel = el("select", "nz-select");
    ["contenedor_lleno", "acceso_bloqueado", "contenedor_roto", "no_estaba", "otra"].forEach(function (t) {
      var o = el("option", null, t.replace(/_/g, " "));
      o.value = t;
      sel.appendChild(o);
    });
    var txt = el("input", "nz-input");
    txt.type = "text";
    txt.placeholder = "¿qué pasa?";
    var b = el("button", "nz-btn nz-btn--sm", "Guardar");
    b.addEventListener("click", function () {
      accion("POST", "/rutas/" + r.id + "/paradas/" + p.id,
        { hecha: false, incidencia: { tipo: sel.value, texto: txt.value } }, "Incidencia anotada");
    });
    [sel, txt, b].forEach(function (n) { caja.appendChild(n); });
    contenedor.appendChild(caja);
  }

  function pintarIncidencias(r) {
    var panel = $("#ruta-incidencias-panel");
    panel.hidden = !r.incidencias.length;
    var caja = $("#lista-incidencias");
    vaciar(caja);
    r.incidencias.forEach(function (i) {
      var fila = el("div", "mc-parada");
      fila.appendChild(el("span", "nz-badge nz-badge--warning nz-badge--sm", i.tipo.replace(/_/g, " ")));
      fila.appendChild(el("div", "mc-parada__dir", i.texto || "(sin detalle)"));
      fila.appendChild(el("span", "nz-text--small nz-text--muted", "parada " + (i.parada_id || "—") + " · " + fechaCorta(i.creada_en)));
      caja.appendChild(fila);
    });
  }

  // ── mapa ───────────────────────────────────────────────────────────────────
  function urlIGN(capa) {
    return "https://www.ign.es/wmts/ign-base?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" + capa +
      "&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg";
  }

  function datosMapa(r) {
    var puntos = r.paradas.map(function (p) {
      return {
        type: "Feature",
        properties: { orden: p.orden, hecha: p.hecha ? 1 : 0, dir: p.direccion || p.isla_id, kg: p.kg_previstos },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] }
      };
    });
    var linea = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: r.paradas.map(function (p) { return [p.lon, p.lat]; }) }
    };
    return { type: "FeatureCollection", features: [linea].concat(puntos) };
  }

  function pintarMapa(r) {
    if (!window.maplibregl) { aviso("No se pudo cargar el mapa", "danger"); return; }
    if (!MAPA) {
      MAPA = new maplibregl.Map({
        container: "mapa",
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster", tileSize: 256, maxzoom: 19,
              tiles: [urlIGN("IGNBase-gris")],
              attribution: "© IGN · Ayuntamiento de Madrid"
            }
          },
          layers: [{ id: "base", type: "raster", source: "base" }]
        },
        center: [-3.7038, 40.4168],
        zoom: 12,
        attributionControl: { compact: true }
      });
      MAPA.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    var colocar = function () {
      var fuente = MAPA.getSource("recorrido");
      if (fuente) { fuente.setData(datosMapa(r)); }
      else {
        try {
        MAPA.addSource("recorrido", { type: "geojson", data: datosMapa(r) });
        MAPA.addLayer({
          id: "recorrido-linea", type: "line", source: "recorrido",
          filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": COL.info, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 4], "line-opacity": 0.85 }
        });
        MAPA.addLayer({
          id: "parada-pendiente", type: "circle", source: "recorrido",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "hecha"], 0]],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 8], "circle-color": COL.aviso, "circle-stroke-width": 1.5, "circle-stroke-color": COL.fondo }
        });
        MAPA.addLayer({
          id: "parada-hecha", type: "circle", source: "recorrido",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "hecha"], 1]],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6], "circle-color": COL.exito, "circle-stroke-width": 1.5, "circle-stroke-color": COL.fondo }
        });
        } catch (e) {
          // Sin esto, un fallo de una capa se lleva por delante el encuadre de la ruta.
          aviso("El mapa no pudo pintar el recorrido: " + e.message, "danger");
        }
        // El número de cada parada va en la lista, no pintado encima del mapa: una capa de
        // símbolos exigiría una fuente de glifos por CDN y sin ella MapLibre rechaza la capa.
      }
      if (r.paradas.length) {
        var lons = r.paradas.map(function (p) { return p.lon; });
        var lats = r.paradas.map(function (p) { return p.lat; });
        MAPA.fitBounds([[Math.min.apply(null, lons), Math.min.apply(null, lats)], [Math.max.apply(null, lons), Math.max.apply(null, lats)]], { padding: 40, duration: 0 });
      }
    };
    if (MAPA.loaded()) colocar(); else MAPA.once("load", colocar);
    setTimeout(function () { try { MAPA.resize(); } catch (e) { /* aún sin tamaño */ } }, 50);
  }

  // ── vista: planificar ──────────────────────────────────────────────────────
  function verNueva() {
    if (!$("#n-fecha").value) $("#n-fecha").value = hoy();
    return Promise.resolve();
  }

  function planificar(e) {
    e.preventDefault();
    var error = $("#nueva-error");
    error.hidden = true;
    var cuerpo = {
      fecha: $("#n-fecha").value,
      turno: $("#n-turno").value,
      fraccion: $("#n-fraccion").value,
      distrito: $("#n-distrito").value || null,
      camion: $("#n-camion").value || null,
      notas: null
    };
    if ($("#n-islas").value) cuerpo.max_islas = Number($("#n-islas").value);
    if ($("#n-conductor").value) cuerpo.conductor_id = Number($("#n-conductor").value);
    $("#btn-planificar").disabled = true;
    pide("POST", "/rutas", cuerpo)
      .then(function (r) {
        aviso("Ruta #" + r.id + " planificada: " + r.islas_planificadas + " islas, " + num(r.kg_previstos) + " kg, " + num(r.km_planificados, 1) + " km", "success");
        ir("ruta", r.id);
      })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
        PANEL.errores.push(err.message);
      })
      .finally(function () { $("#btn-planificar").disabled = false; });
  }

  // ── vista: kilos ───────────────────────────────────────────────────────────
  function verKilos() {
    var q = "?desde=" + ($("#k-desde").value || "2000-01-01") + "&hasta=" + ($("#k-hasta").value || "2100-01-01");
    return pide("GET", "/kilos/resumen" + q).then(function (r) {
      PANEL.kilos = r;
      var totalKg = r.porFraccion.reduce(function (s, f) { return s + (f.kg || 0); }, 0);
      var totalRutas = r.porFraccion.reduce(function (s, f) { return s + f.rutas; }, 0);
      var totalKm = r.porFraccion.reduce(function (s, f) { return s + (f.km || 0); }, 0);
      var k = $("#kpis-kilos");
      vaciar(k);
      k.appendChild(kpi("Kilos recogidos", num(Math.round(totalKg)) + " kg", "de partes cerrados", true));
      k.appendChild(kpi("Rutas cerradas", num(totalRutas), "en el rango elegido"));
      k.appendChild(kpi("Kilómetros", num(totalKm, 1) + " km", totalRutas ? num(totalKm / totalRutas, 1) + " km por ruta" : ""));
      k.appendChild(kpi("Desvío medio", r.desvioMedio.n ? num(r.desvioMedio.media, 1) + " %" : "—", "real sobre lo previsto (" + r.desvioMedio.n + " partes)", true));

      var tf = $("#cuerpo-kilos-fraccion"); vaciar(tf);
      r.porFraccion.forEach(function (f) {
        var tr = el("tr");
        tr.appendChild(el("td", null, f.fraccion));
        tr.appendChild(el("td", "nz-table__num", num(f.rutas)));
        tr.appendChild(el("td", "nz-table__num", num(Math.round(f.kg)) + " kg"));
        tr.appendChild(el("td", "nz-table__num", num(f.km, 1) + " km"));
        tf.appendChild(tr);
      });
      var td = $("#cuerpo-kilos-distrito"); vaciar(td);
      r.porDistrito.forEach(function (d) {
        var tr = el("tr");
        tr.appendChild(el("td", null, d.distrito || "(sin distrito)"));
        tr.appendChild(el("td", "nz-table__num", num(d.rutas)));
        tr.appendChild(el("td", "nz-table__num", num(Math.round(d.kg)) + " kg"));
        td.appendChild(tr);
      });
      var tc = $("#cuerpo-kilos-conductor"); vaciar(tc);
      r.porConductor.forEach(function (c) {
        var tr = el("tr");
        tr.appendChild(el("td", null, c.conductor || "—"));
        tr.appendChild(el("td", "nz-table__num", num(c.rutas)));
        tr.appendChild(el("td", "nz-table__num", num(Math.round(c.kg)) + " kg"));
        tc.appendChild(tr);
      });
      if (!r.porFraccion.length) {
        tf.appendChild(filaVacia("Todavía no hay ninguna ruta cerrada en ese rango."));
      }
      return r;
    });
  }

  function filaVacia(texto) {
    var tr = el("tr");
    var td = el("td", "mc-vacio", texto);
    td.colSpan = 6;
    tr.appendChild(td);
    return tr;
  }

  // ── vista: administración ──────────────────────────────────────────────────
  function verAdmin() {
    if (!puede("admin")) return Promise.resolve();
    return Promise.all([pide("GET", "/usuarios"), pide("GET", "/auditoria")]).then(function (rs) {
      var usuarios = rs[0].usuarios;
      PANEL.usuarios = usuarios;
      PANEL.auditoria = rs[1].auditoria;
      var cuerpo = $("#cuerpo-usuarios");
      vaciar(cuerpo);
      usuarios.forEach(function (u) {
        var tr = el("tr");
        tr.appendChild(el("td", null, u.nombre));
        tr.appendChild(el("td", null, u.email));
        var tdRol = el("td");
        var sel = el("select", "nz-select");
        ["admin", "planificador", "conductor", "invitado"].forEach(function (r) {
          var o = el("option", null, r);
          o.value = r;
          if (u.rol === r) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () {
          accion("PATCH", "/usuarios/" + u.id, { rol: sel.value }, "Rol de " + u.nombre + " → " + sel.value);
        });
        tdRol.appendChild(sel);
        tr.appendChild(tdRol);
        tr.appendChild(el("td", null, fechaCorta(u.creado_en)));
        tr.appendChild(el("td", null, u.ultimo_acceso ? fechaCorta(u.ultimo_acceso) : "nunca"));
        var tdEst = el("td");
        tdEst.appendChild(el("span", "nz-badge nz-badge--sm " + (u.activo ? "nz-badge--success" : "nz-badge--danger"), u.activo ? "activa" : "de baja"));
        tr.appendChild(tdEst);
        var tdAcc = el("td");
        var caja = el("div", "mc-tabla-acciones");
        var b = el("button", "nz-btn nz-btn--ghost nz-btn--sm", u.activo ? "Dar de baja" : "Reactivar");
        b.addEventListener("click", function () {
          accion("PATCH", "/usuarios/" + u.id, { activo: !u.activo }, u.activo ? "Cuenta de baja" : "Cuenta reactivada").then(verAdmin);
        });
        caja.appendChild(b);
        tdAcc.appendChild(caja);
        tr.appendChild(tdAcc);
        cuerpo.appendChild(tr);
      });

      var ca = $("#cuerpo-auditoria");
      vaciar(ca);
      rs[1].auditoria.forEach(function (a) {
        var tr = el("tr");
        tr.appendChild(el("td", null, fechaCorta(a.ts)));
        tr.appendChild(el("td", null, a.email || "—"));
        tr.appendChild(el("td", null, a.accion));
        tr.appendChild(el("td", null, (a.entidad || "") + (a.entidad_id ? " #" + a.entidad_id : "")));
        var td = el("td", "mc-auditoria__detalle", a.detalle || "");
        tr.appendChild(td);
        ca.appendChild(tr);
      });
      return rs;
    });
  }

  function crearUsuario(e) {
    e.preventDefault();
    var error = $("#usuario-error");
    error.hidden = true;
    pide("POST", "/usuarios", {
      nombre: $("#u-nombre").value.trim(),
      email: $("#u-email").value.trim(),
      rol: $("#u-rol").value,
      clave: $("#u-clave").value
    })
      .then(function (r) {
        aviso("Cuenta creada: " + r.usuario.email + " (" + r.usuario.rol + ")", "success");
        $("#form-usuario").reset();
        return cargarConductores().then(verAdmin);
      })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
        PANEL.errores.push(err.message);
      });
  }

  // ── vista: sala de control ─────────────────────────────────────────────────
  // El dashboard del gemelo digital: cifras del día, todas las rutas sobre el mapa, reparto
  // por fracción, serie de días y el modelo de carga. Todo sale de /api/sala en una llamada.
  var SALA_MAPA = null;
  var SALA_RELOJ = null;                 // auto-refresco mientras la vista está abierta
  var SALA_ANIMA = null;                 // modo directo: los camiones avanzan por su recorrido
  var SALA_CAMIONES = {};

  function abrev(f) {
    if (f === "Papel-Cartón") return "PC";
    if (f === "Orgánica") return "ORG";
    return String(f).slice(0, 3).toUpperCase();
  }

  function verSala() {
    var fecha = $("#sala-fecha").value || hoy();
    return pide("GET", "/sala?fecha=" + fecha + "&dias=14").then(function (s) {
      PANEL.sala = s;
      pintarSala(s);
    }).catch(function (e) {
      PANEL.errores.push(e.message);
      $("#sala-lead").textContent = "No pude cargar la sala: " + e.message;
    });
  }

  function relojSala(encender) {
    if (SALA_RELOJ) { clearInterval(SALA_RELOJ); SALA_RELOJ = null; }
    if (encender) {
      SALA_RELOJ = setInterval(function () {
        if (PANEL.vista === "sala" && !SALA_ANIMA) verSala();
      }, 60000);
    }
  }

  function pintarSala(s) {
    var k = s.kpis;
    $("#sala-lead").textContent = fechaCorta(s.fecha) + " · " + k.rutas + " rutas · " +
      num(k.islas) + " islas de contenedores · " + num(k.contenedores) + " contenedores · actualizado a las " +
      s.generado.slice(11, 16);

    var pct = k.kg_previstos ? Math.round((k.kg_reales / k.kg_previstos) * 100) : 0;
    var rej = $("#sala-kpis");
    vaciar(rej);
    rej.appendChild(kpi("Kilos recogidos", num(k.kg_reales) + " kg",
      pct + " % de lo previsto (" + num(k.kg_previstos) + " kg)", true));
    rej.appendChild(kpi("Rutas del día", num(k.rutas),
      "en curso " + k.camiones_en_curso + " · sin asignar " + k.sin_asignar));
    rej.appendChild(kpi("Avance de paradas", k.progreso_pct + " %",
      num(k.paradas_hechas) + " de " + num(k.paradas) + " paradas hechas"));
    rej.appendChild(kpi("Recorrido previsto", num(k.km, 1) + " km",
      num(k.horas, 1) + " h de trabajo estimado"));
    rej.appendChild(kpi("Desvío medio", k.desvio_pct === null ? "—" : (k.desvio_pct > 0 ? "+" : "") + k.desvio_pct + " %",
      "en las " + k.porEstado.cerrada + " rutas ya cerradas"));
    rej.appendChild(kpi("Incidencias", num(k.incidencias),
      k.incidencias ? "aparecen en el detalle de cada ruta" : "ninguna ese día"));
    rej.appendChild(kpi("Contenedores servidos", num(k.contenedores), "en las rutas de ese día"));
    rej.appendChild(kpi("Capacidad instalada", num(Math.round(k.litros / 1000)) + " m³", "litros de los contenedores previstos"));

    pintarListaSala(s);
    pintarBarrasSala(s);
    pintarDonutSala(s);
    pintarLineaSala(s);
    pintarCargaSala(s);
    pintarMapaSala(s);
    pintarHonestidad(s);
  }

  function pintarListaSala(s) {
    $("#sala-n-rutas").textContent = s.rutas.length + (s.rutas.length === 1 ? " ruta" : " rutas");
    var caja = $("#sala-rutas");
    vaciar(caja);
    if (!s.rutas.length) {
      caja.appendChild(el("p", "mc-vacio", "Ese día no hay rutas planificadas. Crea una en «Planificar»."));
      return;
    }
    s.rutas.forEach(function (r) {
      var fila = el("div", "mc-sala-ruta");
      var punto = el("i", "mc-punto");
      punto.style.background = r.color || "var(--nz-brand)";
      fila.appendChild(punto);

      var centro = el("div", "mc-sala-ruta__centro");
      centro.appendChild(el("span", "mc-sala-ruta__titulo", (r.distrito || "Madrid") + " · " + r.fraccion));
      centro.appendChild(el("span", "nz-text--small nz-text--muted",
        r.turno + " · " + (r.conductor || "sin asignar") + " · " + num(r.islas) + " islas · " + num(r.km, 1) + " km"));
      var barra = el("div", "mc-barra");
      var relleno = el("div", "mc-barra__relleno");
      relleno.style.width = r.progreso_pct + "%";
      relleno.style.background = r.color || "var(--nz-brand)";
      barra.appendChild(relleno);
      centro.appendChild(barra);
      fila.appendChild(centro);

      var dcha = el("div", "mc-sala-ruta__dcha");
      dcha.appendChild(el("span", "nz-badge " + (BADGE[r.estado] || "nz-badge--neutral") + " nz-badge--sm", r.estado));
      dcha.appendChild(el("span", "nz-text--small nz-text--muted", num(r.hechas) + "/" + num(r.paradas) + " paradas"));
      dcha.appendChild(el("span", "nz-text--small", r.kg_real ? num(Math.round(r.kg_real)) + " kg reales" : num(r.kg_previstos) + " kg previstos"));
      var ver = el("button", "nz-btn nz-btn--ghost nz-btn--sm", "Abrir");
      ver.setAttribute("data-ruta", r.id);
      dcha.appendChild(ver);
      fila.appendChild(dcha);
      caja.appendChild(fila);
    });
  }

  function pintarBarrasSala(s) {
    var caja = $("#sala-barras");
    vaciar(caja);
    var datos = s.porFraccion || [];
    if (!datos.length) { caja.appendChild(el("p", "mc-vacio", "Sin kilos que mostrar ese día.")); return; }
    var tope = Math.max.apply(null, datos.map(function (d) { return Math.max(d.kg_previstos, d.kg_reales); })) || 1;
    datos.forEach(function (d) {
      var col = el("div", "nz-chart-bar__col");
      col.appendChild(el("span", "nz-chart-bar__value", num(d.kg_previstos)));
      var barra = el("div", "nz-chart-bar__bar");
      barra.style.height = Math.max(4, Math.round((d.kg_previstos / tope) * 100)) + "%";
      barra.style.background = d.color || "var(--nz-brand)";
      barra.setAttribute("data-etiqueta", d.fraccion);
      barra.setAttribute("data-valor", num(d.kg_previstos) + " kg previstos · " + num(d.kg_reales) +
        " kg reales · " + d.rutas + (d.rutas === 1 ? " ruta" : " rutas"));
      col.appendChild(barra);
      col.appendChild(el("span", "nz-chart-bar__label", abrev(d.fraccion)));
      caja.appendChild(col);
    });
    var ley = $("#sala-barras-leyenda");
    vaciar(ley);
    datos.forEach(function (d) {
      var it = el("span", "nz-legend__item");
      var sw = el("i", "mc-punto");
      sw.style.background = d.color || "var(--nz-brand)";
      it.appendChild(sw);
      it.appendChild(document.createTextNode(d.fraccion + " · " + num(d.kg_previstos) + " kg"));
      ley.appendChild(it);
    });
  }

  function pintarDonutSala(s) {
    var caja = $("#sala-donut");
    vaciar(caja);
    var total = (s.porFraccion || []).reduce(function (t, d) { return t + d.kg_previstos; }, 0);
    if (!total) { caja.appendChild(el("p", "mc-vacio", "Sin kilos que repartir ese día.")); return; }
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "nz-chart-donut__svg");
    svg.setAttribute("viewBox", "0 0 42 42");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Reparto de kilos previstos por fracción");
    var track = document.createElementNS(NS, "circle");
    track.setAttribute("class", "nz-chart-donut__track");
    ["cx", "cy"].forEach(function (a) { track.setAttribute(a, "21"); });
    track.setAttribute("r", "15.9");
    svg.appendChild(track);
    var desfase = 0;
    s.porFraccion.forEach(function (d) {
      var parte = (d.kg_previstos / total) * 100;
      var seg = document.createElementNS(NS, "circle");
      seg.setAttribute("class", "nz-chart-donut__seg");
      seg.setAttribute("cx", "21");
      seg.setAttribute("cy", "21");
      seg.setAttribute("r", "15.9");
      seg.setAttribute("stroke-dasharray", parte.toFixed(2) + " " + (100 - parte).toFixed(2));
      seg.setAttribute("stroke-dashoffset", (-desfase).toFixed(2));
      seg.setAttribute("stroke", d.color || "var(--nz-brand)");
      seg.setAttribute("data-etiqueta", d.fraccion);
      seg.setAttribute("data-valor", num(d.kg_previstos) + " kg · " + Math.round(parte) + " % del día");
      svg.appendChild(seg);
      desfase += parte;
    });
    caja.appendChild(svg);
    var centro = el("div", "nz-chart-donut__center");
    centro.appendChild(el("span", "nz-chart-donut__value", num(Math.round(total))));
    centro.appendChild(el("span", "nz-chart-donut__label", "kg del día"));
    caja.appendChild(centro);
  }

  function pintarLineaSala(s) {
    var caja = $("#sala-linea");
    vaciar(caja);
    var serie = s.serie || [];
    var pie = $("#sala-linea-pie");
    vaciar(pie);
    if (serie.length < 2) {
      caja.appendChild(el("p", "mc-vacio", "Hacen falta al menos dos días con rutas para ver la tendencia."));
      pie.appendChild(el("span", "nz-chart__source", "Días con rutas en el periodo: " + serie.length));
      return;
    }
    var valores = serie.map(function (d) { return d.kg_reales || d.kg_previstos; });
    var tope = Math.max.apply(null, valores) || 1;
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "nz-chart-line__svg");
    svg.setAttribute("viewBox", "0 0 300 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Kilos por día en el periodo");
    var puntos = valores.map(function (v, i) {
      var x = (i / (serie.length - 1)) * 300;
      return [x, 96 - (v / tope) * 86];
    });
    var camino = puntos.map(function (p, i) {
      return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1);
    }).join(" ");
    var area = document.createElementNS(NS, "path");
    area.setAttribute("class", "nz-chart-line__area");
    area.setAttribute("d", camino + " L300,100 L0,100 Z");
    svg.appendChild(area);
    var linea = document.createElementNS(NS, "path");
    linea.setAttribute("class", "nz-chart-line__path");
    linea.setAttribute("d", camino);
    svg.appendChild(linea);
    puntos.forEach(function (p, i) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "nz-chart-line__dot" + (i === puntos.length - 1 ? " nz-chart-line__dot--active" : ""));
      c.setAttribute("cx", p[0].toFixed(1));
      c.setAttribute("cy", p[1].toFixed(1));
      c.setAttribute("r", i === puntos.length - 1 ? "4" : "3");
      c.setAttribute("data-etiqueta", serie[i].fecha);
      c.setAttribute("data-valor", num(Math.round(valores[i])) + " kg · " + serie[i].rutas + " rutas · " + num(serie[i].km, 1) + " km");
      svg.appendChild(c);
    });
    caja.appendChild(svg);
    pie.appendChild(el("span", "nz-chart__source", "Máximo del periodo: " + num(Math.round(tope)) +
      " kg · días con rutas: " + serie.length + " · el punto lleno es el último día"));
  }

  function pintarCargaSala(s) {
    var caja = $("#sala-carga");
    vaciar(caja);
    var pie = $("#sala-carga-pie");
    vaciar(pie);
    var datos = (s.red.porFraccion || []).filter(function (f) { return f.carga_pct !== null; });
    if (!datos.length) { caja.appendChild(el("p", "mc-vacio", "Sin datos de carga.")); return; }
    datos.forEach(function (f) {
      var col = el("div", "nz-chart-bar__col");
      col.appendChild(el("span", "nz-chart-bar__value", f.carga_pct + " %"));
      var barra = el("div", "nz-chart-bar__bar");
      barra.style.height = Math.max(4, Math.min(100, Math.round(f.carga_pct))) + "%";
      barra.style.background = f.color || "var(--nz-brand)";
      barra.setAttribute("data-etiqueta", f.fraccion);
      barra.setAttribute("data-valor", "carga media " + f.carga_pct + " % · " + num(f.kg_dia) +
        " kg/día · densidad declarada " + f.densidad + " kg/l · " + num(f.contenedores) + " contenedores");
      col.appendChild(barra);
      col.appendChild(el("span", "nz-chart-bar__label", abrev(f.fraccion)));
      caja.appendChild(col);
    });
    var dens = Object.keys(s.modelo.densidades_kg_l || {}).map(function (f) {
      return f + " " + String(s.modelo.densidades_kg_l[f]).replace(".", ",");
    }).join(" · ");
    pie.appendChild(el("span", "nz-chart__source",
      "Modelo: kg/día reales ÷ litros reales del inventario ÷ densidad declarada (" + dens + " kg/l). " +
      "100 % = la recogida del día cuadra con la capacidad; por encima, la densidad declarada se queda corta."));
  }

  function pintarMapaSala(s) {
    if (!window.maplibregl) { aviso("No se pudo cargar el mapa", "danger"); return; }
    if (!SALA_MAPA) {
      SALA_MAPA = new maplibregl.Map({
        container: "sala-mapa",
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster", tileSize: 256, maxzoom: 19,
              tiles: [urlIGN("IGNBase-gris")],
              attribution: "© IGN · Ayuntamiento de Madrid"
            }
          },
          layers: [{ id: "base", type: "raster", source: "base" }]
        },
        center: [-3.7038, 40.4168], zoom: 11.2, maxZoom: 19, minZoom: 9,
        attributionControl: { compact: true }
      });
      SALA_MAPA.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      PANEL.salaMapa = SALA_MAPA;
    }

    var geo = { type: "FeatureCollection", features: [] };
    (s.mapa.rutas || []).forEach(function (r) {
      if (r.linea.length > 1) {
        geo.features.push({
          type: "Feature",
          properties: { color: r.color || COL.info || "#1d6fa5", estado: r.estado, id: r.id },
          geometry: { type: "LineString", coordinates: r.linea }
        });
      }
      r.paradas.forEach(function (p) {
        geo.features.push({
          type: "Feature",
          properties: { color: r.color || COL.info || "#1d6fa5", hecha: p.hecha ? 1 : 0, ruta: r.id, orden: p.orden },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] }
        });
      });
    });

    var colocar = function () {
      var fuente = SALA_MAPA.getSource("sala");
      if (fuente) { fuente.setData(geo); }
      else {
        try {
          SALA_MAPA.addSource("sala", { type: "geojson", data: geo });
          SALA_MAPA.addLayer({
            id: "sala-linea", type: "line", source: "sala",
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
              "line-opacity": 0.75
            }
          });
          SALA_MAPA.addLayer({
            id: "sala-parada", type: "circle", source: "sala",
            filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "hecha"], 0]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.2, 16, 5],
              "circle-color": ["get", "color"], "circle-opacity": 0.55,
              "circle-stroke-width": 1, "circle-stroke-color": COL.fondo || "#ffffff"
            }
          });
          SALA_MAPA.addLayer({
            id: "sala-hecha", type: "circle", source: "sala",
            filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "hecha"], 1]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.2, 16, 5],
              "circle-color": COL.exito || "#1f7a3d", "circle-opacity": 0.9,
              "circle-stroke-width": 1, "circle-stroke-color": COL.fondo || "#ffffff"
            }
          });
        } catch (e) {
          aviso("El mapa de la sala no pudo pintar las rutas: " + e.message, "danger");
        }
      }
      var puntos = geo.features.filter(function (f) { return f.geometry.type === "Point"; })
        .map(function (f) { return f.geometry.coordinates; });
      if (puntos.length) {
        var caja = new maplibregl.LngLatBounds();
        puntos.forEach(function (c) { caja.extend(c); });
        SALA_MAPA.fitBounds(caja, { padding: 45, duration: 0 });
      }
      SALA_MAPA.resize();
    };
    if (SALA_MAPA.isStyleLoaded()) colocar();
    else SALA_MAPA.once("load", colocar);

    $("#sala-mapa-sub").textContent = s.mapa.mostradas + " de " + s.mapa.total_rutas +
      " rutas dibujadas · el punto verde es parada hecha · sin GPS: la posición de los camiones se reconstruye de su orden de paradas";
    var ley = $("#sala-mapa-leyenda");
    vaciar(ley);
    (s.porFraccion || []).forEach(function (d) {
      var it = el("span", "nz-legend__item");
      var sw = el("i", "mc-punto");
      sw.style.background = d.color || "var(--nz-brand)";
      it.appendChild(sw);
      it.appendChild(document.createTextNode(d.fraccion));
      ley.appendChild(it);
    });
    pintarCamiones(s);
  }

  /** Un camión por ruta en curso, sobre la última parada marcada. */
  function pintarCamiones(s) {
    Object.keys(SALA_CAMIONES).forEach(function (id) { SALA_CAMIONES[id].remove(); });
    SALA_CAMIONES = {};
    PANEL.camiones = SALA_CAMIONES;
    (s.mapa.rutas || []).forEach(function (r) {
      if (r.estado !== "en_curso" || r.paradas.length < 2) return;
      var nodo = el("div", "mc-camion");
      nodo.setAttribute("title", "Ruta #" + r.id + " · " + (r.conductor || "sin conductor"));
      nodo.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7h11v9H2z"/><path d="M13 10h4l4 4v2h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>';
      var marcador = new maplibregl.Marker({ element: nodo, anchor: "center" });
      var hechas = r.paradas.filter(function (p) { return p.hecha; }).length;
      var i = Math.min(hechas, r.paradas.length - 1);
      marcador.setLngLat([r.paradas[i].lon, r.paradas[i].lat]).addTo(SALA_MAPA);
      SALA_CAMIONES[r.id] = marcador;
    });
  }

  function pararDirecto() {
    if (SALA_ANIMA) { clearInterval(SALA_ANIMA); SALA_ANIMA = null; }
    var b = $("#sala-directo");
    if (b) { b.classList.remove("is-active"); b.setAttribute("aria-pressed", "false"); }
  }

  /**
   * Modo directo: los camiones avanzan por su recorrido. Es una RECONSTRUCCIÓN de la posición
   * a partir del orden de paradas, no telemetría: no hay GPS ni sensores (no son públicos).
   * Los kilos y las paradas que se ven son los de verdad; lo único inventado sería el punto
   * exacto del camión entre dos paradas, y por eso se dice.
   */
  function conmutarDirecto() {
    if (SALA_ANIMA) { pararDirecto(); return; }
    var b = $("#sala-directo");
    b.classList.add("is-active");
    b.setAttribute("aria-pressed", "true");
    var paso = 0;
    SALA_ANIMA = setInterval(function () {
      paso += 1;
      var s = PANEL.sala;
      if (!s || !SALA_MAPA) return;
      (s.mapa.rutas || []).forEach(function (r) {
        var m = SALA_CAMIONES[r.id];
        if (!m || r.paradas.length < 2) return;
        var hechas = r.paradas.filter(function (p) { return p.hecha; }).length;
        var desde = Math.min(hechas, r.paradas.length - 2);
        var a = r.paradas[desde];
        var z = r.paradas[desde + 1];
        var avance = (paso / 6) % 1;
        m.setLngLat([a.lon + (z.lon - a.lon) * avance, a.lat + (z.lat - a.lat) * avance]);
      });
    }, 700);
  }

  /** El cartel de honestidad: qué es dato real y qué es modelo, con los números del servidor. */
  function pintarHonestidad(s) {
    var m = s.modelo, k = s.kpis;
    var dens = Object.keys(m.densidades_kg_l || {}).map(function (f) {
      return f + " " + String(m.densidades_kg_l[f]).replace(".", ",") + " kg/l";
    }).join(" · ");
    var cajon = $("#sala-honestidad");
    vaciar(cajon);
    [
      "REAL · los contenedores y sus litros, del inventario municipal (CC-BY 4.0); las toneladas mensuales del Ayuntamiento (2017-2026); los kilos que cierran los conductores en cada parte; los km y las paradas que estás viendo.",
      "MODELADO · los kilos previstos de una ruta salen de las toneladas REALES del distrito repartidas entre sus contenedores, no de una medición. La carga media: kg/día reales ÷ litros reales ÷ densidad declarada (" + dens + ", meses de referencia " + (m.meses_referencia || []).join(", ") + "), suponiendo que la recogida del día vacía el contenedor.",
      "NO DISPONIBLE · el llenado de cada contenedor (el sensor no es público) y el GPS de los camiones. Por eso el modo directo avanza los camiones por su orden de paradas: es una reconstrucción, no telemetría.",
      "Este día: " + num(k.rutas) + " rutas · " + num(k.paradas) + " paradas · " + num(k.kg_previstos) + " kg previstos · camión de Resto " + num(m.capacidad_camion_kg.Resto) + " kg · velocidad declarada " + m.velocidad_media_kmh + " km/h."
    ].forEach(function (t) {
      cajon.appendChild(el("p", "nz-text--small", t));
    });
  }

  // ── enganches ──────────────────────────────────────────────────────────────
  function enganchar() {
    $("#form-acceso").addEventListener("submit", entrar);
    $("#btn-salir").addEventListener("click", salir);
    $("#btn-volver").addEventListener("click", function () { ir("hoy"); });
    $("#btn-refrescar").addEventListener("click", verHoy);
    $("#sala-refrescar").addEventListener("click", verSala);
    $("#sala-fecha").addEventListener("change", verSala);
    $("#sala-directo").addEventListener("click", conmutarDirecto);
    $("#sala-rutas").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-ruta]");
      if (b) ir("ruta", Number(b.getAttribute("data-ruta")));
    });
    $("#btn-kilos").addEventListener("click", verKilos);
    $("#form-ruta").addEventListener("submit", planificar);
    $("#form-usuario").addEventListener("submit", crearUsuario);
    $("#f-estado").addEventListener("change", verHoy);
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      b.addEventListener("click", function () { ir(b.getAttribute("data-vista")); });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    enganchar();
    // si ya hay sesión abierta (cookie viva), entra sin pedir nada
    pide("GET", "/yo").then(function (r) {
      USUARIO = r.usuario;
      PERMISOS = r.permisos;
      arrancar();
    }).catch(function () { $("#inp-email").focus(); });
  });
})();

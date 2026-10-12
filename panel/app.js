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

  var PANEL = { usuario: null, vista: "", rutas: [], ruta: null, kilos: null, usuarios: [], auditoria: [], errores: [], listo: false };
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
      ir("hoy");
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
    ["hoy", "ruta", "nueva", "kilos", "admin"].forEach(function (v) {
      $("#v-" + v).hidden = v !== vista;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-vista") === vista);
      b.hidden = !puede(b.getAttribute("data-minimo"));
    });
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
      info.appendChild(el("div", "nz-text-xs nz-text-mute", p.contenedores + " contenedores · " + num(p.kg_previstos) + " kg previstos"));
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
      fila.appendChild(el("span", "nz-text-xs nz-text-mute", "parada " + (i.parada_id || "—") + " · " + fechaCorta(i.creada_en)));
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

  // ── enganches ──────────────────────────────────────────────────────────────
  function enganchar() {
    $("#form-acceso").addEventListener("submit", entrar);
    $("#btn-salir").addEventListener("click", salir);
    $("#btn-volver").addEventListener("click", function () { ir("hoy"); });
    $("#btn-refrescar").addEventListener("click", verHoy);
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

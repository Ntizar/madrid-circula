-- Esquema de MADRID CIRCULA. SQLite, sin dependencias.
-- La base nace de los datos reales del Ayuntamiento (datos/red.json y datos/toneladas.json);
-- lo que se escribe a mano después es la gestión: usuarios, rutas, partes e incidencias.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Gestión ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre     TEXT NOT NULL,
  rol        TEXT NOT NULL CHECK (rol IN ('admin', 'planificador', 'conductor', 'invitado')),
  hash       TEXT NOT NULL,
  sal        TEXT NOT NULL,
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL,
  ultimo_acceso TEXT
);

CREATE TABLE IF NOT EXISTS sesiones (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada_en  TEXT NOT NULL,
  expira_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON sesiones(usuario_id);

CREATE TABLE IF NOT EXISTS rutas (
  id                  INTEGER PRIMARY KEY,
  fecha               TEXT NOT NULL,
  turno               TEXT NOT NULL CHECK (turno IN ('mañana', 'tarde', 'noche')),
  fraccion            TEXT NOT NULL,
  distrito            TEXT,
  camion              TEXT,
  conductor_id        INTEGER REFERENCES usuarios(id),
  estado              TEXT NOT NULL DEFAULT 'borrador'
                      CHECK (estado IN ('borrador', 'asignada', 'en_curso', 'cerrada', 'anulada')),
  islas_planificadas  INTEGER NOT NULL DEFAULT 0,
  contenedores        INTEGER NOT NULL DEFAULT 0,
  litros              INTEGER NOT NULL DEFAULT 0,
  kg_previstos        REAL NOT NULL DEFAULT 0,
  km_planificados     REAL,
  horas_previstas     REAL,
  creada_por          INTEGER REFERENCES usuarios(id),
  creada_en           TEXT NOT NULL,
  asignada_en         TEXT,
  iniciada_en         TEXT,
  cerrada_en          TEXT,
  notas               TEXT
);
CREATE INDEX IF NOT EXISTS ix_rutas_fecha ON rutas(fecha, turno);
CREATE INDEX IF NOT EXISTS ix_rutas_conductor ON rutas(conductor_id, estado);

CREATE TABLE IF NOT EXISTS paradas (
  id           INTEGER PRIMARY KEY,
  ruta_id      INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
  orden        INTEGER NOT NULL,
  isla_id      TEXT NOT NULL,
  direccion    TEXT,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  contenedores INTEGER NOT NULL DEFAULT 0,
  litros       INTEGER NOT NULL DEFAULT 0,
  kg_previstos REAL NOT NULL DEFAULT 0,
  hecha        INTEGER NOT NULL DEFAULT 0,
  hecha_en     TEXT
);
CREATE INDEX IF NOT EXISTS ix_paradas_ruta ON paradas(ruta_id, orden);

CREATE TABLE IF NOT EXISTS partes (
  id            INTEGER PRIMARY KEY,
  ruta_id       INTEGER NOT NULL UNIQUE REFERENCES rutas(id) ON DELETE CASCADE,
  conductor_id  INTEGER REFERENCES usuarios(id),
  cerrado_en    TEXT NOT NULL,
  kg_total      REAL NOT NULL,
  kg_fraccion   REAL NOT NULL,
  desvio_pct    REAL,
  observaciones TEXT
);

CREATE TABLE IF NOT EXISTS incidencias (
  id          INTEGER PRIMARY KEY,
  ruta_id     INTEGER REFERENCES rutas(id) ON DELETE CASCADE,
  parada_id   INTEGER REFERENCES paradas(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  texto       TEXT,
  creada_por  INTEGER REFERENCES usuarios(id),
  creada_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_incidencias_ruta ON incidencias(ruta_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id         INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  accion     TEXT NOT NULL,
  entidad    TEXT,
  entidad_id TEXT,
  detalle    TEXT,
  ts         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_auditoria_ts ON auditoria(ts);

-- ── Datos reales del Ayuntamiento ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS islas (
  id           TEXT PRIMARY KEY,     -- código de punto de recogida del Ayuntamiento
  distrito     TEXT NOT NULL,
  direccion    TEXT,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  contenedores INTEGER NOT NULL DEFAULT 0,
  litros       INTEGER NOT NULL DEFAULT 0,
  fracciones   TEXT NOT NULL DEFAULT ''   -- lista separada por comas de las fracciones presentes
);
CREATE INDEX IF NOT EXISTS ix_islas_distrito ON islas(distrito);

CREATE TABLE IF NOT EXISTS contenedores (
  id         TEXT PRIMARY KEY,
  isla_id    TEXT NOT NULL REFERENCES islas(id),
  fraccion   TEXT NOT NULL,
  modelo     TEXT,
  carga      TEXT,
  lote       TEXT,
  litros     INTEGER NOT NULL DEFAULT 0,
  distrito   TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cont_fraccion ON contenedores(fraccion, distrito);
CREATE INDEX IF NOT EXISTS ix_cont_isla ON contenedores(isla_id);

-- kg/día modelados por distrito y fracción (derivados de las toneladas reales)
CREATE TABLE IF NOT EXISTS kg_dia (
  distrito TEXT NOT NULL,
  fraccion TEXT NOT NULL,
  kg_dia   REAL NOT NULL,
  PRIMARY KEY (distrito, fraccion)
);

-- serie mensual real de toneladas (ciudad)
CREATE TABLE IF NOT EXISTS serie_mes (
  mes      TEXT NOT NULL,      -- 'YYYY-MM'
  fraccion TEXT NOT NULL,
  kg       REAL NOT NULL,
  PRIMARY KEY (mes, fraccion)
);

-- metadatos y bloques crudos que la web ya sabe interpretar
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

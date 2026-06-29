CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cotizaciones (
    id BIGSERIAL PRIMARY KEY,
    dni TEXT,
    nombre TEXT,
    celular TEXT,
    plan TEXT,
    tipo_cobertura TEXT,
    valor TEXT,
    vendedora TEXT,
    comentarios TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    modalidad TEXT,
    vigencia TEXT,
    referido TEXT,
    congelamiento TEXT,
    bonificacion TEXT,
    bonificacion_aportes TEXT,
    estado TEXT NOT NULL DEFAULT 'Nuevo',
    fecha_seguimiento DATE
);

CREATE TABLE IF NOT EXISTS archivos (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT REFERENCES cotizaciones(id) ON DELETE CASCADE,
    nombre TEXT,
    archivo TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comentarios_cotizacion (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT REFERENCES cotizaciones(id) ON DELETE CASCADE,
    usuario TEXT,
    comentario TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cotizacion_opciones (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    numero_opcion INTEGER NOT NULL,
    plan TEXT,
    tipo_cobertura TEXT,
    valor TEXT,
    bonificacion TEXT,
    bonificacion_aportes TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cotizacion_opciones_numero_opcion_check
        CHECK (numero_opcion IN (1, 2)),
    CONSTRAINT cotizacion_opciones_cotizacion_numero_unique
        UNIQUE (cotizacion_id, numero_opcion)
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_dni
    ON cotizaciones (dni);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_vendedora
    ON cotizaciones (vendedora);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado
    ON cotizaciones (estado);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha
    ON cotizaciones (fecha);

CREATE INDEX IF NOT EXISTS idx_archivos_cotizacion_id
    ON archivos (cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_comentarios_cotizacion_id
    ON comentarios_cotizacion (cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_cotizacion_opciones_cotizacion_id
    ON cotizacion_opciones (cotizacion_id);

-- Usuario admin inicial opcional.
-- Generar el hash con bcrypt antes de ejecutar y reemplazar el valor de password.
-- INSERT INTO usuarios (usuario, password, rol)
-- VALUES ('admin', '<bcrypt_hash>', 'admin')
-- ON CONFLICT (usuario) DO NOTHING;

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT NOT NULL,
    orden_login INTEGER
);

CREATE TABLE IF NOT EXISTS clientes (
    id BIGSERIAL PRIMARY KEY,
    identidad_tipo TEXT NOT NULL,
    identidad_valor TEXT NOT NULL,
    dni TEXT,
    dni_normalizado TEXT,
    nombre TEXT,
    celular TEXT,
    telefono_normalizado TEXT,
    vendedora_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    vendedora_asignada TEXT,
    etapa_comercial TEXT NOT NULL DEFAULT 'Nuevo',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT clientes_identidad_unique
        UNIQUE (identidad_tipo, identidad_valor),
    CONSTRAINT clientes_identidad_tipo_check
        CHECK (identidad_tipo IN ('dni', 'telefono')),
    CONSTRAINT clientes_etapa_comercial_check
        CHECK (etapa_comercial IN (
            'Nuevo',
            'Contactado',
            'Cotizado',
            'En seguimiento',
            'Afiliado',
            'No interesado'
        ))
);

CREATE TABLE IF NOT EXISTS cotizaciones (
    id BIGSERIAL PRIMARY KEY,
    cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id
    ON cotizaciones (cliente_id);

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

CREATE INDEX IF NOT EXISTS idx_clientes_dni_normalizado
    ON clientes (dni_normalizado);

CREATE INDEX IF NOT EXISTS idx_clientes_telefono_normalizado
    ON clientes (telefono_normalizado);

CREATE INDEX IF NOT EXISTS idx_clientes_nombre_lower
    ON clientes (LOWER(nombre));

CREATE INDEX IF NOT EXISTS idx_clientes_vendedora_id
    ON clientes (vendedora_id);

-- Usuario admin inicial opcional.
-- Generar el hash con bcrypt antes de ejecutar y reemplazar el valor de password.
-- INSERT INTO usuarios (usuario, password, rol)
-- VALUES ('admin', '<bcrypt_hash>', 'admin')
-- ON CONFLICT (usuario) DO NOTHING;

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
    fecha_seguimiento DATE,
    etapa_pipeline TEXT DEFAULT 'Nuevos',
    fecha_alta DATE,
    estado_posventa TEXT,
    fecha_actualizacion_posventa TIMESTAMPTZ,
    CONSTRAINT cotizaciones_etapa_pipeline_check
        CHECK (etapa_pipeline IN (
            'Nuevos',
            'Contactados',
            'Interesados',
            'Documentación',
            'Auditoría',
            'Afiliados'
        )),
    CONSTRAINT cotizaciones_estado_posventa_check
        CHECK (
            estado_posventa IS NULL
            OR estado_posventa IN (
                'en_seguimiento',
                'pago_3_meses',
                'pendiente_mora',
                'baja_mora'
            )
    )
);

CREATE TABLE IF NOT EXISTS primer_contacto_identidades (
    id BIGSERIAL PRIMARY KEY,
    telefono_original TEXT NOT NULL,
    telefono_normalizado TEXT NOT NULL,
    cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
    nombre TEXT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT primer_contacto_telefono_unique
        UNIQUE (telefono_normalizado),
    CONSTRAINT primer_contacto_telefono_check
        CHECK (LENGTH(TRIM(telefono_normalizado)) BETWEEN 8 AND 15)
);

CREATE TABLE IF NOT EXISTS primer_contacto_gestiones (
    id BIGSERIAL PRIMARY KEY,
    contacto_id BIGINT NOT NULL
        REFERENCES primer_contacto_identidades(id) ON DELETE CASCADE,
    usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    asesora TEXT NOT NULL,
    observacion TEXT,
    clave_idempotencia TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT primer_contacto_gestion_idempotente_unique
        UNIQUE (asesora, clave_idempotencia)
);

CREATE TABLE IF NOT EXISTS tareas_crm (
    id BIGSERIAL PRIMARY KEY,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    fecha DATE NOT NULL,
    hora TIME,
    tipo TEXT NOT NULL DEFAULT 'tarea',
    estado TEXT NOT NULL DEFAULT 'pendiente',
    usuario_responsable_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_responsable TEXT NOT NULL,
    cotizacion_id BIGINT REFERENCES cotizaciones(id) ON DELETE SET NULL,
    cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
    clave_automatica TEXT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tareas_crm_tipo_check
        CHECK (tipo IN ('tarea', 'seguimiento', 'recordatorio')),
    CONSTRAINT tareas_crm_estado_check
        CHECK (estado IN ('pendiente', 'realizada', 'cancelada'))
);

CREATE TABLE IF NOT EXISTS cotizaciones_posventa_historial (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    estado_anterior TEXT,
    estado_nuevo TEXT NOT NULL,
    fecha_alta DATE,
    usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cotizaciones_posventa_historial_estado_check
        CHECK (
            estado_nuevo IN (
                'en_seguimiento',
                'pago_3_meses',
                'pendiente_mora',
                'baja_mora'
            )
            AND (
                estado_anterior IS NULL
                OR estado_anterior IN (
                    'en_seguimiento',
                    'pago_3_meses',
                    'pendiente_mora',
                    'baja_mora'
                )
            )
        )
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

CREATE INDEX IF NOT EXISTS idx_cotizaciones_etapa_pipeline
    ON cotizaciones (etapa_pipeline);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_etapa_vendedora
    ON cotizaciones (etapa_pipeline, vendedora);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_alta
    ON cotizaciones (fecha_alta);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado_posventa
    ON cotizaciones (estado_posventa);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_cliente
    ON primer_contacto_identidades (cliente_id);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_gestiones_contacto_fecha
    ON primer_contacto_gestiones (contacto_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_gestiones_asesora_fecha
    ON primer_contacto_gestiones (asesora, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_archivos_cotizacion_id
    ON archivos (cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_comentarios_cotizacion_id
    ON comentarios_cotizacion (cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_cotizacion_opciones_cotizacion_id
    ON cotizacion_opciones (cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_tareas_crm_responsable_id
    ON tareas_crm (usuario_responsable_id);

CREATE INDEX IF NOT EXISTS idx_tareas_crm_responsable_texto
    ON tareas_crm (usuario_responsable);

CREATE INDEX IF NOT EXISTS idx_tareas_crm_fecha_estado
    ON tareas_crm (fecha, estado);

CREATE INDEX IF NOT EXISTS idx_tareas_crm_cotizacion_id
    ON tareas_crm (cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_tareas_crm_cliente_id
    ON tareas_crm (cliente_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_crm_posventa
    ON tareas_crm (cotizacion_id, clave_automatica)
    WHERE clave_automatica IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posventa_historial_cotizacion_fecha
    ON cotizaciones_posventa_historial (cotizacion_id, fecha DESC);

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

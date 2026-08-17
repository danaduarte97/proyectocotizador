BEGIN;

ALTER TABLE cotizaciones
ADD COLUMN IF NOT EXISTS etapa_pipeline TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cotizaciones'
          AND column_name = 'etapa_pipeline'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE cotizaciones
        ALTER COLUMN etapa_pipeline DROP NOT NULL;
    END IF;
END $$;

UPDATE cotizaciones
SET etapa_pipeline = CASE
    WHEN LOWER(TRIM(COALESCE(estado, ''))) IN (
        'anulada',
        'anulado',
        'perdido',
        'perdida',
        'no interesado',
        'no interesada',
        'rechazado',
        'rechazada',
        'cancelado',
        'cancelada',
        'descartado',
        'descartada',
        'cerrado sin venta',
        'no viable',
        'no califica',
        'no calificado',
        'no calificada'
    ) THEN NULL
    WHEN estado IN (
        'Afiliado',
        'Abonó',
        'AbonÃ³',
        'AbonÃƒÂ³',
        'AbonÃƒÆ’Ã‚Â³'
    ) THEN 'Afiliados'
    WHEN estado = 'Contactado' THEN 'Contactados'
    ELSE 'Nuevos'
END
WHERE LOWER(TRIM(COALESCE(estado, ''))) IN (
        'anulada',
        'anulado',
        'perdido',
        'perdida',
        'no interesado',
        'no interesada',
        'rechazado',
        'rechazada',
        'cancelado',
        'cancelada',
        'descartado',
        'descartada',
        'cerrado sin venta',
        'no viable',
        'no califica',
        'no calificado',
        'no calificada'
    )
   OR etapa_pipeline IS NULL
   OR TRIM(etapa_pipeline) = '';

ALTER TABLE cotizaciones
ALTER COLUMN etapa_pipeline SET DEFAULT 'Nuevos';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t
            ON t.oid = c.conrelid
        JOIN pg_namespace n
            ON n.oid = t.relnamespace
        WHERE c.conname = 'cotizaciones_etapa_pipeline_check'
          AND t.relname = 'cotizaciones'
          AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE cotizaciones
        ADD CONSTRAINT cotizaciones_etapa_pipeline_check
        CHECK (
            etapa_pipeline IN (
                'Nuevos',
                'Contactados',
                'Interesados',
                'Documentación',
                'Auditoría',
                'Afiliados'
            )
        );
    END IF;
END $$;

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
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tareas_crm_tipo_check
        CHECK (tipo IN ('tarea', 'seguimiento', 'recordatorio')),
    CONSTRAINT tareas_crm_estado_check
        CHECK (estado IN ('pendiente', 'realizada', 'cancelada'))
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_etapa_pipeline
    ON cotizaciones (etapa_pipeline);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_etapa_vendedora
    ON cotizaciones (etapa_pipeline, vendedora);

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

COMMIT;

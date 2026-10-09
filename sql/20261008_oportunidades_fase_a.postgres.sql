BEGIN;

CREATE TABLE IF NOT EXISTS public.oportunidades_crm (
    id BIGSERIAL PRIMARY KEY,
    cliente_id BIGINT NOT NULL
        REFERENCES public.clientes(id) ON DELETE RESTRICT,
    oportunidad_anterior_id BIGINT
        REFERENCES public.oportunidades_crm(id) ON DELETE SET NULL,
    ciclo INTEGER NOT NULL DEFAULT 1,
    estado TEXT NOT NULL DEFAULT 'activa',
    etapa TEXT NOT NULL DEFAULT 'Inicio',
    responsable_usuario_id BIGINT
        REFERENCES public.usuarios(id) ON DELETE SET NULL,
    responsable_nombre_snapshot TEXT,
    primera_cotizacion_id BIGINT
        REFERENCES public.cotizaciones(id) ON DELETE SET NULL,
    procedencia_id BIGINT
        REFERENCES public.procedencias(id) ON DELETE RESTRICT,
    primer_contacto_identidad_id BIGINT
        REFERENCES public.primer_contacto_identidades(id) ON DELETE SET NULL,
    procedencia_atribucion TEXT NOT NULL DEFAULT 'sin_informar',
    procedencia_atribuida_en TIMESTAMPTZ,
    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_cierre TIMESTAMPTZ,
    origen TEXT NOT NULL DEFAULT 'aplicacion',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oportunidades_crm_cliente_ciclo_unique
        UNIQUE (cliente_id, ciclo),
    CONSTRAINT oportunidades_crm_ciclo_check
        CHECK (ciclo > 0),
    CONSTRAINT oportunidades_crm_estado_check
        CHECK (estado IN ('activa', 'cerrada_baja', 'cerrada_perdida')),
    CONSTRAINT oportunidades_crm_etapa_check
        CHECK (etapa IN (
            'Inicio',
            'Interesados',
            'Documentación',
            'Auditoría',
            'Afiliados'
        )),
    CONSTRAINT oportunidades_crm_procedencia_atribucion_check
        CHECK (procedencia_atribucion IN (
            'contemporanea',
            'retrospectiva',
            'sin_informar'
        )),
    CONSTRAINT oportunidades_crm_cierre_check
        CHECK (
            (estado = 'activa' AND fecha_cierre IS NULL)
            OR estado <> 'activa'
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidades_crm_cliente_activa
    ON public.oportunidades_crm (cliente_id)
    WHERE estado = 'activa';

CREATE INDEX IF NOT EXISTS idx_oportunidades_crm_etapa_estado
    ON public.oportunidades_crm (estado, etapa);

CREATE INDEX IF NOT EXISTS idx_oportunidades_crm_responsable
    ON public.oportunidades_crm (responsable_usuario_id, estado);

CREATE INDEX IF NOT EXISTS idx_oportunidades_crm_procedencia
    ON public.oportunidades_crm (procedencia_id);

CREATE TABLE IF NOT EXISTS public.oportunidad_asesoras (
    id BIGSERIAL PRIMARY KEY,
    oportunidad_id BIGINT NOT NULL
        REFERENCES public.oportunidades_crm(id) ON DELETE CASCADE,
    usuario_id BIGINT
        REFERENCES public.usuarios(id) ON DELETE SET NULL,
    asesora_nombre_snapshot TEXT NOT NULL,
    asesora_nombre_normalizado TEXT NOT NULL,
    es_responsable BOOLEAN NOT NULL DEFAULT FALSE,
    primera_cotizacion_id BIGINT
        REFERENCES public.cotizaciones(id) ON DELETE SET NULL,
    primera_participacion TIMESTAMPTZ,
    ultima_participacion TIMESTAMPTZ,
    cantidad_cotizaciones INTEGER NOT NULL DEFAULT 0,
    origen TEXT NOT NULL DEFAULT 'cotizacion',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oportunidad_asesoras_nombre_unique
        UNIQUE (oportunidad_id, asesora_nombre_normalizado),
    CONSTRAINT oportunidad_asesoras_cantidad_check
        CHECK (cantidad_cotizaciones >= 0),
    CONSTRAINT oportunidad_asesoras_origen_check
        CHECK (origen IN ('cotizacion', 'asignacion_manual', 'backfill')),
    CONSTRAINT oportunidad_asesoras_nombre_check
        CHECK (btrim(asesora_nombre_normalizado) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidad_asesora_responsable
    ON public.oportunidad_asesoras (oportunidad_id)
    WHERE es_responsable = TRUE;

CREATE INDEX IF NOT EXISTS idx_oportunidad_asesoras_usuario
    ON public.oportunidad_asesoras (usuario_id, oportunidad_id);

CREATE TABLE IF NOT EXISTS public.oportunidad_historial (
    id BIGSERIAL PRIMARY KEY,
    oportunidad_id BIGINT NOT NULL
        REFERENCES public.oportunidades_crm(id) ON DELETE CASCADE,
    accion TEXT NOT NULL,
    etapa_anterior TEXT,
    etapa_nueva TEXT,
    usuario_id BIGINT
        REFERENCES public.usuarios(id) ON DELETE SET NULL,
    usuario_nombre_snapshot TEXT NOT NULL,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    clave_idempotencia TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oportunidad_historial_clave_unique
        UNIQUE (clave_idempotencia),
    CONSTRAINT oportunidad_historial_accion_check
        CHECK (accion IN (
            'backfill_creacion',
            'creacion',
            'cambio_etapa',
            'reasignacion_responsable',
            'vinculacion_cotizacion',
            'cierre',
            'reapertura'
        )),
    CONSTRAINT oportunidad_historial_etapa_anterior_check
        CHECK (
            etapa_anterior IS NULL
            OR etapa_anterior IN (
                'Inicio',
                'Interesados',
                'Documentación',
                'Auditoría',
                'Afiliados'
            )
        ),
    CONSTRAINT oportunidad_historial_etapa_nueva_check
        CHECK (
            etapa_nueva IS NULL
            OR etapa_nueva IN (
                'Inicio',
                'Interesados',
                'Documentación',
                'Auditoría',
                'Afiliados'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_oportunidad_historial_oportunidad_fecha
    ON public.oportunidad_historial (oportunidad_id, fecha DESC, id DESC);

ALTER TABLE public.cotizaciones
    ADD COLUMN IF NOT EXISTS oportunidad_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cotizaciones_oportunidad_id_fkey'
          AND conrelid = 'public.cotizaciones'::regclass
    ) THEN
        ALTER TABLE public.cotizaciones
            ADD CONSTRAINT cotizaciones_oportunidad_id_fkey
            FOREIGN KEY (oportunidad_id)
            REFERENCES public.oportunidades_crm(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_cotizaciones_oportunidad_id
    ON public.cotizaciones (oportunidad_id);

COMMIT;

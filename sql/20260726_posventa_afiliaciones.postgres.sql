BEGIN;

ALTER TABLE public.cotizaciones
    ADD COLUMN IF NOT EXISTS fecha_alta DATE;

ALTER TABLE public.cotizaciones
    ADD COLUMN IF NOT EXISTS estado_posventa TEXT;

ALTER TABLE public.cotizaciones
    ADD COLUMN IF NOT EXISTS fecha_actualizacion_posventa TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cotizaciones_estado_posventa_check'
          AND conrelid = 'public.cotizaciones'::regclass
    ) THEN
        ALTER TABLE public.cotizaciones
            ADD CONSTRAINT cotizaciones_estado_posventa_check
            CHECK (
                estado_posventa IS NULL
                OR estado_posventa IN (
                    'en_seguimiento',
                    'pago_3_meses',
                    'pendiente_mora',
                    'baja_mora'
                )
            );
    END IF;
END
$$;

ALTER TABLE public.tareas_crm
    ADD COLUMN IF NOT EXISTS clave_automatica TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_crm_posventa
    ON public.tareas_crm (cotizacion_id, clave_automatica)
    WHERE clave_automatica IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_alta
    ON public.cotizaciones (fecha_alta);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado_posventa
    ON public.cotizaciones (estado_posventa);

CREATE TABLE IF NOT EXISTS public.cotizaciones_posventa_historial (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT NOT NULL
        REFERENCES public.cotizaciones(id) ON DELETE CASCADE,
    estado_anterior TEXT,
    estado_nuevo TEXT NOT NULL,
    fecha_alta DATE,
    usuario_id BIGINT
        REFERENCES public.usuarios(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_posventa_historial_cotizacion_fecha
    ON public.cotizaciones_posventa_historial (cotizacion_id, fecha DESC);

COMMIT;

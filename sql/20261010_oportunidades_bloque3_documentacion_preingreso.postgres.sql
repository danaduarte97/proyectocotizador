BEGIN;

ALTER TABLE public.oportunidades_crm
    ADD COLUMN IF NOT EXISTS pago_estado TEXT NOT NULL DEFAULT 'sin_confirmar',
    ADD COLUMN IF NOT EXISTS clave_fiscal_estado TEXT NOT NULL DEFAULT 'sin_confirmar',
    ADD COLUMN IF NOT EXISTS preingreso_solicitado BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.oportunidades_crm'::regclass
          AND conname = 'oportunidades_crm_pago_estado_check'
    ) THEN
        ALTER TABLE public.oportunidades_crm
            ADD CONSTRAINT oportunidades_crm_pago_estado_check
            CHECK (pago_estado IN ('sin_confirmar', 'pendiente', 'recibido'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.oportunidades_crm'::regclass
          AND conname = 'oportunidades_crm_clave_fiscal_estado_check'
    ) THEN
        ALTER TABLE public.oportunidades_crm
            ADD CONSTRAINT oportunidades_crm_clave_fiscal_estado_check
            CHECK (clave_fiscal_estado IN (
                'sin_confirmar',
                'pendiente',
                'recibida',
                'no_requiere'
            ));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.oportunidades_crm'::regclass
          AND conname = 'oportunidades_crm_preingreso_etapa_check'
    ) THEN
        ALTER TABLE public.oportunidades_crm
            ADD CONSTRAINT oportunidades_crm_preingreso_etapa_check
            CHECK (NOT preingreso_solicitado OR etapa = 'Auditoría');
    END IF;
END $$;

ALTER TABLE public.oportunidad_historial
    DROP CONSTRAINT IF EXISTS oportunidad_historial_accion_check;

ALTER TABLE public.oportunidad_historial
    ADD CONSTRAINT oportunidad_historial_accion_check
    CHECK (accion IN (
        'backfill_creacion',
        'creacion',
        'cambio_etapa',
        'cambio_documentacion',
        'cambio_preingreso',
        'reasignacion_responsable',
        'vinculacion_cotizacion',
        'cierre',
        'reapertura'
    ));

COMMIT;

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.oportunidades_crm
        WHERE origen <> 'backfill_etapa2_fase_a'
    ) OR EXISTS (
        SELECT 1
        FROM public.oportunidad_historial
        WHERE accion <> 'backfill_creacion'
    ) THEN
        RAISE EXCEPTION
            'Rollback bloqueado: existen datos creados o modificados por la aplicación';
    END IF;
END
$$;

ALTER TABLE public.cotizaciones
    DROP CONSTRAINT IF EXISTS cotizaciones_oportunidad_id_fkey;

DROP INDEX IF EXISTS public.idx_cotizaciones_oportunidad_id;

ALTER TABLE public.cotizaciones
    DROP COLUMN IF EXISTS oportunidad_id;

DROP TABLE IF EXISTS public.oportunidad_historial;
DROP TABLE IF EXISTS public.oportunidad_asesoras;
DROP TABLE IF EXISTS public.oportunidades_crm;

COMMIT;

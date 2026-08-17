BEGIN;

DROP INDEX IF EXISTS public.idx_posventa_historial_cotizacion_fecha;
DROP TABLE IF EXISTS public.cotizaciones_posventa_historial;

DROP INDEX IF EXISTS public.uq_tareas_crm_posventa;
ALTER TABLE public.tareas_crm
    DROP COLUMN IF EXISTS clave_automatica;

DROP INDEX IF EXISTS public.idx_cotizaciones_estado_posventa;
DROP INDEX IF EXISTS public.idx_cotizaciones_fecha_alta;

ALTER TABLE public.cotizaciones
    DROP CONSTRAINT IF EXISTS cotizaciones_estado_posventa_check;
ALTER TABLE public.cotizaciones
    DROP COLUMN IF EXISTS fecha_actualizacion_posventa;
ALTER TABLE public.cotizaciones
    DROP COLUMN IF EXISTS estado_posventa;
ALTER TABLE public.cotizaciones
    DROP COLUMN IF EXISTS fecha_alta;

COMMIT;

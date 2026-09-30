BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.cotizaciones
        WHERE dni IS NULL
    ) THEN
        RAISE EXCEPTION 'No se puede restaurar NOT NULL: existen cotizaciones sin DNI';
    END IF;
END $$;

DROP INDEX IF EXISTS public.uq_clientes_telefono_normalizado;
DROP INDEX IF EXISTS public.uq_clientes_dni_normalizado;

ALTER TABLE public.cotizaciones
    ALTER COLUMN dni SET NOT NULL;

COMMIT;

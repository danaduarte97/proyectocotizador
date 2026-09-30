BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.clientes
        WHERE NULLIF(TRIM(dni_normalizado), '') IS NOT NULL
        GROUP BY dni_normalizado
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Existen DNI normalizados duplicados en clientes';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.clientes
        WHERE NULLIF(TRIM(telefono_normalizado), '') IS NOT NULL
        GROUP BY telefono_normalizado
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Existen teléfonos normalizados duplicados en clientes';
    END IF;
END $$;

ALTER TABLE public.cotizaciones
    ALTER COLUMN dni DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_dni_normalizado
    ON public.clientes (dni_normalizado)
    WHERE dni_normalizado IS NOT NULL AND TRIM(dni_normalizado) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_telefono_normalizado
    ON public.clientes (telefono_normalizado)
    WHERE telefono_normalizado IS NOT NULL
      AND TRIM(telefono_normalizado) <> '';

COMMIT;

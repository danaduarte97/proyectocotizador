SELECT
    table_name,
    column_name,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'cotizaciones' AND column_name IN ('dni', 'celular'))
      OR
      (table_name = 'clientes' AND column_name IN (
          'dni', 'dni_normalizado', 'celular', 'telefono_normalizado'
      ))
  )
ORDER BY table_name, column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
      'uq_clientes_dni_normalizado',
      'uq_clientes_telefono_normalizado'
  )
ORDER BY indexname;

SELECT dni_normalizado, COUNT(*) AS cantidad
FROM public.clientes
WHERE NULLIF(TRIM(dni_normalizado), '') IS NOT NULL
GROUP BY dni_normalizado
HAVING COUNT(*) > 1;

SELECT telefono_normalizado, COUNT(*) AS cantidad
FROM public.clientes
WHERE NULLIF(TRIM(telefono_normalizado), '') IS NOT NULL
GROUP BY telefono_normalizado
HAVING COUNT(*) > 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'cotizaciones'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
          AND (
              indexdef ILIKE '%dni%'
              OR indexdef ILIKE '%celular%'
              OR indexdef ILIKE '%telefono_normalizado%'
              OR indexdef ILIKE '%dni_normalizado%'
          )
    ) THEN
        RAISE EXCEPTION
            'Existe un indice UNIQUE de identidad sobre cotizaciones';
    END IF;
END $$;

SELECT
    to_regclass('public.primer_contacto_identidades') AS tabla_identidades,
    to_regclass('public.primer_contacto_gestiones') AS tabla_gestiones;

SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'primer_contacto_identidades',
      'primer_contacto_gestiones'
  )
ORDER BY table_name, ordinal_position;

SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
      'primer_contacto_identidades',
      'primer_contacto_gestiones'
  )
ORDER BY tablename, indexname;

SELECT
    conrelid::regclass AS tabla,
    conname,
    pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid IN (
    'public.primer_contacto_identidades'::regclass,
    'public.primer_contacto_gestiones'::regclass
)
ORDER BY conrelid::regclass::text, conname;

SELECT
    COUNT(*) FILTER (
        WHERE telefono_normalizado IS NULL
           OR LENGTH(TRIM(telefono_normalizado)) NOT BETWEEN 8 AND 15
    ) AS telefonos_invalidos,
    COUNT(*) - COUNT(DISTINCT telefono_normalizado) AS telefonos_duplicados
FROM public.primer_contacto_identidades;

SELECT COUNT(*) AS gestiones_huerfanas
FROM public.primer_contacto_gestiones gestiones
LEFT JOIN public.primer_contacto_identidades identidades
    ON identidades.id = gestiones.contacto_id
WHERE identidades.id IS NULL;

SELECT
    asesora,
    clave_idempotencia,
    COUNT(*) AS repeticiones
FROM public.primer_contacto_gestiones
GROUP BY asesora, clave_idempotencia
HAVING COUNT(*) > 1;

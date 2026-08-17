SELECT
    COUNT(*) AS cotizaciones_totales,
    COUNT(*) FILTER (WHERE fecha_alta IS NOT NULL) AS cotizaciones_con_fecha_alta,
    COUNT(*) FILTER (WHERE estado_posventa IS NOT NULL) AS cotizaciones_con_posventa
FROM public.cotizaciones;

SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'cotizaciones'
       AND column_name IN (
           'fecha_alta',
           'estado_posventa',
           'fecha_actualizacion_posventa'
       ))
      OR
      (table_name = 'tareas_crm'
       AND column_name = 'clave_automatica')
  )
ORDER BY table_name, ordinal_position;

SELECT
    to_regclass('public.cotizaciones_posventa_historial')
        AS tabla_historial,
    to_regclass('public.uq_tareas_crm_posventa')
        AS indice_tareas_unicas;

SELECT
    cotizacion_id,
    clave_automatica,
    COUNT(*) AS cantidad
FROM public.tareas_crm
WHERE clave_automatica IS NOT NULL
GROUP BY cotizacion_id, clave_automatica
HAVING COUNT(*) > 1;

SELECT
    COUNT(*) AS tareas_posventa_huerfanas
FROM public.tareas_crm tareas
LEFT JOIN public.cotizaciones cotizaciones
    ON cotizaciones.id = tareas.cotizacion_id
WHERE tareas.clave_automatica IS NOT NULL
  AND cotizaciones.id IS NULL;

SELECT
    estado_posventa,
    COUNT(*) AS cantidad
FROM public.cotizaciones
WHERE estado_posventa IS NOT NULL
GROUP BY estado_posventa
ORDER BY estado_posventa;

SELECT
    clave_automatica,
    estado,
    COUNT(*) AS cantidad
FROM public.tareas_crm
WHERE clave_automatica IS NOT NULL
GROUP BY clave_automatica, estado
ORDER BY clave_automatica, estado;

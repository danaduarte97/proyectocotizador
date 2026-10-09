BEGIN TRANSACTION READ ONLY;

SELECT
    COUNT(*)::integer AS oportunidades,
    COUNT(*) FILTER (WHERE estado = 'activa')::integer AS activas,
    COUNT(*) FILTER (WHERE estado <> 'activa')::integer AS cerradas,
    COUNT(DISTINCT cliente_id)::integer AS clientes,
    COUNT(*) FILTER (WHERE responsable_nombre_snapshot IS NULL)::integer
        AS sin_responsable
FROM public.oportunidades_crm;

SELECT etapa, COUNT(*)::integer AS cantidad
FROM public.oportunidades_crm
WHERE estado = 'activa'
GROUP BY etapa
ORDER BY etapa;

SELECT procedencia_atribucion, COUNT(*)::integer AS cantidad
FROM public.oportunidades_crm
GROUP BY procedencia_atribucion
ORDER BY procedencia_atribucion;

SELECT
    COUNT(*)::integer AS cotizaciones,
    COUNT(*) FILTER (WHERE cliente_id IS NOT NULL)::integer AS con_cliente,
    COUNT(*) FILTER (
        WHERE cliente_id IS NOT NULL AND oportunidad_id IS NULL
    )::integer AS con_cliente_sin_oportunidad
FROM public.cotizaciones;

SELECT
    COUNT(*)::integer AS participantes,
    COUNT(*) FILTER (WHERE usuario_id IS NULL)::integer AS sin_usuario_actual,
    COUNT(*) FILTER (WHERE es_responsable)::integer AS responsables
FROM public.oportunidad_asesoras;

SELECT oportunidad_id, COUNT(*)::integer AS responsables
FROM public.oportunidad_asesoras
WHERE es_responsable
GROUP BY oportunidad_id
HAVING COUNT(*) <> 1;

SELECT cliente_id, COUNT(*)::integer AS oportunidades_activas
FROM public.oportunidades_crm
WHERE estado = 'activa'
GROUP BY cliente_id
HAVING COUNT(*) > 1;

SELECT cotizaciones.id, cotizaciones.cliente_id, cotizaciones.oportunidad_id
FROM public.cotizaciones cotizaciones
JOIN public.oportunidades_crm oportunidades
    ON oportunidades.id = cotizaciones.oportunidad_id
WHERE cotizaciones.cliente_id IS DISTINCT FROM oportunidades.cliente_id;

SELECT
    COUNT(*)::integer AS eventos_backfill,
    COUNT(DISTINCT oportunidad_id)::integer AS oportunidades_con_evento
FROM public.oportunidad_historial
WHERE accion = 'backfill_creacion';

ROLLBACK;

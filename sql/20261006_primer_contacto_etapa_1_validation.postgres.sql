BEGIN TRANSACTION READ ONLY;

SELECT codigo, nombre, seleccionable, activa, orden
FROM public.procedencias
ORDER BY orden, id;

SELECT
    COUNT(*)::integer AS identidades,
    COUNT(*) FILTER (WHERE procedencia_id IS NULL)::integer AS sin_procedencia,
    COUNT(*) FILTER (WHERE no_interesa)::integer AS no_interesa,
    COUNT(*) FILTER (WHERE no_enviar_mensajes)::integer AS no_enviar_mensajes
FROM public.primer_contacto_identidades;

SELECT
    procedencias.codigo,
    COUNT(*)::integer AS cantidad
FROM public.primer_contacto_identidades identidades
JOIN public.procedencias
    ON procedencias.id = identidades.procedencia_id
GROUP BY procedencias.codigo
ORDER BY procedencias.codigo;

SELECT
    COUNT(*)::integer AS eventos_backfill
FROM public.primer_contacto_procedencia_historial
WHERE accion = 'backfill_historico';

SELECT
    COUNT(*)::integer AS clientes
FROM public.clientes;

SELECT
    COUNT(*)::integer AS cotizaciones
FROM public.cotizaciones;

ROLLBACK;

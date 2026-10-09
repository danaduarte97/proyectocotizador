BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.cotizaciones
        WHERE cliente_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Backfill bloqueado: existen cotizaciones sin cliente_id';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.cotizaciones
        WHERE NULLIF(TRIM(etapa_pipeline), '') IS NOT NULL
          AND TRIM(etapa_pipeline) NOT IN (
              'Nuevos',
              'Contactados',
              'Interesados',
              'Documentación',
              'Auditoría',
              'Afiliados'
          )
    ) THEN
        RAISE EXCEPTION
            'Backfill bloqueado: existen etapas históricas no reconocidas';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT DISTINCT ON (cliente_id)
                cliente_id,
                NULLIF(TRIM(vendedora), '') AS vendedora
            FROM public.cotizaciones
            WHERE cliente_id IS NOT NULL
            ORDER BY cliente_id, fecha ASC, id ASC
        ) primeras
        WHERE vendedora IS NULL
    ) THEN
        RAISE EXCEPTION
            'Backfill bloqueado: existen primeras cotizaciones sin asesora';
    END IF;
END
$$;

WITH cotizaciones_clasificadas AS (
    SELECT
        cotizaciones.*,
        LOWER(TRIM(COALESCE(cotizaciones.estado, ''))) NOT IN (
            'anulada', 'anulado', 'perdido', 'perdida',
            'no interesado', 'no interesada', 'rechazado', 'rechazada',
            'cancelado', 'cancelada', 'descartado', 'descartada',
            'cerrado sin venta', 'no viable', 'no califica',
            'no calificado', 'no calificada'
        ) AS activa,
        CASE COALESCE(NULLIF(TRIM(cotizaciones.etapa_pipeline), ''), 'Nuevos')
            WHEN 'Afiliados' THEN 5
            WHEN 'Auditoría' THEN 4
            WHEN 'Documentación' THEN 3
            WHEN 'Interesados' THEN 2
            WHEN 'Contactados' THEN 1
            ELSE 1
        END AS etapa_orden,
        ROW_NUMBER() OVER (
            PARTITION BY cotizaciones.cliente_id
            ORDER BY cotizaciones.fecha ASC, cotizaciones.id ASC
        ) AS orden_cliente
    FROM public.cotizaciones
    WHERE cotizaciones.cliente_id IS NOT NULL
),
resumen AS (
    SELECT
        cliente_id,
        BOOL_OR(activa) AS tiene_activas,
        COALESCE(
            MAX(etapa_orden) FILTER (WHERE activa),
            MAX(etapa_orden),
            1
        ) AS etapa_orden
    FROM cotizaciones_clasificadas
    GROUP BY cliente_id
),
primera AS (
    SELECT *
    FROM cotizaciones_clasificadas
    WHERE orden_cliente = 1
),
identidades_directas AS (
    SELECT
        identidades.*,
        COUNT(*) OVER (
            PARTITION BY identidades.cliente_id
        ) AS cantidad_identidades_cliente
    FROM public.primer_contacto_identidades identidades
    WHERE identidades.cliente_id IS NOT NULL
),
datos AS (
    SELECT
        resumen.cliente_id,
        resumen.tiene_activas,
        resumen.etapa_orden,
        primera.id AS primera_cotizacion_id,
        primera.fecha AS fecha_inicio,
        NULLIF(TRIM(primera.vendedora), '') AS responsable_nombre,
        usuario_responsable.id AS responsable_usuario_id,
        CASE
            WHEN identidad.cantidad_identidades_cliente = 1
                THEN identidad.id
            ELSE NULL
        END AS primer_contacto_identidad_id,
        CASE
            WHEN identidad.cantidad_identidades_cliente = 1
                THEN identidad.procedencia_id
            ELSE NULL
        END AS procedencia_id,
        CASE
            WHEN identidad.cantidad_identidades_cliente = 1
             AND procedencias.codigo <> 'sin_informar'
             AND identidad.fecha_creacion > primera.fecha
                THEN 'retrospectiva'
            WHEN identidad.cantidad_identidades_cliente = 1
             AND procedencias.codigo <> 'sin_informar'
                THEN 'contemporanea'
            ELSE 'sin_informar'
        END AS procedencia_atribucion
    FROM resumen
    JOIN primera ON primera.cliente_id = resumen.cliente_id
    LEFT JOIN identidades_directas identidad
        ON identidad.cliente_id = resumen.cliente_id
       AND identidad.cantidad_identidades_cliente = 1
    LEFT JOIN public.procedencias
        ON procedencias.id = identidad.procedencia_id
    LEFT JOIN LATERAL (
        SELECT MIN(usuarios.id) AS id
        FROM public.usuarios
        WHERE LOWER(TRIM(usuarios.usuario)) =
            LOWER(TRIM(primera.vendedora))
        HAVING COUNT(*) = 1
    ) usuario_responsable ON TRUE
)
INSERT INTO public.oportunidades_crm (
    cliente_id,
    ciclo,
    estado,
    etapa,
    responsable_usuario_id,
    responsable_nombre_snapshot,
    primera_cotizacion_id,
    procedencia_id,
    primer_contacto_identidad_id,
    procedencia_atribucion,
    procedencia_atribuida_en,
    fecha_inicio,
    fecha_cierre,
    origen
)
SELECT
    datos.cliente_id,
    1,
    CASE WHEN datos.tiene_activas THEN 'activa' ELSE 'cerrada_perdida' END,
    CASE datos.etapa_orden
        WHEN 5 THEN 'Afiliados'
        WHEN 4 THEN 'Auditoría'
        WHEN 3 THEN 'Documentación'
        WHEN 2 THEN 'Interesados'
        ELSE 'Inicio'
    END,
    datos.responsable_usuario_id,
    datos.responsable_nombre,
    datos.primera_cotizacion_id,
    datos.procedencia_id,
    datos.primer_contacto_identidad_id,
    datos.procedencia_atribucion,
    CASE
        WHEN datos.procedencia_atribucion <> 'sin_informar' THEN now()
        ELSE NULL
    END,
    datos.fecha_inicio,
    CASE WHEN datos.tiene_activas THEN NULL ELSE now() END,
    'backfill_etapa2_fase_a'
FROM datos
ON CONFLICT (cliente_id, ciclo) DO NOTHING;

UPDATE public.cotizaciones cotizaciones
SET oportunidad_id = oportunidades.id
FROM public.oportunidades_crm oportunidades
WHERE oportunidades.cliente_id = cotizaciones.cliente_id
  AND oportunidades.ciclo = 1
  AND oportunidades.origen = 'backfill_etapa2_fase_a'
  AND cotizaciones.oportunidad_id IS NULL;

WITH participaciones AS (
    SELECT
        oportunidades.id AS oportunidad_id,
        LOWER(TRIM(cotizaciones.vendedora)) AS asesora_nombre_normalizado,
        (ARRAY_AGG(
            TRIM(cotizaciones.vendedora)
            ORDER BY cotizaciones.fecha ASC, cotizaciones.id ASC
        ))[1] AS asesora_nombre_snapshot,
        (ARRAY_AGG(
            cotizaciones.id
            ORDER BY cotizaciones.fecha ASC, cotizaciones.id ASC
        ))[1] AS primera_cotizacion_id,
        MIN(cotizaciones.fecha) AS primera_participacion,
        MAX(cotizaciones.fecha) AS ultima_participacion,
        COUNT(*)::integer AS cantidad_cotizaciones
    FROM public.oportunidades_crm oportunidades
    JOIN public.cotizaciones
        ON cotizaciones.oportunidad_id = oportunidades.id
    WHERE oportunidades.origen = 'backfill_etapa2_fase_a'
      AND NULLIF(TRIM(cotizaciones.vendedora), '') IS NOT NULL
    GROUP BY oportunidades.id, LOWER(TRIM(cotizaciones.vendedora))
)
INSERT INTO public.oportunidad_asesoras (
    oportunidad_id,
    usuario_id,
    asesora_nombre_snapshot,
    asesora_nombre_normalizado,
    es_responsable,
    primera_cotizacion_id,
    primera_participacion,
    ultima_participacion,
    cantidad_cotizaciones,
    origen
)
SELECT
    participaciones.oportunidad_id,
    usuario_participante.id,
    participaciones.asesora_nombre_snapshot,
    participaciones.asesora_nombre_normalizado,
    oportunidades.primera_cotizacion_id =
        participaciones.primera_cotizacion_id,
    participaciones.primera_cotizacion_id,
    participaciones.primera_participacion,
    participaciones.ultima_participacion,
    participaciones.cantidad_cotizaciones,
    'backfill'
FROM participaciones
JOIN public.oportunidades_crm oportunidades
    ON oportunidades.id = participaciones.oportunidad_id
LEFT JOIN LATERAL (
    SELECT MIN(usuarios.id) AS id
    FROM public.usuarios
    WHERE LOWER(TRIM(usuarios.usuario)) =
        participaciones.asesora_nombre_normalizado
    HAVING COUNT(*) = 1
) usuario_participante ON TRUE
ON CONFLICT (oportunidad_id, asesora_nombre_normalizado) DO NOTHING;

INSERT INTO public.oportunidad_historial (
    oportunidad_id,
    accion,
    etapa_anterior,
    etapa_nueva,
    usuario_id,
    usuario_nombre_snapshot,
    detalle,
    clave_idempotencia
)
SELECT
    oportunidades.id,
    'backfill_creacion',
    NULL,
    oportunidades.etapa,
    NULL,
    'migracion_etapa2_fase_a',
    jsonb_build_object(
        'cliente_id', oportunidades.cliente_id,
        'ciclo', oportunidades.ciclo,
        'primera_cotizacion_id', oportunidades.primera_cotizacion_id,
        'cotizaciones_ids', (
            SELECT jsonb_agg(cotizaciones.id ORDER BY cotizaciones.fecha, cotizaciones.id)
            FROM public.cotizaciones
            WHERE cotizaciones.oportunidad_id = oportunidades.id
        ),
        'etapas_legacy', (
            SELECT jsonb_agg(DISTINCT COALESCE(
                NULLIF(TRIM(cotizaciones.etapa_pipeline), ''),
                'Nuevos'
            ))
            FROM public.cotizaciones
            WHERE cotizaciones.oportunidad_id = oportunidades.id
        ),
        'procedencia_atribucion', oportunidades.procedencia_atribucion
    ),
    'etapa2:fase-a:oportunidad:' || oportunidades.id
FROM public.oportunidades_crm oportunidades
WHERE oportunidades.origen = 'backfill_etapa2_fase_a'
ON CONFLICT (clave_idempotencia) DO NOTHING;

COMMIT;

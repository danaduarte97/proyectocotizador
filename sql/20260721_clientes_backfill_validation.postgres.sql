WITH cotizaciones_con_identidad AS (
    SELECT
        c.id,
        c.nombre,
        CASE
            WHEN public.asis_normalizar_dni(c.dni) IS NOT NULL THEN 'dni'
            WHEN public.asis_normalizar_telefono(c.celular) IS NOT NULL THEN 'telefono'
            ELSE NULL
        END AS identidad_tipo,
        CASE
            WHEN public.asis_normalizar_dni(c.dni) IS NOT NULL THEN public.asis_normalizar_dni(c.dni)
            WHEN public.asis_normalizar_telefono(c.celular) IS NOT NULL THEN public.asis_normalizar_telefono(c.celular)
            ELSE NULL
        END AS identidad_valor
    FROM cotizaciones c
),
grupos AS (
    SELECT
        identidad_tipo,
        identidad_valor,
        COUNT(*) AS cotizaciones,
        COUNT(DISTINCT LOWER(NULLIF(TRIM(nombre), ''))) AS nombres_distintos
    FROM cotizaciones_con_identidad
    WHERE identidad_tipo IS NOT NULL
        AND identidad_valor IS NOT NULL
    GROUP BY identidad_tipo, identidad_valor
),
grupos_seguros AS (
    SELECT *
    FROM grupos
    WHERE identidad_tipo = 'dni'
        OR nombres_distintos <= 1
),
grupos_contradictorios AS (
    SELECT *
    FROM grupos
    WHERE identidad_tipo = 'telefono'
        AND nombres_distintos > 1
),
cotizaciones_vinculables AS (
    SELECT ci.id
    FROM cotizaciones_con_identidad ci
    JOIN grupos_seguros gs
        ON gs.identidad_tipo = ci.identidad_tipo
        AND gs.identidad_valor = ci.identidad_valor
)
SELECT
    (SELECT COUNT(*) FROM cotizaciones) AS cotizaciones_total,
    (SELECT COUNT(*) FROM cotizaciones_vinculables) AS cotizaciones_con_identidad_segura,
    (SELECT COUNT(*) FROM cotizaciones) - (SELECT COUNT(*) FROM cotizaciones_vinculables) AS cotizaciones_sin_identidad_segura,
    (SELECT COUNT(*) FROM grupos_seguros) AS clientes_que_deberian_existir,
    (SELECT COUNT(*) FROM grupos_contradictorios) AS grupos_por_telefono_con_nombres_contradictorios,
    (SELECT COALESCE(SUM(cotizaciones), 0) FROM grupos_contradictorios) AS cotizaciones_en_grupos_contradictorios,
    COUNT(*) FILTER (WHERE c.cliente_id IS NULL) AS cotizaciones_sin_cliente_id_actualmente,
    COUNT(*) FILTER (WHERE c.cliente_id IS NOT NULL) AS cotizaciones_con_cliente_id_actualmente
FROM cotizaciones c;

SELECT
    COUNT(*) AS clientes_total,
    COUNT(*) FILTER (WHERE identidad_tipo = 'dni') AS clientes_por_dni,
    COUNT(*) FILTER (WHERE identidad_tipo = 'telefono') AS clientes_por_telefono
FROM clientes;

SELECT
    COUNT(*) AS cotizaciones_total,
    COUNT(*) FILTER (WHERE cliente_id IS NOT NULL) AS cotizaciones_relacionadas,
    COUNT(*) FILTER (WHERE cliente_id IS NULL) AS cotizaciones_sin_cliente_id
FROM cotizaciones;

SELECT
    c.cliente_id,
    COUNT(*) AS cotizaciones
FROM cotizaciones c
WHERE c.cliente_id IS NOT NULL
GROUP BY c.cliente_id
HAVING COUNT(*) > 1
ORDER BY cotizaciones DESC, c.cliente_id
LIMIT 20;

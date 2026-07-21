BEGIN;

CREATE OR REPLACE FUNCTION public.asis_normalizar_dni(valor TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(regexp_replace(COALESCE(valor, ''), '\D', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.asis_normalizar_telefono(valor TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    numero TEXT := regexp_replace(COALESCE(valor, ''), '\D', '', 'g');
    posicion INTEGER;
BEGIN
    IF numero = '' THEN
        RETURN NULL;
    END IF;

    IF numero LIKE '549%' THEN
        numero := substr(numero, 4);
    ELSIF numero LIKE '54%' THEN
        numero := substr(numero, 3);
    END IF;

    WHILE numero LIKE '0%' LOOP
        numero := substr(numero, 2);
    END LOOP;

    FOR posicion IN 3..5 LOOP
        IF substr(numero, posicion, 2) = '15' THEN
            numero := substr(numero, 1, posicion - 1) || substr(numero, posicion + 2);
            EXIT;
        END IF;
    END LOOP;

    RETURN NULLIF(numero, '');
END;
$$;

CREATE TABLE IF NOT EXISTS clientes (
    id BIGSERIAL PRIMARY KEY,
    identidad_tipo TEXT NOT NULL,
    identidad_valor TEXT NOT NULL,
    dni TEXT,
    dni_normalizado TEXT,
    nombre TEXT,
    celular TEXT,
    telefono_normalizado TEXT,
    vendedora_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    vendedora_asignada TEXT,
    etapa_comercial TEXT NOT NULL DEFAULT 'Nuevo',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT clientes_identidad_unique
        UNIQUE (identidad_tipo, identidad_valor),
    CONSTRAINT clientes_identidad_tipo_check
        CHECK (identidad_tipo IN ('dni', 'telefono')),
    CONSTRAINT clientes_etapa_comercial_check
        CHECK (etapa_comercial IN (
            'Nuevo',
            'Contactado',
            'Cotizado',
            'En seguimiento',
            'Afiliado',
            'No interesado'
        ))
);

ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS cliente_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cotizaciones_cliente_id_fkey'
            AND conrelid = 'cotizaciones'::regclass
    ) THEN
        ALTER TABLE cotizaciones
            ADD CONSTRAINT cotizaciones_cliente_id_fkey
            FOREIGN KEY (cliente_id)
            REFERENCES clientes(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_clientes_dni_normalizado
    ON clientes (dni_normalizado);

CREATE INDEX IF NOT EXISTS idx_clientes_telefono_normalizado
    ON clientes (telefono_normalizado);

CREATE INDEX IF NOT EXISTS idx_clientes_nombre_lower
    ON clientes (LOWER(nombre));

CREATE INDEX IF NOT EXISTS idx_clientes_vendedora_id
    ON clientes (vendedora_id);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id
    ON cotizaciones (cliente_id);

WITH cotizaciones_normalizadas AS (
    SELECT
        c.id AS cotizacion_id,
        c.fecha,
        c.dni,
        c.nombre,
        c.celular,
        c.vendedora,
        public.asis_normalizar_dni(c.dni) AS dni_normalizado,
        public.asis_normalizar_telefono(c.celular) AS telefono_normalizado
    FROM cotizaciones c
),
cotizaciones_con_identidad AS (
    SELECT
        *,
        CASE
            WHEN dni_normalizado IS NOT NULL THEN 'dni'
            WHEN telefono_normalizado IS NOT NULL THEN 'telefono'
            ELSE NULL
        END AS identidad_tipo,
        CASE
            WHEN dni_normalizado IS NOT NULL THEN dni_normalizado
            WHEN telefono_normalizado IS NOT NULL THEN telefono_normalizado
            ELSE NULL
        END AS identidad_valor
    FROM cotizaciones_normalizadas
),
grupos_seguros AS (
    SELECT
        identidad_tipo,
        identidad_valor,
        ARRAY_AGG(NULLIF(TRIM(dni), '') ORDER BY fecha DESC, cotizacion_id DESC)
            FILTER (WHERE NULLIF(TRIM(dni), '') IS NOT NULL) AS dnis,
        ARRAY_AGG(NULLIF(TRIM(nombre), '') ORDER BY fecha DESC, cotizacion_id DESC)
            FILTER (WHERE NULLIF(TRIM(nombre), '') IS NOT NULL) AS nombres,
        ARRAY_AGG(NULLIF(TRIM(celular), '') ORDER BY fecha DESC, cotizacion_id DESC)
            FILTER (WHERE NULLIF(TRIM(celular), '') IS NOT NULL) AS celulares,
        ARRAY_AGG(telefono_normalizado ORDER BY fecha DESC, cotizacion_id DESC)
            FILTER (WHERE telefono_normalizado IS NOT NULL) AS telefonos_normalizados,
        ARRAY_AGG(NULLIF(TRIM(vendedora), '') ORDER BY fecha DESC, cotizacion_id DESC)
            FILTER (WHERE NULLIF(TRIM(vendedora), '') IS NOT NULL) AS vendedoras,
        COUNT(DISTINCT LOWER(NULLIF(TRIM(nombre), ''))) AS total_nombres_distintos,
        COUNT(DISTINCT NULLIF(TRIM(vendedora), '')) AS total_vendedoras
    FROM cotizaciones_con_identidad
    WHERE identidad_tipo IS NOT NULL
        AND identidad_valor IS NOT NULL
    GROUP BY identidad_tipo, identidad_valor
),
clientes_preparados AS (
    SELECT
        g.identidad_tipo,
        g.identidad_valor,
        CASE
            WHEN g.identidad_tipo = 'dni' THEN g.identidad_valor
            ELSE g.dnis[1]
        END AS dni,
        CASE
            WHEN g.identidad_tipo = 'dni' THEN g.identidad_valor
            ELSE public.asis_normalizar_dni(g.dnis[1])
        END AS dni_normalizado,
        g.nombres[1] AS nombre,
        g.celulares[1] AS celular,
        COALESCE(
            CASE WHEN g.identidad_tipo = 'telefono' THEN g.identidad_valor END,
            g.telefonos_normalizados[1]
        ) AS telefono_normalizado,
        CASE WHEN g.total_vendedoras = 1 THEN u.id END AS vendedora_id,
        CASE WHEN g.total_vendedoras = 1 THEN g.vendedoras[1] END AS vendedora_asignada
    FROM grupos_seguros g
    LEFT JOIN usuarios u
        ON LOWER(TRIM(u.usuario)) = LOWER(TRIM(g.vendedoras[1]))
    WHERE g.identidad_tipo = 'dni'
        OR g.total_nombres_distintos <= 1
)
INSERT INTO clientes (
    identidad_tipo,
    identidad_valor,
    dni,
    dni_normalizado,
    nombre,
    celular,
    telefono_normalizado,
    vendedora_id,
    vendedora_asignada,
    etapa_comercial
)
SELECT
    identidad_tipo,
    identidad_valor,
    dni,
    dni_normalizado,
    nombre,
    celular,
    telefono_normalizado,
    vendedora_id,
    vendedora_asignada,
    'Nuevo'
FROM clientes_preparados
ON CONFLICT (identidad_tipo, identidad_valor) DO UPDATE
SET
    dni = COALESCE(clientes.dni, EXCLUDED.dni),
    dni_normalizado = COALESCE(clientes.dni_normalizado, EXCLUDED.dni_normalizado),
    nombre = COALESCE(clientes.nombre, EXCLUDED.nombre),
    celular = COALESCE(clientes.celular, EXCLUDED.celular),
    telefono_normalizado = COALESCE(clientes.telefono_normalizado, EXCLUDED.telefono_normalizado),
    vendedora_id = COALESCE(clientes.vendedora_id, EXCLUDED.vendedora_id),
    vendedora_asignada = COALESCE(clientes.vendedora_asignada, EXCLUDED.vendedora_asignada),
    fecha_actualizacion = now();

WITH cotizaciones_normalizadas AS (
    SELECT
        c.id AS cotizacion_id,
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
)
UPDATE cotizaciones c
SET cliente_id = clientes.id
FROM cotizaciones_normalizadas cn
JOIN clientes
    ON clientes.identidad_tipo = cn.identidad_tipo
    AND clientes.identidad_valor = cn.identidad_valor
WHERE c.id = cn.cotizacion_id
    AND cn.identidad_tipo IS NOT NULL
    AND cn.identidad_valor IS NOT NULL
    AND c.cliente_id IS DISTINCT FROM clientes.id;

COMMIT;

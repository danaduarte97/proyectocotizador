BEGIN;

ALTER TABLE IF EXISTS cotizaciones
    DROP CONSTRAINT IF EXISTS cotizaciones_cliente_id_fkey;

DROP INDEX IF EXISTS idx_cotizaciones_cliente_id;

ALTER TABLE IF EXISTS cotizaciones
    DROP COLUMN IF EXISTS cliente_id;

DROP TABLE IF EXISTS clientes;

DROP FUNCTION IF EXISTS public.asis_normalizar_dni(TEXT);
DROP FUNCTION IF EXISTS public.asis_normalizar_telefono(TEXT);

COMMIT;

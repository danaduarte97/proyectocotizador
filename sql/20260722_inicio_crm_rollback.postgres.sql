BEGIN;

DROP INDEX IF EXISTS idx_tareas_crm_cliente_id;
DROP INDEX IF EXISTS idx_tareas_crm_cotizacion_id;
DROP INDEX IF EXISTS idx_tareas_crm_fecha_estado;
DROP INDEX IF EXISTS idx_tareas_crm_responsable_texto;
DROP INDEX IF EXISTS idx_tareas_crm_responsable_id;

DROP TABLE IF EXISTS tareas_crm;

DROP INDEX IF EXISTS idx_cotizaciones_etapa_vendedora;
DROP INDEX IF EXISTS idx_cotizaciones_etapa_pipeline;

ALTER TABLE IF EXISTS cotizaciones
DROP CONSTRAINT IF EXISTS cotizaciones_etapa_pipeline_check;

ALTER TABLE IF EXISTS cotizaciones
DROP COLUMN IF EXISTS etapa_pipeline;

COMMIT;

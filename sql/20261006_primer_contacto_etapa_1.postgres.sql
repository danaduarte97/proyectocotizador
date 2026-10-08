BEGIN;

CREATE TABLE IF NOT EXISTS public.procedencias (
    id BIGSERIAL PRIMARY KEY,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    seleccionable BOOLEAN NOT NULL DEFAULT TRUE,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    orden INTEGER NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT procedencias_codigo_unique UNIQUE (codigo),
    CONSTRAINT procedencias_nombre_unique UNIQUE (nombre),
    CONSTRAINT procedencias_codigo_check CHECK (
        codigo IN (
            'base',
            'base_clinica',
            'publicidad_oficial',
            'publicidad_estacion',
            'calle',
            'oficina',
            'micaela_calle',
            'referido',
            'sin_informar'
        )
    ),
    CONSTRAINT procedencias_sin_informar_no_seleccionable_check CHECK (
        codigo <> 'sin_informar' OR seleccionable = FALSE
    )
);

INSERT INTO public.procedencias (codigo, nombre, seleccionable, activa, orden)
VALUES
    ('base', 'Base', TRUE, TRUE, 1),
    ('base_clinica', 'Base Clínica', TRUE, TRUE, 2),
    ('publicidad_oficial', 'Publicidad oficial', TRUE, TRUE, 3),
    ('publicidad_estacion', 'Publicidad Estación', TRUE, TRUE, 4),
    ('calle', 'Calle', TRUE, TRUE, 5),
    ('oficina', 'Oficina', TRUE, TRUE, 6),
    ('micaela_calle', 'Micaela calle', TRUE, TRUE, 7),
    ('referido', 'Referido', TRUE, TRUE, 8),
    ('sin_informar', 'Sin informar', FALSE, TRUE, 99)
ON CONFLICT (codigo) DO UPDATE
SET
    nombre = EXCLUDED.nombre,
    seleccionable = EXCLUDED.seleccionable,
    activa = EXCLUDED.activa,
    orden = EXCLUDED.orden;

ALTER TABLE public.primer_contacto_identidades
    ADD COLUMN IF NOT EXISTS procedencia_id BIGINT;

ALTER TABLE public.primer_contacto_identidades
    ADD COLUMN IF NOT EXISTS no_interesa BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.primer_contacto_identidades
    ADD COLUMN IF NOT EXISTS no_enviar_mensajes BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'primer_contacto_identidades_procedencia_fkey'
          AND conrelid = 'public.primer_contacto_identidades'::regclass
    ) THEN
        ALTER TABLE public.primer_contacto_identidades
            ADD CONSTRAINT primer_contacto_identidades_procedencia_fkey
            FOREIGN KEY (procedencia_id)
            REFERENCES public.procedencias(id)
            ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.primer_contacto_procedencia_historial (
    id BIGSERIAL PRIMARY KEY,
    contacto_id BIGINT NOT NULL
        REFERENCES public.primer_contacto_identidades(id) ON DELETE CASCADE,
    procedencia_anterior_id BIGINT
        REFERENCES public.procedencias(id) ON DELETE RESTRICT,
    procedencia_nueva_id BIGINT NOT NULL
        REFERENCES public.procedencias(id) ON DELETE RESTRICT,
    accion TEXT NOT NULL,
    usuario_id BIGINT REFERENCES public.usuarios(id) ON DELETE SET NULL,
    usuario TEXT NOT NULL,
    motivo TEXT,
    clave_idempotencia TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pc_procedencia_historial_accion_check CHECK (
        accion IN (
            'asignacion_inicial',
            'completado',
            'correccion_admin',
            'backfill_historico'
        )
    ),
    CONSTRAINT pc_procedencia_historial_idempotencia_unique
        UNIQUE (clave_idempotencia)
);

CREATE TABLE IF NOT EXISTS public.primer_contacto_contactabilidad_historial (
    id BIGSERIAL PRIMARY KEY,
    contacto_id BIGINT NOT NULL
        REFERENCES public.primer_contacto_identidades(id) ON DELETE CASCADE,
    marca TEXT NOT NULL,
    valor_anterior BOOLEAN NOT NULL,
    valor_nuevo BOOLEAN NOT NULL,
    usuario_id BIGINT REFERENCES public.usuarios(id) ON DELETE SET NULL,
    usuario TEXT NOT NULL,
    motivo TEXT,
    clave_idempotencia TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pc_contactabilidad_historial_marca_check CHECK (
        marca IN ('no_interesa', 'no_enviar_mensajes')
    ),
    CONSTRAINT pc_contactabilidad_historial_cambio_check CHECK (
        valor_anterior <> valor_nuevo
    ),
    CONSTRAINT pc_contactabilidad_historial_idempotencia_unique
        UNIQUE (clave_idempotencia)
);

UPDATE public.primer_contacto_identidades
SET procedencia_id = (
    SELECT id
    FROM public.procedencias
    WHERE codigo = 'sin_informar'
)
WHERE procedencia_id IS NULL;

INSERT INTO public.primer_contacto_procedencia_historial (
    contacto_id,
    procedencia_anterior_id,
    procedencia_nueva_id,
    accion,
    usuario_id,
    usuario,
    motivo,
    clave_idempotencia
)
SELECT
    identidades.id,
    NULL,
    identidades.procedencia_id,
    'backfill_historico',
    NULL,
    'migracion_etapa_1',
    'Procedencia histórica no informada',
    'etapa1:procedencia-sin-informar:' || identidades.id
FROM public.primer_contacto_identidades identidades
JOIN public.procedencias procedencias
    ON procedencias.id = identidades.procedencia_id
WHERE procedencias.codigo = 'sin_informar'
ON CONFLICT (clave_idempotencia) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.primer_contacto_identidades
        WHERE procedencia_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Existen identidades de Primer Contacto sin procedencia';
    END IF;
END
$$;

ALTER TABLE public.primer_contacto_identidades
    ALTER COLUMN procedencia_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_primer_contacto_identidades_procedencia
    ON public.primer_contacto_identidades (procedencia_id);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_identidades_no_interesa
    ON public.primer_contacto_identidades (id)
    WHERE no_interesa = TRUE;

CREATE INDEX IF NOT EXISTS idx_primer_contacto_identidades_no_enviar
    ON public.primer_contacto_identidades (id)
    WHERE no_enviar_mensajes = TRUE;

CREATE INDEX IF NOT EXISTS idx_pc_procedencia_historial_contacto_fecha
    ON public.primer_contacto_procedencia_historial (contacto_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_pc_contactabilidad_historial_contacto_fecha
    ON public.primer_contacto_contactabilidad_historial (contacto_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_pc_gestiones_asesora_contacto
    ON public.primer_contacto_gestiones (asesora, contacto_id, fecha DESC);

COMMIT;

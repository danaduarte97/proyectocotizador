BEGIN;

CREATE TABLE IF NOT EXISTS public.primer_contacto_identidades (
    id BIGSERIAL PRIMARY KEY,
    telefono_original TEXT NOT NULL,
    telefono_normalizado TEXT NOT NULL,
    cliente_id BIGINT REFERENCES public.clientes(id) ON DELETE SET NULL,
    nombre TEXT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT primer_contacto_telefono_unique
        UNIQUE (telefono_normalizado),
    CONSTRAINT primer_contacto_telefono_check
        CHECK (LENGTH(TRIM(telefono_normalizado)) BETWEEN 8 AND 15)
);

CREATE TABLE IF NOT EXISTS public.primer_contacto_gestiones (
    id BIGSERIAL PRIMARY KEY,
    contacto_id BIGINT NOT NULL
        REFERENCES public.primer_contacto_identidades(id) ON DELETE CASCADE,
    usuario_id BIGINT REFERENCES public.usuarios(id) ON DELETE SET NULL,
    asesora TEXT NOT NULL,
    observacion TEXT,
    clave_idempotencia TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT primer_contacto_gestion_idempotente_unique
        UNIQUE (asesora, clave_idempotencia)
);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_cliente
    ON public.primer_contacto_identidades (cliente_id);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_gestiones_contacto_fecha
    ON public.primer_contacto_gestiones (contacto_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_primer_contacto_gestiones_asesora_fecha
    ON public.primer_contacto_gestiones (asesora, fecha DESC);

COMMIT;

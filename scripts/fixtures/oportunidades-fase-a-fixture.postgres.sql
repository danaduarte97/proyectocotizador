BEGIN;

CREATE TABLE public.usuarios (
    id BIGSERIAL PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT NOT NULL,
    telefono TEXT
);

CREATE TABLE public.clientes (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT,
    celular TEXT,
    telefono_normalizado TEXT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.procedencias (
    id BIGSERIAL PRIMARY KEY,
    codigo TEXT UNIQUE NOT NULL,
    nombre TEXT UNIQUE NOT NULL,
    seleccionable BOOLEAN NOT NULL DEFAULT TRUE,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    orden INTEGER NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.primer_contacto_identidades (
    id BIGSERIAL PRIMARY KEY,
    telefono_original TEXT NOT NULL,
    telefono_normalizado TEXT UNIQUE NOT NULL,
    cliente_id BIGINT REFERENCES public.clientes(id) ON DELETE SET NULL,
    nombre TEXT,
    procedencia_id BIGINT
        REFERENCES public.procedencias(id) ON DELETE RESTRICT,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cotizaciones (
    id BIGSERIAL PRIMARY KEY,
    cliente_id BIGINT REFERENCES public.clientes(id) ON DELETE SET NULL,
    nombre TEXT,
    celular TEXT,
    vendedora TEXT,
    estado TEXT,
    etapa_pipeline TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.usuarios (id, usuario, password, rol)
VALUES
    (1, 'Ana Prueba', 'no-es-una-clave-real', 'vendedora'),
    (2, 'Bea Prueba', 'no-es-una-clave-real', 'vendedora'),
    (3, 'Carla Prueba', 'no-es-una-clave-real', 'vendedora'),
    (4, 'Admin Prueba', 'no-es-una-clave-real', 'admin');

INSERT INTO public.clientes (
    id,
    nombre,
    celular,
    telefono_normalizado,
    fecha_creacion
)
VALUES
    (1, 'Cliente Uno', '1111111111', '1111111111', '2026-01-01 09:00:00-03'),
    (2, 'Cliente Dos', '2222222222', '2222222222', '2026-02-01 09:00:00-03'),
    (3, 'Cliente Tres', '3333333333', '3333333333', '2026-03-01 09:00:00-03'),
    (4, 'Cliente Cuatro', '4444444444', '4444444444', '2026-04-01 09:00:00-03');

INSERT INTO public.procedencias (
    id,
    codigo,
    nombre,
    seleccionable,
    activa,
    orden
)
VALUES
    (1, 'base', 'Base', TRUE, TRUE, 1),
    (2, 'referido', 'Referido', TRUE, TRUE, 2),
    (3, 'sin_informar', 'Sin informar', FALSE, TRUE, 99);

INSERT INTO public.cotizaciones (
    id,
    cliente_id,
    nombre,
    celular,
    vendedora,
    estado,
    etapa_pipeline,
    fecha
)
VALUES
    (101, 1, 'Cliente Uno', '1111111111', 'Ana Prueba',
        'Nuevo', 'Nuevos', '2026-01-02 10:00:00-03'),
    (102, 1, 'Cliente Uno', '1111111111', 'Bea Prueba',
        'Contactado', 'Contactados', '2026-01-03 10:00:00-03'),
    (201, 2, 'Cliente Dos', '2222222222', 'Carla Prueba',
        'Contactado', 'Interesados', '2026-02-02 10:00:00-03'),
    (202, 2, 'Cliente Dos', '2222222222', 'Carla Prueba',
        'Contactado', 'Auditoría', '2026-02-03 10:00:00-03'),
    (301, 3, 'Cliente Tres', '3333333333', 'Ana Prueba',
        'Afiliado', 'Afiliados', '2026-03-02 10:00:00-03'),
    (401, 4, 'Cliente Cuatro', '4444444444', 'Bea Prueba',
        'Perdido', 'Interesados', '2026-04-02 10:00:00-03');

INSERT INTO public.primer_contacto_identidades (
    id,
    telefono_original,
    telefono_normalizado,
    cliente_id,
    nombre,
    procedencia_id,
    fecha_creacion
)
VALUES
    (11, '1111111111', '1111111111', 1, 'Cliente Uno', 2,
        '2026-01-05 10:00:00-03'),
    (21, '2222222222', '2222222222', 2, 'Cliente Dos', 1,
        '2026-02-01 10:00:00-03'),
    (31, '3333333333', '3333333333', 3, 'Cliente Tres', 1,
        '2026-03-01 10:00:00-03'),
    (32, '0333333333', '0333333333', 3, 'Cliente Tres', 2,
        '2026-03-01 11:00:00-03');

SELECT setval('public.usuarios_id_seq', 100, TRUE);
SELECT setval('public.clientes_id_seq', 100, TRUE);
SELECT setval('public.procedencias_id_seq', 100, TRUE);
SELECT setval('public.primer_contacto_identidades_id_seq', 100, TRUE);
SELECT setval('public.cotizaciones_id_seq', 500, TRUE);

COMMIT;

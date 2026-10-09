# Etapa 2 — Bloque 2: Pipeline agrupado y buscador

## Alcance local

El Pipeline utiliza `oportunidades_crm` como fuente de verdad y conserva las
cotizaciones como registros originales asociados. No se agregó ni modificó
ninguna migración de producción para este bloque: la implementación reutiliza
las estructuras aprobadas y aplicadas en el Bloque 1.

## Comportamiento

- se muestra una tarjeta por oportunidad activa;
- las oportunidades cerradas y los ciclos históricos no aparecen en el tablero
  activo;
- cada tarjeta informa responsable principal, participantes, teléfono, DNI,
  procedencia y cantidad de cotizaciones;
- la lista de cotizaciones muestra metadatos compartidos, pero sólo permite
  abrir el detalle completo a Administración o a la autora de esa cotización;
- las tareas siguen filtradas por su responsable y no se comparten entre
  participantes;
- las etapas visibles son Inicio, Interesados, Documentación, Auditoría y
  Afiliados;
- cada cambio de etapa genera un evento `cambio_etapa` en
  `oportunidad_historial` con usuario y fecha;
- Inicio mantiene compatibilidad con el valor histórico `Nuevos` de
  `cotizaciones.etapa_pipeline`;
- al cerrar negativamente la última cotización activa se cierra la oportunidad
  como `cerrada_perdida`, sin borrar el ciclo ni sus cotizaciones.

## Búsqueda y permisos

Los endpoints `GET /pipeline` y `GET /inicio/resumen` aceptan:

- `busqueda`: nombre, DNI o teléfono;
- `etapa`: una de las cinco etapas de oportunidad;
- `asesora`: filtro administrativo por cualquier participante.

El nombre se compara sin distinguir mayúsculas ni acentos. El teléfono utiliza
la normalización argentina existente. Administración ve todas las
oportunidades; una asesora sólo ve y puede mover aquellas donde figura en
`oportunidad_asesoras`.

Endpoints incorporados:

- `PUT /oportunidades/:id/etapa`;
- `GET /oportunidades/:id/historial`.

## Cotizaciones nuevas y concurrencia

La creación de una cotización se ejecuta en la misma transacción que:

1. toma un bloqueo transaccional por cliente en PostgreSQL;
2. reutiliza su oportunidad activa o crea el siguiente ciclo si no existe una;
3. vincula `cotizaciones.oportunidad_id`;
4. agrega o actualiza la participación de la asesora;
5. registra creación o vinculación en el historial.

La restricción única parcial del Bloque 1 sigue siendo la última defensa contra
dos oportunidades activas del mismo cliente.

## Responsive

El desplazamiento reservado para el sidebar se aplica a todo `.main` en
escritorio. A partir de 1333 px hacia abajo se elimina cuando el sidebar pasa a
modo desplegable. El Pipeline conserva desplazamiento horizontal interno, sin
generar desborde horizontal de la página.

## Validación local

- `npm run test:oportunidades:bloque-2` usa SQLite temporal y datos ficticios;
- `npm run test:oportunidades:postgres-local` verifica índices, restricciones y
  concurrencia en `asis_etapa2_test`;
- las regresiones existentes cubren Primer Contacto, Cotizaciones, permisos,
  tareas, adjuntos, Afiliaciones y Posventa.

La instancia local de revisión usa una base SQLite separada y datos ficticios.
No lee ni modifica Supabase.

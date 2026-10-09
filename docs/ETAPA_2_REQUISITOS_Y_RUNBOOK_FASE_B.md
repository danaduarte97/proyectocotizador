# Etapa 2 — Requisitos nuevos y runbook de Fase B

## Estado del documento

Este documento es exclusivamente de diseño y operación. No autoriza cambios en
Supabase, suspensión de Render, activación del endpoint en sombra, commit, push,
deploy ni inicio del Bloque 2.

Los cuatro SQL aprobados para el Bloque 1 — Fase B no cambian. Los requisitos
de Preingreso y búsqueda se implementarán en migraciones y cambios posteriores,
una vez que el modelo base de oportunidades exista y haya sido validado.

## Ubicación en el plan de Etapa 2

### Bloque 1 — Modelo base de oportunidades

- Fase A: estructuras, simulación y pruebas locales.
- Fase B: migración aditiva, backfill en sombra y validación en Supabase.
- No cambia el Pipeline visible.

### Bloque 2 — Pipeline agrupado y buscador

- Backend de lectura y permisos sobre oportunidades.
- Una tarjeta por oportunidad/persona.
- Unificación visual de Nuevos y Contactados como Inicio.
- Buscador por teléfono, DNI y nombre.
- Filtros por etapa y asesora.
- El filtro de Preingreso permanece oculto hasta el Bloque 3.

### Bloque 3 — Documentación y Auditoría

- Pago pendiente/completo.
- Clave fiscal pendiente/completa.
- Estado manual `Preingreso solicitado`.
- Auditoría completa de los cambios.
- Distinción visual y filtro por Preingreso.

Esta separación evita alterar el SQL de Fase B ya probado y permite validar el
Pipeline agrupado antes de sumar estados operativos nuevos.

## Preingreso solicitado

### Regla funcional

`Preingreso solicitado` es una marca operativa de una oportunidad que está en
Auditoría. No es una etapa adicional y no es un estado de afiliación.

Cuando el valor es verdadero:

- la etapa debe seguir siendo `Auditoría`;
- la tarjeta muestra la etiqueta `Preingreso` y un color diferenciado que no se
  confunda con Afiliado, éxito o alerta de error;
- no se crea ni actualiza una afiliación;
- no se completa una fecha de alta;
- no se generan tareas de alta ni de Posventa;
- no se permite mover la oportunidad fuera de Auditoría hasta desmarcarlo.

Marcar y desmarcar son acciones explícitas y auditables. No se infiere el valor
desde cotizaciones, tareas, documentación o afiliaciones.

### Modelo recomendado

Agregar en una migración posterior del Bloque 3:

- `oportunidades_crm.preingreso_solicitado BOOLEAN NOT NULL DEFAULT FALSE`;
- `oportunidades_crm.preingreso_actualizado_en TIMESTAMPTZ`;
- `oportunidades_crm.preingreso_actualizado_por_usuario_id BIGINT NULL`, con FK
  a `usuarios(id)` y `ON DELETE SET NULL`.

La oportunidad conserva el estado actual para consultas y filtros eficientes.
Cada modificación agrega además un evento en `oportunidad_historial` con una
nueva acción `cambio_preingreso`, snapshot del usuario y detalle con valor
anterior y nuevo. Así, eliminar o renombrar una cuenta no borra la auditoría.

Se recomienda una restricción que sólo permita el valor verdadero cuando
`etapa = 'Auditoría'`. El backend debe actualizar la oportunidad y crear el
evento dentro de la misma transacción y con bloqueo de la fila para evitar
cambios concurrentes incoherentes.

No requiere backfill histórico: todas las oportunidades comienzan en `FALSE`
porque hoy no existe una fuente confiable para reconstruir esa marca.

### Endpoint futuro

Propuesta:

`PUT /oportunidades/:id/preingreso`

Entrada: `{ "solicitado": true|false }`.

Debe verificar en backend que la oportunidad esté visible para la persona que
realiza la acción, que la etapa sea Auditoría al marcar y que el usuario posea
permiso de edición. Pueden marcarlo y desmarcarlo todas las asesoras
participantes de la oportunidad y Administración. La autorización se valida en
backend mediante `oportunidad_asesoras`; no depende de botones ocultos ni de que
la asesora sea la responsable principal.

### Pruebas futuras

- marcar y desmarcar en Auditoría;
- rechazar marcado fuera de Auditoría;
- bloquear movimiento fuera de Auditoría mientras está marcado;
- registrar dos eventos diferentes al marcar y desmarcar;
- concurrencia entre cambio de etapa y cambio de preingreso;
- permisos de participante, no participante y Administración;
- confirmar ausencia de afiliación, alta y tareas automáticas;
- color y etiqueta en escritorio y celular;
- filtro de preingreso combinado con etapa y asesora.

## Buscador del Pipeline agrupado

### Alcance funcional

El buscador devuelve oportunidades, no cotizaciones individuales. Una persona
con varias cotizaciones aparece una sola vez e informa su etapa actual.

Criterios:

- teléfono: normalización argentina canónica y comparación con
  `clientes.telefono_normalizado`;
- DNI: sólo dígitos y comparación con `clientes.dni_normalizado`;
- nombre: coincidencia parcial sin distinguir mayúsculas/minúsculas ni acentos;
- etapa: filtro exacto sobre `oportunidades_crm.etapa`;
- asesora: todas las oportunidades donde figure como participante en
  `oportunidad_asesoras`, no solamente como responsable;
- preingreso: filtro booleano disponible desde el Bloque 3.

Los índices actuales de `clientes.telefono_normalizado` y
`clientes.dni_normalizado` se reutilizan. El filtro por etapa utiliza el índice
del modelo de oportunidades y el filtro por asesora el índice de participantes.
Con el volumen actual no es imprescindible un índice adicional para nombre; si
el crecimiento produce búsquedas lentas se evaluará un índice trigram en una
migración separada, no como dependencia inicial.

### Endpoint futuro

Propuesta:

`GET /pipeline/oportunidades?buscar=&etapa=&asesora_id=&preingreso=`

La consulta debe aplicar primero el alcance permitido:

- Administración puede consultar todas las oportunidades;
- una vendedora sólo ve oportunidades en las que participa según
  `oportunidad_asesoras.usuario_id`;
- los filtros nunca amplían ese conjunto;
- los adjuntos de cotizaciones conservan sus permisos actuales y no se incluyen
  automáticamente en el resultado.

La respuesta resumida debe incluir oportunidad, cliente, teléfono, DNI, etapa,
responsable, participantes, cantidad de cotizaciones, procedencia, preingreso
cuando exista y próxima tarea visible. El detalle completo se obtiene por un
endpoint separado para evitar tarjetas grandes y respuestas innecesarias.

La normalización debe permanecer en backend y reutilizar las funciones
existentes. El frontend puede normalizar para mejorar la experiencia, pero no
es un control de seguridad ni la fuente de verdad.

### Pruebas futuras

- teléfono con `0`, `15`, `+54 9`, espacios, guiones y paréntesis;
- DNI con puntos y espacios;
- nombre completo y fragmentos con distintas mayúsculas;
- una oportunidad con varias cotizaciones aparece una vez;
- una oportunidad con varias asesoras respeta visibilidad y filtro;
- combinaciones de búsqueda, etapa, asesora y preingreso;
- asesora sin participación no obtiene resultados ajenos;
- Administración obtiene resultados generales;
- paginación y tiempos de respuesta con volumen simulado;
- escritorio, ventana reducida y celular.

## Decisiones funcionales confirmadas

1. **Permiso de Preingreso:** pueden modificarlo todas las asesoras
   participantes de la oportunidad y Administración.
2. **Filtro por asesora:** incluye todas las oportunidades donde la asesora
   participa, indicando por separado si es responsable principal.
3. **Nombre:** la búsqueda ignora mayúsculas, minúsculas y diferencias de
   acentos. La implementación deberá normalizar ambos lados de la comparación y
   evaluar un índice compatible si el volumen lo requiere.
4. **Color de Preingreso:** naranja. El tono exacto se definirá en la propuesta
   visual con contraste accesible y sin confundirse con Afiliado, mora o error.

Como consecuencia de la regla ya definida de que una oportunidad marcada debe
permanecer en Auditoría, el cambio de etapa se bloqueará hasta que una persona
autorizada desmarque Preingreso explícitamente. No se desmarca automáticamente.

## Runbook final para ejecutar la Fase B

### Condiciones previas obligatorias

- autorización explícita para escribir en Supabase;
- autorización explícita para suspender y reanudar Render;
- PostgreSQL 17 portable disponible y checksum conocido;
- cuatro SQL con hashes iguales a los aprobados;
- carpeta local protegida disponible y sin dumps obsoletos;
- responsables del CRM informados de la ventana;
- conteos esperados actualizados mediante simulación de sólo lectura.

Si falta una condición, la ejecución se cancela antes de suspender el servicio.

### Secuencia operativa

1. Anunciar una ventana de 10 a 15 minutos y pedir cierre de sesiones.
2. Confirmar que no haya una carga comercial en curso.
3. Suspender temporalmente el servicio web de Render. No suspender Supabase.
4. Confirmar que el CRM ya no acepta operaciones y revisar que no queden
   transacciones de escritura activas.
5. Registrar hora de corte y ejecutar nuevamente el diagnóstico de sólo lectura.
6. Recalcular oportunidades, participantes, etapas, procedencias y conflictos.
7. Si aparece cualquier conflicto bloqueante, abortar y reanudar Render sin
   ejecutar SQL.
8. Generar con `pg_dump` 17 un dump custom nuevo y consistente de `public`,
   incluidos datos, objetos grandes, propietarios y ACL.
9. Calcular SHA-256 y comprobar el catálogo con `pg_restore --list`.
10. Restaurar el dump en una base PostgreSQL 17 local nueva y vacía. Eliminar el
    esquema `public` precreado antes de restaurar.
11. Comparar tablas, filas, hashes de contenido, columnas, restricciones,
    índices, secuencias, funciones, RLS y claves foráneas.
12. Si la restauración no coincide, abortar y reanudar Render sin migrar.
13. Confirmar nuevamente los hashes de los cuatro SQL aprobados.
14. Ejecutar `20261008_oportunidades_fase_a.postgres.sql` con detención ante el
    primer error.
15. Verificar las tres tablas, la columna nullable, las FK, restricciones e
    índices antes de continuar.
16. Ejecutar `20261008_oportunidades_fase_a_backfill.postgres.sql` con detención
    ante el primer error.
17. Ejecutar `20261008_oportunidades_fase_a_validation.postgres.sql` y comparar
    contra la simulación tomada después de suspender Render. Los conteos del
    informe anterior son una referencia, no reemplazan el corte actualizado.
18. Ejecutar validaciones adicionales: cero cotizaciones asociables sin
    oportunidad, cero responsables duplicadas, cero oportunidades activas
    duplicadas y cero relaciones cliente/oportunidad inconsistentes.
19. Ejecutar pruebas de humo de sólo lectura sobre Primer Contacto,
    Cotizaciones, Pipeline actual, tareas, Afiliaciones y Posventa.
20. Si todo coincide, reanudar Render y verificar inicio de sesión y operaciones
    críticas sin activar el endpoint en sombra.
21. Monitorear errores durante los primeros 15 minutos y conservar el dump sólo
    durante la ventana de recuperación acordada.
22. Eliminar la base restaurada, su clúster temporal y el dump cuando termine la
    retención aprobada.

### Criterios de aborto y reversión

Antes de reanudar Render no existe actividad legítima sobre las tablas nuevas.
Si falla la estructura, su propia transacción revierte. Si falla el backfill,
su transacción revierte y se conserva la estructura para diagnóstico.

El rollback protegido sólo se considera si:

- la validación no coincide;
- Render continúa suspendido;
- no existen oportunidades o eventos ajenos al backfill;
- se conserva el dump recuperable y el registro de errores;
- existe autorización explícita para ejecutar la reversión.

Nunca se ejecuta automáticamente. Si las validaciones son correctas, el archivo
de rollback no forma parte de la secuencia normal.

### Reanudación segura

La Fase B es aditiva y no cambia el Pipeline visible. Al reanudar Render, los
endpoints actuales deben seguir leyendo las estructuras legacy. El endpoint en
sombra permanece desactivado. La activación del Pipeline agrupado corresponde
al Bloque 2 y requiere una autorización posterior.

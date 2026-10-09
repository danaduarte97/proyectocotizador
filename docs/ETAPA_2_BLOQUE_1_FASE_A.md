# Etapa 2 — Bloque 1, Fase A

## Alcance

Esta fase prepara localmente el modelo de oportunidades comerciales y un
backfill en sombra. No modifica el Pipeline visible y no debe ejecutarse sobre
Supabase hasta contar con autorización expresa para la Fase B.

La oportunidad representa un ciclo comercial. Un cliente puede tener varios
ciclos históricos, pero el índice parcial de PostgreSQL permite sólo uno
activo.

## Modelo

### `oportunidades_crm`

- `cliente_id`: identidad estable de la persona.
- `oportunidad_anterior_id`: enlaza un futuro ciclo de reafiliación.
- `ciclo`: número secuencial dentro del cliente.
- `estado`: `activa`, `cerrada_baja` o `cerrada_perdida`.
- `etapa`: `Inicio`, `Interesados`, `Documentación`, `Auditoría` o `Afiliados`.
- `responsable_usuario_id`: cuenta actual cuando puede identificarse sin
  ambigüedad.
- `responsable_nombre_snapshot`: conserva la responsable histórica aunque la
  cuenta sea eliminada o renombrada.
- `primera_cotizacion_id`: evidencia de la selección de responsable.
- `procedencia_id` y `primer_contacto_identidad_id`: evidencia directa de la
  atribución.
- `procedencia_atribucion`: `contemporanea`, `retrospectiva` o
  `sin_informar`.
- `procedencia_atribuida_en`: momento en que el backfill o la aplicación
  fijaron la atribución.
- `fecha_inicio`, `fecha_cierre`, `origen` y timestamps de auditoría.

Restricciones relevantes:

- `(cliente_id, ciclo)` es único.
- un índice único parcial impide dos oportunidades activas por cliente.
- estados, etapas y tipos de atribución tienen `CHECK` explícito.
- las referencias históricas a usuarios e identidades usan `ON DELETE SET
  NULL`; clientes usan `ON DELETE RESTRICT`.

### `oportunidad_asesoras`

Registra todas las asesoras que poseen cotizaciones dentro del ciclo. Conserva
usuario actual, nombre histórico, primera y última participación, cantidad de
cotizaciones y si es la responsable principal.

- La combinación oportunidad + nombre normalizado es única.
- Un índice parcial permite una sola participante responsable.
- La responsable se determina por la primera cotización ordenada por `fecha`
  e `id`.

### `oportunidad_historial`

Registra eventos auditables con etapa anterior/nueva, usuario, snapshot del
nombre, detalle JSON y una clave de idempotencia. El backfill agrega un único
evento `backfill_creacion` por oportunidad.

### `cotizaciones.oportunidad_id`

La columna es nullable y usa `ON DELETE SET NULL`. No reemplaza `cliente_id`,
no altera `etapa_pipeline` y no cambia la autora de la cotización.

## Reglas del backfill

1. Sólo se agrupan cotizaciones con `cliente_id`.
2. Se crea un ciclo 1 por cada cliente con cotizaciones.
3. Si existe al menos una cotización comercialmente activa, la oportunidad
   queda activa; en otro caso queda `cerrada_perdida`.
4. `Nuevos` y `Contactados` se convierten en `Inicio`.
5. Entre etapas válidas diferentes se propone la más avanzada, sin modificar
   las cotizaciones originales. Esto no se considera ambiguo porque responde a
   la regla funcional aprobada.
6. La responsable es la autora de la primera cotización por fecha e id.
7. Cada autora distinta queda como participante.
8. La procedencia se toma exclusivamente de una única identidad de Primer
   Contacto enlazada directamente por `cliente_id`.
9. Si esa identidad fue creada después de la primera cotización, la atribución
   queda marcada como `retrospectiva`.
10. Cero o varias identidades directas producen `Sin informar`; no se utiliza
    coincidencia libre por teléfono.

Una etapa histórica vacía se interpreta como `Inicio`. Una etapa con un valor
no reconocido bloquea el backfill. Para resolverla no se modifica la
cotización: se documenta la decisión comercial, se incorpora un mapeo explícito
para ese valor en una nueva revisión del SQL y el historial de oportunidad
conserva el valor legacy original y el criterio aplicado.

## Endpoint en sombra

`GET /admin/oportunidades-sombra/comparacion`

- No realiza escrituras.
- Sólo acepta usuarios con rol `admin`.
- Devuelve 404 salvo que
  `OPORTUNIDADES_SOMBRA_HABILITADA=true`.
- No tiene llamadas desde el frontend.
- Compara la cantidad de tarjetas actuales con la simulación de oportunidades.

La variable queda en `false` en `.env.example` y no se modifica el `.env`
local o productivo.

## Archivos SQL

- `20261008_oportunidades_fase_a.postgres.sql`: estructuras aditivas.
- `20261008_oportunidades_fase_a_backfill.postgres.sql`: backfill idempotente.
- `20261008_oportunidades_fase_a_validation.postgres.sql`: validación de sólo
  lectura.
- `20261008_oportunidades_fase_a_rollback.postgres.sql`: reversión destructiva
  permitida únicamente antes de que existan operaciones de la aplicación.

## Procedimiento propuesto para la Fase B

La runbook operativa definitiva, incluidos puntos de autorización, criterios de
aborto y reanudación de Render, se mantiene en
`docs/ETAPA_2_REQUISITOS_Y_RUNBOOK_FASE_B.md`.

1. Detener nuevas operaciones comerciales durante la ventana acordada.
2. Ejecutar el simulador de sólo lectura y conservar su salida.
3. Generar con `pg_dump` 17 un archivo custom completo del esquema `public`,
   incluidos datos, objetos grandes, propietarios y ACL. Guardarlo fuera de
   Git, calcular SHA-256 y comprobar su catálogo con `pg_restore --list`.
4. Restaurar ese mismo archivo con `pg_restore` 17 en una base local vacía,
   omitiendo propietarios y ACL solamente en el destino aislado porque allí no
   existen los roles administrados de Supabase. El JSON creado por
   `backup-oportunidades-fase-a-postgres.js` queda como diagnóstico y no
   reemplaza este respaldo recuperable.
5. Revisar cotizaciones sin cliente, responsables ausentes, identidades
   directas múltiples y etapas históricas no reconocidas. Las diferencias
   entre etapas válidas usan automáticamente la más avanzada.
6. Ejecutar primero la migración de estructuras.
7. Ejecutar el backfill en una transacción separada.
8. Ejecutar la validación de sólo lectura y reconciliar los conteos con la
   simulación.
9. Mantener apagado el endpoint en producción hasta aprobar la comparación.
10. No cambiar todavía el frontend ni la lectura del Pipeline actual.

## Reversión

Antes de actividad real, el rollback puede retirar la columna y las tres
tablas nuevas. Tiene una guarda que se niega a ejecutarse si encuentra eventos
distintos del backfill o oportunidades creadas por la aplicación.

Después de cualquier operación real, no se deben eliminar las tablas nuevas.
La reversión pasa a ser funcional: deshabilitar las lecturas nuevas, conservar
los eventos y reconciliar datos.

## Pruebas

- `npm run test:oportunidades:fase-a`: lógica pura y endpoint sobre SQLite
  temporal.
- `npm run test:oportunidades:postgres-local`: restricciones, índices,
  concurrencia y bloqueo de etapas desconocidas sobre la base local fija
  `asis_etapa2_test` en `127.0.0.1:55432`. El script rechaza cualquier otro
  destino.
- `npm run simulate:oportunidades:fase-a`: simulación PostgreSQL de sólo
  lectura.
- Regresiones existentes de Inicio, Primer Contacto, Posventa y perfil de
  cliente/cotización.

### Entorno PostgreSQL portátil

Las pruebas de SQL usan PostgreSQL 16.15 oficial de EDB extraído en `tmp/`, sin
servicio de Windows y sin modificar `.env`. El cluster escucha únicamente en
el puerto local 55432 y utiliza datos ficticios de
`scripts/fixtures/oportunidades-fase-a-fixture.postgres.sql`.

El respaldo previo de referencia se genera con
`backup-oportunidades-fase-a-postgres.js` y un checksum SHA-256. Para una
restauración integral se usa además `pg_dump -Fc` y `pg_restore`; el JSON de
referencia no reemplaza un dump PostgreSQL completo.

La secuencia local verificada es:

1. cargar el fixture ficticio;
2. ejecutar la migración estructural dos veces;
3. ejecutar el backfill dos veces;
4. validar igualdad exacta de las cotizaciones salvo la nueva FK;
5. probar restricciones y dos inserciones concurrentes;
6. ejecutar el validador consistente y con una inconsistencia temporal;
7. respaldar y restaurar en una base temporal independiente;
8. comprobar que el rollback se bloquea con actividad posterior;
9. retirar ese dato ficticio y ejecutar el rollback seguro.

Ninguna de estas pruebas utiliza Supabase.

## Validación del respaldo previo a Fase B

Supabase usa PostgreSQL 17.6. El 8 de octubre de 2026 se verificó el proceso con
`pg_dump` y `pg_restore` 17.11 portables de EDB, sin servicio de Windows ni
cambios en el PATH global. El archivo custom conserva estructura, datos,
secuencias, propietarios y ACL del esquema `public`.

La restauración se ejecutó dos veces desde cero sobre PostgreSQL 17.11 local.
En ambas ejecuciones coincidieron 13 tablas, 871 filas, 127 columnas, 56
restricciones, 56 índices, 13 secuencias, 2 funciones y la configuración RLS.
No quedaron claves foráneas sin validar. Los hashes de contenido por tabla se
compararon con sesiones normalizadas a UTC y no hubo diferencias.

El respaldo real se guarda temporalmente en
`%LOCALAPPDATA%\ASIS\Etapa2\backups`, una carpeta fuera del repositorio cuya
herencia de permisos está deshabilitada y que sólo permite acceso al usuario
local y a `SYSTEM`. La base restaurada se elimina al finalizar y el servidor
local queda detenido. El dump debe reemplazarse por uno nuevo inmediatamente
antes de la migración y eliminarse al vencer la ventana de recuperación.

### Ventana sin escrituras

1. anunciar una ventana de mantenimiento de 10 a 15 minutos;
2. cerrar las sesiones de uso del CRM y confirmar con las asesoras que no hay
   cargas en curso;
3. mantener Render disponible sólo si se puede garantizar que nadie escriba;
   de lo contrario, activar una respuesta temporal de mantenimiento antes del
   respaldo;
4. registrar conteos y hora de corte;
5. generar y restaurar el respaldo recuperable;
6. ejecutar estructura, backfill y validaciones sin reabrir el CRM;
7. comparar los resultados esperados y recién entonces habilitar nuevamente
   las operaciones.

No alcanza con una coordinación informal si existen integraciones o usuarios
que puedan escribir durante la ventana. En ese caso debe utilizarse un bloqueo
de aplicación reversible; no se revocan permisos ni se detiene Supabase.

# Etapa 2 — Pendientes

La Etapa 1 de Primer Contacto queda cerrada. Los siguientes puntos se reservan expresamente para la Etapa 2 y no forman parte de la implementación actual:

- Responsive general del CRM y sidebar.
- Una oportunidad/tarjeta por persona en el pipeline.
- Unificación de Nuevos y Contactados.
- Subestados de Documentación: pendiente de pago y pendiente de clave fiscal.
- Rediseño visual del pipeline.
- Métricas comerciales por procedencia y asesora.
- Afiliaciones, bajas y futuras reafiliaciones.
- Descarga de cotizaciones en PNG.

## Requisitos incorporados después de la Fase A

### Preingreso solicitado en Auditoría

- La asesora debe poder marcar y desmarcar manualmente `Preingreso solicitado`
  desde la oportunidad.
- Pueden modificarlo todas las asesoras participantes de la oportunidad y
  Administración.
- Mientras esté marcado, la oportunidad permanece en Auditoría, muestra una
  etiqueta `Preingreso` y utiliza una distinción visual naranja.
- No representa una afiliación, no confirma un alta y no dispara tareas o
  automatismos de alta o Posventa.
- Cada cambio debe registrar usuario, fecha, hora, valor anterior y nuevo.
- Se planifica para el Bloque 3, junto con requisitos de Documentación y reglas
  de Auditoría. No se incorpora a la migración aprobada del Bloque 1.

### Buscador y filtros del Pipeline agrupado

- Búsqueda por teléfono, DNI o nombre, devolviendo una oportunidad agrupada y
  su etapa actual.
- La búsqueda por nombre ignora mayúsculas, minúsculas y diferencias de
  acentos.
- El teléfono y DNI deben normalizarse con las funciones canónicas existentes.
- Debe respetar en backend la visibilidad de Administración y participantes;
  no alcanza con ocultar resultados en el frontend.
- Filtros por etapa y asesora se planifican para el Bloque 2, junto con la
  activación del Pipeline agrupado. El filtro por asesora considera todas las
  oportunidades donde participa, no sólo aquellas donde es responsable.
- El filtro por `Preingreso solicitado` se habilita en el Bloque 3, cuando
  exista ese estado.

El diseño y la runbook de ejecución segura se detallan en
`docs/ETAPA_2_REQUISITOS_Y_RUNBOOK_FASE_B.md`.

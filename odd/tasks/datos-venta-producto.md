# Datos de venta en el producto (Fase 1 del roadmap)

## Objetivo

Agregar al producto los datos que la lista de precios necesita y hoy no existen: la alícuota de
IVA y la presentación de venta, y exponer el precio por presentación desde la vista de costeo.

## Problema y por qué

La lista de referencia (`2023-DICIEMBRE.pdf`) muestra precios por presentación ("x docena") con
una alícuota de IVA por ítem (10,5% o 21%). El producto hoy solo tiene `unidad_id` (unidad de
costeo) y la vista calcula `precio_sugerido` por esa unidad. Algunos productos se costean
directamente por docena y otros por unidad y se venden por docena.

## Alcance

- Columnas nuevas en `producto`: `alicuota_iva`, `unidad_venta_id` y `factor_venta`.
- Columnas nuevas en la vista de costeo: alícuota, unidad de venta, factor y precio por
  presentación (`precio_sugerido × factor_venta`).
- Tipos TypeScript y ficha del producto (alta y edición) con los campos nuevos.

Fuera de alcance: la agrupación para la lista (sección, orden, "repuesto de"). Queda pendiente de
una decisión de producto. También queda fuera todo lo relacionado con las tablas de listas
(Fase 2).

## Restricciones

- Las migraciones son nuevas y van en orden. Nunca se editan migraciones ya aplicadas en el
  remoto.
- Las vistas existentes solo pueden **agregar** columnas al final (`create or replace view`).
- Valores por defecto que no rompan los productos existentes: IVA 21, factor 1 y unidad de venta
  vacía, que significa "igual a la unidad de costeo".

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Migración: `alicuota_iva`, `unidad_venta_id`, `factor_venta` en `producto` | delegada (writer) | [x] |
| T2 | Vista de costeo: alícuota, unidad de venta, factor, `precio_presentacion` | delegada (writer) | [x] |
| T3 | Tipos y ficha de producto (alta y edición) con los campos nuevos | delegada (writer) | [x] |
| T4 | Agrupación para la lista: decidido que sale sola de la estructura; se arma en la Fase 2, sin cambios en el producto | decisión | [x] |

Ruta: T1 a T3 tocan 3 o más archivos no triviales (SQL, tipos, formularios y acciones), así que
se delegan a un solo writer.

## Criterios de aceptación

- Un producto existente queda con IVA 21, factor 1 y un precio por presentación igual a su
  precio sugerido.
- Un producto costeado por unidad con factor 12 muestra un precio por presentación igual al
  precio sugerido × 12.
- `factor_venta` > 0 y `alicuota_iva` ≥ 0, garantizados por constraints en la base.
- La ficha del producto permite ver y editar los tres campos.

## Checks

- Sin runner de tests en el repo, así que no aplica test-first. Checks de reemplazo:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - Migración aplicada contra Supabase local (`supabase db reset`) si Docker está disponible.

## Progreso

- Rama: `feat/datos-venta-producto`, creada desde `claude/product-cost-system-qcq2tf`
  (roadmap en el commit `2265753`).

- T1 a T3 implementados por un writer delegado:
  - migración `20261013000001_datos_venta_producto.sql`, que también inserta la unidad `doc` para
    el remoto;
  - vista `v_producto_costo` con 4 columnas nuevas al final;
  - componente `CamposVenta.tsx`, usado en alta, edición y duplicado.
- Verificación observada:
  - `npm run typecheck` OK; `npm run lint` sin errores; `npm run build` OK.
  - `supabase db reset --local` aplicó las 9 migraciones y el seed.
  - `psql`: los productos existentes quedan con IVA 21, factor 1 y precio por presentación igual
    al precio sugerido. Con factor 12, el precio por presentación es el sugerido × 12
    (verificado por el writer en una transacción revertida). Las constraints rechazan factor 0
    e IVA negativo.
- Incidente de entorno: faltaba el binario `workerd` (instalado para otra plataforma), lo que
  rompía `lint` y `build`. Se resolvió con `npm ci`.
- Pendiente: el README no documenta todavía las columnas nuevas de la vista.

- Commit de T1 a T3: `b8895c8`. Evaluación de riesgo: `medium`, `review_due=false`
  (`under_budget`). Queda pendiente dentro del tramo, con base de revisión `2265753`.

- Revisión nativa (`review-c1cae0ff58da30ab`, riesgo medio, con consentimiento): **aprobada y
  confirmada**. Quedaron dos hallazgos que no bloquean:
  - Si se carga un valor no numérico en IVA o factor, se guarda en silencio el valor por defecto.
    Las comas decimales sí se aceptan (`aNumero` reemplaza `,` por `.`).
  - Faltan tests repetibles del precio por presentación y de la vista, que cubre la tarea
    transversal de calidad del roadmap.

## Próximo paso

Actualizar el README con las columnas nuevas. Fase 1 cerrada; sigue la Fase 2 (modelo de listas).

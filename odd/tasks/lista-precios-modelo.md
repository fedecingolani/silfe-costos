# Modelo de listas de precios (Fase 2 del roadmap)

## Objetivo

Crear en la base de datos todo lo que la lista de precios necesita:

- los datos de partida para armar una lista nueva;
- el guardado atómico e inmutable de una lista;
- la foto de cada ítem, incluidos los ítems manuales y los repuestos agrupados según la
  estructura.

## Problema y por qué

La lista de precios tiene que ser un historial confiable. Lo que se descargó y se mandó tiene que
seguir igual aunque después cambien los costos. Por eso cada ítem guarda una copia de sus datos,
no una referencia viva al producto.

## Decisiones que aplican (ver ROADMAP.md, Fase 0)

- Presentación de venta: precio de la presentación = `precio_sugerido × factor_venta`.
- Redondeo: siempre hacia arriba, a la centena (`ceil(precio / 100) * 100`), y editable a mano.
- Lista guardada **inmutable**: sin modificar ni borrar. Para corregirla se duplica.
- Agrupación automática según la estructura:
  - cada `SUBGRUPO` aparece como repuesto debajo de cada `TERMINADO` que lo usa;
  - los subgrupos que no usa ningún producto van al final, como "Otros repuestos";
  - el orden es por código.
- Ítems manuales: sin referencias a nada del sistema. Descripción y precio obligatorios; código,
  presentación y alícuota de IVA opcionales (IVA 21% por defecto).

## Alcance

- Tope de `producto.alicuota_iva` en 100 (hallazgo de la revisión de la Fase 1).
- Vista `v_lista_precio_base`: filas de partida para una lista nueva, en el orden de impresión,
  con el precio sugerido de la presentación y el precio redondeado.
- Tablas `lista_precio` y `lista_precio_item`, con la foto de cada ítem.
- Función `crear_lista_precio(...)`, que guarda la lista y sus ítems en una sola transacción.
- RLS e inmutabilidad: los usuarios autenticados pueden leer; para crear, solo se usa la función.
  No se puede modificar ni borrar.
- Tests de base de datos con pgTAP (`supabase test db`).

Fuera de alcance: la interfaz (Fase 3) y la descarga (Fase 4).

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Tests pgTAP en rojo para la vista, el guardado y la inmutabilidad | delegada (writer) | [x] |
| T2 | Migración: tope de IVA, tablas, RLS e inmutabilidad | delegada (writer) | [x] |
| T3 | Migración: vista `v_lista_precio_base` (agrupación, presentación, redondeo) | delegada (writer) | [x] |
| T4 | Función `crear_lista_precio` (atómica, ítems de producto y manuales) | delegada (writer) | [x] |
| T5 | Tipos TypeScript de las tablas y la vista nuevas | delegada (writer) | [x] |

Ruta: varios archivos SQL no triviales, más tests y tipos. Se delega a un solo writer.

## Criterios de aceptación

- `v_lista_precio_base`:
  - devuelve los `TERMINADO` activos ordenados por código, y debajo de cada uno los `SUBGRUPO`
    activos que usa, marcados como repuesto;
  - los subgrupos que no usa nadie salen al final;
  - el precio sugerido es el de la presentación, y el redondeado es su `ceil` a la centena.
- `crear_lista_precio` guarda la lista y todos sus ítems, o nada.
- Un ítem manual se guarda sin `producto_id`.
- Un ítem de producto guarda una copia de código, descripción, presentación, IVA, precio
  sugerido y precio final.
- Un usuario autenticado no puede hacer `update` ni `delete` sobre una lista o sus ítems, ni
  insertar ítems directamente en una lista ya creada.
- `producto.alicuota_iva` rechaza valores mayores a 100.

## Checks

- Test-first: aplica. Los tests pgTAP corren con `supabase test db` contra la base local.
  Primero en rojo, después en verde.
- `npm run typecheck`, `npm run lint` y `npm run build`.
- `supabase db reset --local`.

## Progreso

- Rama: `feat/datos-venta-producto`. La Fase 2 sigue en la misma rama, encima de la Fase 1
  aprobada. Base de revisión: `adbb86e`.

- T1 a T5 implementados por un writer delegado:
  - migraciones `20261014000001_lista_precios.sql` (tope de IVA, tablas, vista
    `v_lista_precio_base` y función `crear_lista_precio`) y `20261014000002_rls_lista_precios.sql`;
  - tests pgTAP en `supabase/tests/`;
  - tipos en `src/lib/tipos.ts`.
- RED observado: `supabase test db` falló porque la vista, las tablas y la función no existían.
- GREEN observado: `supabase test db`, 2 archivos y 48 tests, todos en verde. Lo verificó el
  writer y lo volví a correr desde el orquestador.
- `npm run typecheck` OK; `npm run lint` sin errores; `npm run build` OK. Un primer intento de
  build falló con `ERR_RUNTIME_FAILURE`: es intermitente y pasó en los reintentos.
- Decisiones del writer:
  - se revocan explícitamente los permisos por defecto de Supabase, así que escribir en las
    tablas da error en lugar de afectar 0 filas en silencio;
  - las listas se crean solo con la función, que es `security definer`.
- Riesgo antes de `db push`: el tope de IVA falla si algún producto real ya tiene un valor mayor
  a 100.

- Commit `8624470`. Evaluación de riesgo: `medium`, `review_due=true` (`slice_budget_reached`).
- Revisión nativa `review-712b4993a3296b35`, con consentimiento: **aprobada y confirmada**.
  Hallazgos que no bloquean:
  - Si se mezcla `orden` explícito e implícito, puede chocar y devolver un error 23505 crudo.
    Queda como seguimiento: la interfaz de la Fase 3 siempre manda `orden` explícito.
  - `NaN` pasa la validación de `precio_final`, y `precio_sugerido` no se valida. Queda como
    seguimiento.
  - Subgrupos anidados: no aplica, porque un trigger de la base impide que un subgrupo contenga
    otro.
  - Tope de IVA en el remoto: no aplica, porque la columna `alicuota_iva` todavía no existe allá.
    Se crea con default 21 en la misma tanda de `db push`.

## Próximo paso

Fase 3: la interfaz.

# Pasada de mejoras de listas de precios

## Objetivo

Resolver los hallazgos que dejaron sin bloquear las revisiones de las Fases 1 a 4. Ya están en
producción (deploy `13ddf8f6`) y funcionando, incluido el PDF con logo, que el usuario verificó.

## Problema y por qué

Las revisiones aprobaron cada fase, pero dejaron casos borde reales:

- borrar un producto reescribe listas que deberían ser inmutables;
- el servidor no repite las validaciones que hace la pantalla;
- un duplicado arrastra datos viejos;
- algunos errores salen crudos;
- el PDF tiene casos de diseño sin cubrir.

## Decisiones

- **Productos usados en listas:** no se pueden borrar (`on delete restrict`). La interfaz
  explica que hay que desactivarlos. Mantiene la inmutabilidad sin perder el historial.
- **Validación en el servidor:**
  - el servidor vuelve a consultar `v_lista_precio_base` para los productos del envío y exige
    un precio mayor a 0 en los que tienen `costos_incompletos`;
  - un `producto_id` inválido se rechaza, en lugar de convertirse en null.
- **Duplicar:** conserva descripción, orden y precio final de la lista original, pero recalcula
  el precio sugerido y los costos incompletos con los datos actuales.
- **Id inválido en la URL:** da 404 en el detalle, en el duplicado y en las descargas.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | FK `lista_precio_item.producto_id` con `on delete restrict` y mensaje claro al borrar un producto en uso | delegada (writer) | [x] |
| T2 | Validación del servidor extraída a un módulo puro con tests: rechazar ids inválidos y NaN, exigir precio > 0 a los costos incompletos, error claro ante una FK (23503). `crear_lista_precio` rechaza NaN | delegada (writer) | [x] |
| T3 | Duplicar recalcula el precio sugerido y los costos incompletos actuales | delegada (writer) | [x] |
| T4 | Descarga: fetch del logo con timeout, sin trabar la descarga; uuid inválido da 404; tests de rutas con un cliente stub | delegada (writer) | [x] |
| T5 | PDF: cortar palabras largas y la presentación, no dejar "Repuestos:" sola al pie de una página, fechas fijas (`creado_en`) y test de varias páginas más fuerte | delegada (writer) | [x] |
| T6 | Test del redondeo de la vista con un valor concreto; migración que revoca los grants de `anon` en `cliente`, `cliente_contacto`, `proveedor_contacto` y `zona` | delegada (writer) | [x] |

## Checks

- Test-first:
  - pgTAP para T1, T2 (`NaN` en la función) y T6;
  - Vitest para T2 a T5.
- `npm test`, `supabase test db`, `npm run typecheck`, `npm run lint` y `npm run build`.
- Recorrido rápido en el navegador contra Supabase local.

## Progreso

- Rama `feat/datos-venta-producto`, ya pusheada. Las 6 migraciones de las Fases 1 a 4 están
  aplicadas en el remoto, y el historial de migraciones del remoto quedó reparado.

- T1 a T6 implementados por un writer delegado:
  - migraciones `20261018000001_mejoras_lista_precios.sql` y `20261018000002_rls_revocar_anon.sql`;
  - módulos puros `items.ts`, `duplicar.ts`, `cargar-descarga.ts` y `uuid.ts`.
- El aviso "desactivalo en lugar de borrarlo" se muestra con un redirect (`?aviso=en-listas`)
  y no con un error lanzado, porque Next oculta esos errores en producción.
- RED observado: varios tests pgTAP y de Vitest fallaron porque faltaban la FK restrict, la
  validación de NaN, los grants de `anon` y los módulos nuevos. Dos tests (el redondeo concreto y
  el de varias páginas) ya pasaban con el código anterior.
- GREEN: `supabase test db` con 91 tests y `npm test` con 68, todos en verde. Typecheck, lint y
  build OK.
- Recorrido en el navegador contra Supabase local:
  - borrar un producto que está en una lista muestra el aviso y el producto no se borra;
  - al duplicar con un producto inactivo, aparece marcado "Inactivo";
  - `?desde=no-es-uuid` da 404, y `/no-es-uuid/pdf` responde "La lista de precios no existe.";
  - el PDF responde 200 y dos descargas seguidas dan bytes idénticos.

## Próximo paso

Commits, evaluación de riesgo y revisión. Después, `db push` de las 2 migraciones nuevas y
deploy, que decide el usuario.

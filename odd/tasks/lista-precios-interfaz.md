# Interfaz de listas de precios (Fase 3 del roadmap)

## Objetivo

Que el usuario pueda ver el historial de listas de precios, crear una lista nueva a partir del
precio sugerido (editable, con ítems manuales), duplicar una lista para corregirla y ver el
detalle de una lista guardada.

## Problema y por qué

La Fase 2 dejó lista la base de datos: la vista `v_lista_precio_base`, las tablas inmutables y la
función `crear_lista_precio`. Falta la interfaz para usarla. Además, la revisión de la rama
encontró un problema en el redondeo: un precio con decimales residuales, como
24500.0000001, sube a 24600.

## Decisiones que aplican

- Redondeo siempre hacia arriba, a la centena, y editable a mano.
- Lista guardada inmutable: para corregirla, se duplica.
- Ítems manuales sin referencia a nada del sistema. Descripción y precio obligatorios; código,
  presentación e IVA opcionales (IVA 21% por defecto).
- Repuestos agrupados solos según la estructura. El orden viene de `v_lista_precio_base`.
- La interfaz siempre manda `orden` explícito a `crear_lista_precio` (hallazgo de la revisión
  de la Fase 2).

## Alcance

- Corrección del redondeo: redondear a centavos antes del `ceil`, con un test pgTAP.
- Una sección "Ventas" en el menú, con "Listas de precios".
- `/listas-precios`: índice con fecha de creación, nombre y acceso al detalle, más el botón
  "Nueva lista".
- `/listas-precios/nueva`: lista editable precargada desde `v_lista_precio_base`.
- `/listas-precios/nueva?desde=<id>`: lo mismo, precargado desde una lista existente (duplicar).
- `/listas-precios/[id]`: detalle de solo lectura, con el botón "Duplicar".

Fuera de alcance: la descarga en PDF y Excel (Fase 4). El botón "Descargar" se agrega en la
Fase 4.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Corregir el redondeo de `v_lista_precio_base` (test pgTAP en rojo y después en verde) | delegada (writer) | [x] |
| T2 | Sección "Ventas" y "Listas de precios" en el menú | delegada (writer) | [x] |
| T3 | Índice `/listas-precios` | delegada (writer) | [x] |
| T4 | Pantalla de nueva lista: editar precio, agregar ítem manual, quitar, reordenar, guardar | delegada (writer) | [x] |
| T5 | Detalle de solo lectura y "Duplicar" (`?desde=<id>`) | delegada (writer) | [x] |

Ruta: varios archivos no triviales (SQL, rutas, un componente cliente y acciones). Se delega a
un solo writer.

## Criterios de aceptación

- `ceil` aplicado sobre el precio redondeado a 2 decimales: 24500.0000001 → 24500, y 24500.01 → 24600.
- La lista nueva muestra todos los ítems de `v_lista_precio_base`, con los repuestos indentados
  debajo de su producto.
- El precio final se precarga con el valor redondeado y se puede editar. Al lado se ve el precio
  sugerido exacto y la diferencia en %.
- Los ítems sin precio sugerido (falta el precio de alguna materia prima) se marcan y exigen
  cargar un precio a mano.
- Se puede agregar un ítem manual (descripción, precio, y opcionalmente código, presentación e
  IVA), quitar cualquier ítem y moverlo hacia arriba o hacia abajo.
- Guardar llama a `crear_lista_precio` con `orden` explícito y redirige al detalle. Si hay un
  error, se muestra con el patrón de errores del repo.
- Duplicar precarga nombre ("Copia de …"), título, notas e ítems, con sus precios finales.
- El detalle no permite editar nada.

## Checks

- T1: test-first con pgTAP (`supabase test db`).
- T2 a T5: no hay runner de tests de UI, así que no aplica test-first. Checks:
  - `npm run typecheck`, `npm run lint` y `npm run build`;
  - recorrido manual en el navegador contra Supabase local, si se puede iniciar sesión con un
    usuario de prueba.

## Progreso

- Rama `feat/datos-venta-producto`. Base de revisión: `0b223f6`.

- T1 a T5 implementados por un writer delegado:
  - migración `20261015000001_redondeo_lista_precio.sql` con la función
    `redondear_precio_lista` (`ceil(round(x, 2) / 100) * 100`);
  - pantallas en `src/app/(app)/listas-precios/` (índice, `nueva` con `EditorLista.tsx`, `[id]`
    y `acciones.ts`);
  - sección "Ventas" en el menú y `fechaHora()` en `formato.ts`.
- RED observado: `supabase test db` falló porque `redondear_precio_lista` no existía.
- GREEN observado: 54 tests en verde. Lo verificó el writer y lo volví a correr desde el
  orquestador.
- `npm run typecheck` OK; `npm run lint` sin errores; `npm run build` OK.
- **Pendiente:** el recorrido manual en el navegador. El seed no crea usuarios de auth, así que
  hace falta un usuario de prueba local. Tampoco se probó contra PostgREST la consulta del
  índice con `lista_precio_item(count)`.
- Notas:
  - un duplicado conserva el precio sugerido de la lista original, sin recalcularlo;
  - `aNumero` no interpreta separadores de miles ("24.500,50"). Es el comportamiento que ya
    tenía el helper.

- Commit `9e1448f`. Evaluación de riesgo: `medium` (`slice_budget_reached`). Revisión nativa
  `review-0d6a4ef3509d6eaa`, con consentimiento: **aprobada y confirmada**. Seguimientos que no
  bloquean:
  - la consulta del índice con `lista_precio_item(count)` no se verificó contra PostgREST; se
    cubre con el recorrido en el navegador;
  - `precio_sugerido` llega desde el cliente sin recalcularse en el servidor; afecta solo a la
    columna informativa "Dif. %";
  - el test de redondeo de la vista es tautológico;
  - el detalle convierte en 404 los errores de la consulta;
  - la validación de `armarItems` no tiene tests.

- Revisión de la rama completa (`review-2fe4fee01c4b9705`, con consentimiento): **aprobada y
  confirmada**. Hallazgo nuevo con impacto real:
  - `v_producto_costo` convierte en 0 los costos faltantes, así que `precio_sugerido` nunca es
    null. Un producto con una materia prima sin precio sale con un precio sugerido bajo o en $0,
    y el editor no lo marca. Por eso el criterio "ítems sin precio sugerido se marcan" **no se
    cumple en la práctica**. Se reabre como T6.
  - El detalle convierte en 404 los errores de la consulta. Se agrega como T7.

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T6 | Marcar los productos con costos faltantes (materias primas sin precio, también dentro de subgrupos, o costo 0) y exigir precio manual | delegada (writer) | [x] |
| T7 | Mostrar los errores de consulta en el detalle y en el duplicado, en lugar de un 404 | delegada (writer) | [x] |

- T6 y T7:
  - migración `20261016000001_costos_incompletos.sql`, que agrega la columna
    `costos_incompletos` a `v_lista_precio_base`;
  - el editor marca esos ítems, precarga el precio vacío y no deja guardar sin un precio
    mayor a 0;
  - el detalle y el duplicado muestran los errores de consulta.
  - RED observado: la columna no existía. GREEN observado: 63 tests en verde, verificado también
    desde el orquestador. Typecheck, lint y build OK.
- Usuario de prueba solo local, agregado en `supabase/seed.sql`. El seed no corre en el remoto.
- Recorrido en el navegador (dev server contra Supabase local, inicio de sesión con el usuario
  de prueba), todo OK y sin errores en consola:
  - el índice carga, incluida la cuenta de ítems: resuelve el hallazgo sobre PostgREST;
  - la lista nueva carga 6 ítems con los repuestos indentados;
  - un producto local de prueba sin precio (PT-900) aparece marcado como "Costos incompletos";
  - guardar sin nombre ni precio muestra los dos errores;
  - el precio "1500,50" se interpreta con coma decimal;
  - el ítem manual "Remeras SILFE $1000" se agrega y se reordena con ↑;
  - guardar redirige al detalle de solo lectura;
  - Duplicar precarga "Copia de …" con 7 ítems y se guarda;
  - el índice muestra 2 listas con 7 ítems cada una;
  - un id inexistente da 404 y un id inválido muestra el error.
- Detalle menor: un id que no es uuid muestra el error de Postgres en lugar de un 404.

- Revisión de la rama completa `review-0509216238dc3ddd`, con consentimiento: **aprobada y
  confirmada**. Seguimientos que no bloquean:
  - el precio > 0 para ítems con costos incompletos se exige solo en el cliente;
  - un `producto_id` inválido se convierte en null en silencio;
  - `armarItems` no tiene tests;
  - un duplicado no vuelve a marcar costos incompletos y usa el precio sugerido viejo;
  - un id que no es uuid muestra el error de Postgres;
  - el test de redondeo de la vista es tautológico.

## Próximo paso

 Fase 4 (descarga en PDF y Excel).

# Compras: comprobantes, remitos, pagos y cuentas corrientes de proveedores

Estado: en curso (T1, T2 y T3 terminadas).

## Objetivo

Registrar lo que se le compra a cada proveedor: la mercadería recibida (remitos de compra), lo facturado (facturas, notas de crédito y de débito), lo pagado (órdenes de pago) y lo adeudado (cuenta corriente del proveedor).

## Problema

La sección Compras del menú está toda en "Próximamente". Hoy el precio de cada materia prima se carga a mano en `precio_materia_prima`, sin un respaldo en lo que realmente se compró. Tampoco hay forma de saber cuánto se le debe a cada proveedor.

## Por qué

- Saber la deuda con cada proveedor y qué facturas están pendientes.
- Que el costeo use precios reales de compra sin cargarlos dos veces.
- Dejar listo el modelo para un importador de facturas con IA y para el Libro IVA Compras.

## Decisiones

### Artículo del proveedor

- Cada proveedor tiene un catálogo de artículos: su código, su descripción tal como la factura (ej. "SOGA PP diam 8MM"), su unidad y un factor de conversión a la unidad de compra de la materia prima.
- El factor de conversión es 1 a 1 por defecto.
- Cada artículo se asocia una vez a una materia prima del sistema (ej. "Soga 8mm").
- En la carga manual se elige la materia prima de la lista. Si el artículo del proveedor no existe, se crea en ese momento.
- El futuro importador con IA va a buscar primero en este catálogo.

### Renglones de facturas y remitos de compra

- Guardan el código y la descripción del proveedor tal cual vienen, y apuntan al artículo del proveedor, que lleva a la materia prima.
- Se permiten renglones sin materia prima, como fletes o servicios.
- Un renglón de mercadería tiene que tener una materia prima existente o asociable. Esto vale para facturas y para remitos.

### Comprobantes de compra

- Tipos: factura, nota de crédito y nota de débito, con letra A, B, C o M.
- Número del proveedor: punto de venta y número. El mismo comprobante del mismo proveedor no se puede cargar dos veces.
- Importes: neto gravado por alícuota, no gravado/exento, IVA y total.
- Percepciones: de IVA y de IIBB por provincia, más un campo de otros impuestos.
- Con estos datos se puede sacar el Libro IVA Compras más adelante (no entra en esta feature).

### Actualización de precios

- Al confirmar la factura se muestra, por renglón, el precio de la factura al lado del vigente. El precio de la factura ya está convertido a la unidad de compra y sin IVA.
- Cada renglón tiene una casilla para actualizarlo, marcada por defecto solo si el precio cambió.
- Actualizar inserta una fila nueva en `precio_materia_prima` para ese proveedor, con `vigente_desde` igual a la fecha de la factura.

### Remitos de compra

- Funcionan como los de venta, pero al revés. Registran la mercadería recibida: proveedor, número del remito del proveedor, fecha y renglones con cantidad.
- Al cargar la factura del proveedor se eligen uno o varios remitos pendientes del mismo proveedor y se traen sus renglones.
- La factura puede cubrir una parte de cada remito, por cantidad.
- Un remito facturado no se modifica.
- No mueven stock en esta feature.

### Pagos (órdenes de pago)

- Una orden de pago cancela una o más facturas o notas de débito. Si sobra, queda saldo a favor, igual que en cobranzas.
- Medios de pago:
  - Efectivo.
  - Transferencia.
  - Cheques de terceros de la cartera: pasan a "entregado", con referencia al proveedor y al pago.
  - Cheques propios: banco, número, fecha de pago e importe, sin chequera.
- Efectivo y transferencia van sin banco ni caja, porque Finanzas todavía no existe.
- Fuera de alcance por ahora: retenciones practicadas como agente (el usuario no las hace). Se pueden sumar después como un medio más.

### Cuenta corriente del proveedor

- Igual que la de clientes: facturas y notas de débito suman deuda, y notas de crédito y pagos la restan.
- Muestra el saldo y el saldo a favor.

### Datos del proveedor

- Hace falta sumar condición frente al IVA, domicilio, CBU y alias.

## Alcance autorizado

Migraciones nuevas en `supabase/migrations/`, tests pgTAP en `supabase/tests/`, librería en `src/lib/compras/` (y subcarpetas por documento), pantallas en `src/app/(app)/compras/` y `src/app/(app)/proveedores/`, tipos en `src/lib/tipos.ts` y las entradas de Compras en `src/components/nav.tsx`.

## Restricciones

- Tablas propias de compras: no se reutiliza `comprobante` de ventas.
- La lógica de saldos e invariantes vive en Postgres (funciones, triggers y vistas `security_invoker`), igual que en ventas.
- RLS en migración separada del esquema.
- Errores con código propio (`CPxxx` compras, `RCxxx` remitos de compra, `OPxxx` pagos) traducidos en `src/lib/compras/**/errores.ts`.

## Tareas

- [x] **T1 — Proveedor y catálogo de artículos.** Datos fiscales del proveedor (condición IVA, domicilio, CBU, alias). Tabla de artículos del proveedor (código, descripción, unidad, factor, materia prima). ABM del catálogo en el detalle del proveedor.
- [x] **T2 — Comprobantes de compra: modelo.** Cabecera, renglones, alícuotas y percepciones. Funciones para guardar borrador, confirmar y anular. Número único por proveedor. Tests pgTAP.
- [x] **T3 — Comprobantes de compra: pantallas.** Listado, alta y detalle. Editor con selección de materia prima y alta del artículo del proveedor en el momento. Menú Compras → Comprobantes.
- [x] **T4 — Actualización de precios al confirmar.** Comparación por renglón, casillas y alta en `precio_materia_prima`.
- [ ] **T4b — Notas de crédito y débito asociadas a una factura.**
  - **Desde la factura:** una factura confirmada tiene botones "Nota de crédito" y "Nota de débito". Abren una nota asociada a esa factura con sus renglones y precios ya cargados, para ajustarlos.
  - **Nota suelta:** se carga con los importes que quiera el usuario.
  - **Precios de costeo:** las notas no los actualizan. El diálogo "Actualizar precios" queda solo para facturas.
- [ ] **T5 — Remitos de compra: modelo.** Cabecera y renglones, vínculo parcial de renglones de factura con renglones de remito, bloqueo del remito facturado, vista de pendientes. Tests pgTAP.
- [ ] **T6 — Remitos de compra: pantallas.** Listado, alta y detalle, y facturar desde remitos. Menú Compras → Remitos.
- [ ] **T7 — Pagos: modelo.** Orden de pago, medios (efectivo, transferencia, cheques de terceros, cheques propios), imputación a comprobantes y saldo a favor. Tests pgTAP.
- [ ] **T8 — Pagos: pantallas.** Listado, alta y detalle. Menú Compras → Pagos.
- [ ] **T9 — Cuenta corriente de proveedores.** Vista de movimientos y saldo, aplicación de notas de crédito, y pantalla. Menú Compras → Cuentas corrientes.

## Checks

- `npm run typecheck`, `npm run lint`, `npx vitest run` y `supabase test db` en cada tarea.
- Tests primero (RED → GREEN) en funciones SQL y en la librería.
- Verificación en el navegador en las tareas de pantallas.

## Entrega

- Estrategia: PRs encadenados, uno por tarea, como en remitos. Pronóstico de unas 4000–5000 líneas, muy por encima del presupuesto de 400 por PR.
- Al mergear PRs apilados, no usar `--delete-branch` hasta el final, porque cierra los PRs hijos.
- Migraciones a producción con `supabase migration list --linked` antes de `supabase db push --linked`.

## Progreso

### T1 — Proveedor y catálogo de artículos

- **Ruta:** delegada a un writer, porque toca más de 2 archivos no triviales. El fix de la revisión se hizo inline.
- **Rama:** `feat/compras-01-proveedor-articulos`.
- **Commits:**
  - `2f5fdde` modelo (migraciones `20261105000001`/`000002` y pgTAP)
  - `35c9499` pantallas
  - `841fb44` fix de la revisión
- **Modelo:**
  - `proveedor` suma `condicion_iva`, `domicilio`, `cbu` (22 dígitos) y `alias` (6–20).
  - `proveedor_articulo` tiene factor 1 por defecto y `materia_prima_id` opcional (`on delete restrict`).
  - Hay una clave única por proveedor sobre el código, o sobre la descripción cuando no hay código.
- **Pantalla:** el detalle del proveedor tiene las secciones "Datos fiscales" y "Artículos del proveedor", con alta y edición en un modal.
- **RED → GREEN:**
  - pgTAP: falló 23 de 23 sin la migración y pasó después.
  - Vitest: falló porque el módulo no existía y pasó después.
  - Fix de la revisión: 2 tests en rojo y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 991 tests y pgTAP con 978, todo en verde.
- **Navegador:** se agregó el artículo "SOGA PP 8MM ROLLO 200M" (rollo, factor 10,5) asociado a la Soga 8mm.
- **Revisión RDD:** riesgo medio, concedida y aprobada.
  - El revisor dejó dos observaciones informativas, ambas corregidas en `841fb44`: el factor fuera del rango de `numeric(20,8)` y el mensaje de una clave foránea rota al guardar.
- **Pendientes:**
  - Los textos nuevos usan formas impersonales y el resto de la app usa voseo.
  - El dev server que estaba corriendo mostraba un error de hidratación del menú, por código viejo en el servidor. No tiene relación con T1.

- **PR:** #34, con base `main`.
- **Revisión de la rama completa contra main:** aprobada, con tres sugerencias que se resolvieron en T2: paridad de la condición frente al IVA, test real del trigger de `actualizado_en` y error al editar un artículo borrado.

### T2 — Comprobantes de compra: modelo

- **Ruta:** delegada a un writer. El ajuste posterior a la revisión se hizo inline.
- **Rama:** `feat/compras-02-comprobantes-modelo`, apilada sobre T1.
- **Commits:**
  - `bac9447` seguimientos de T1
  - `a2c563b` modelo
  - `86a132b` reglas de confirmación en el trigger
- **Migraciones:** `20261105000003_comprobantes_compra.sql` y `20261105000004_rls_comprobantes_compra.sql`.
- **Tablas:** `comprobante_compra`, `comprobante_compra_item` y `comprobante_compra_percepcion`.
- **RPC:**
  - `guardar_comprobante_compra(p_id, p_comprobante, p_items, p_percepciones)`. Cada renglón lleva `proveedor_articulo_id`, `articulo_nuevo` (busca el artículo por código o descripción, o lo crea) o ninguno, si es un renglón libre.
  - `confirmar_comprobante_compra(p_id)`.
  - `anular_comprobante_compra(p_id)`.
- **Totales:** los calculan triggers, nunca el cliente, con `fn_comprobante_compra_totales`.
  - A y M discriminan IVA por alícuota.
  - En B y C todo va a no gravado, y una alícuota se rechaza con CP009.
  - Las percepciones se suman por tipo.
- **Materia prima del renglón:** se copia siempre del artículo. Al confirmar se refresca, así que asociarla en el catálogo destraba la confirmación.
- **Número duplicado:** lo rechaza el índice único (23505), salvo que el anterior esté anulado.
- **Códigos de error:**
  - CP001 inmutable
  - CP002 transición
  - CP003 borrado
  - CP004 inexistente
  - CP005 sin renglones
  - CP006 total no positivo
  - CP007 artículo sin materia prima
  - CP008 artículo de otro proveedor
  - CP009 alícuota no discriminada
- **Mensajes en la app:** se traducen en `src/lib/compras/comprobantes/errores.ts`.
- **RED → GREEN:**
  - pgTAP falló 9 de 9 sin la migración.
  - Vitest falló porque el módulo no existía.
  - Ajuste de la revisión: 2 tests en rojo (el bypass) y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 998 tests y pgTAP con 1061, todo en verde.
- **Revisión RDD:** riesgo medio, concedida y aprobada.
  - El aviso R3-confirm-guc-bypass (la marca `compras.confirmando` se podía poner a mano y saltear las reglas) se corrigió: el trigger ahora exige total > 0 y artículos con materia prima.
  - La sugerencia de testear el caso sin filas de `actualizarArticulo` quedó sin test, porque es una Server Action que habla directo con Supabase.
- **Revisión de la rama completa (T1 + T2) contra main:** aprobada. El aviso R3-confirm-total-check-before-recompute (el trigger miraba el total de la fila antes de recalcularlo, así que `total = 999` a mano pasaba) se corrigió en `244bd36`: ahora controla el total recalculado. Hubo un test en rojo y luego en verde. pgTAP quedó con 1062 tests.
- **Pendientes:** el trigger diferido "con renglones" solo tiene un test de existencia, porque CP001 impide llegar a ese caso dentro de un test.

- **PR:** #35, con base en la rama de T1.

### T3 — Comprobantes de compra: pantallas

- **Ruta:** delegada a un writer; los arreglos de la revisión se hicieron inline.
- **Rama:** `feat/compras-03-comprobantes-pantallas`, apilada sobre T2.
- **Commits:**
  - `fb4c5d2` librería
  - `bd77e74` pantallas y menú
  - `7532f1e` arreglos de la revisión
- **Pantallas:** en `/compras/comprobantes` (listado con filtros, `nuevo/` y `[id]/`).
  - **Editor:**
    - La letra se sugiere por la condición del proveedor frente al IVA.
    - Los renglones pueden ser un artículo del catálogo (con buscador), un artículo nuevo (con materia prima obligatoria) o un renglón libre.
    - Las percepciones de IIBB se cargan con provincia.
    - Los totales se previsualizan con las mismas reglas que la base.
  - **Vista de solo lectura:** para confirmados y anulados, con la acción Anular.
  - **Menú:** Compras → Comprobantes.
- **Librería:** `src/lib/compras/comprobantes/` (`borrador`, `totales`, `numero`, `letra`, `listado`) y `src/lib/compras/provincias.ts`.
- **RED → GREEN:** 5 archivos de test fallaron porque los módulos no existían; después pasaron 55 tests.
- **Checks:** typecheck y lint OK. Vitest con 1046 tests, en verde.
- **Revisión RDD de T3:** riesgo medio, concedida y aprobada. Se corrigieron dos avisos y una sugerencia:
  - el error de confirmación se perdía al navegar en un comprobante nuevo (ahora se usa `history.replaceState` y se guarda el id en el estado);
  - un catálogo del proveedor anterior podía pisar al actual (ahora se usa una ref del último proveedor pedido);
  - el id nulo que podía devolver la RPC.
- **Revisión de la rama completa (T1–T3) contra main:** no se pudo hacer, porque supera el límite de la herramienta (`lens_context_budget_exceeded`). Cada tarea quedó revisada por separado.
- **Navegador:** con un usuario de prueba local.
  - Se cargó una FC A 00003-00012345 de Sogas Andinas: artículo SG-8, 10 kg a $1.000 con 21% de IVA y una percepción de IVA de $300.
  - La vista previa y la base dieron lo mismo: neto $10.000, IVA $2.100 y total $12.400.
  - El comprobante se confirmó y aparece en el listado ("1 comprobante").
- **Pendientes:**
  - A 1024 px la tabla de renglones queda apretada: precio e IVA se ven angostos y la columna de importe se corta. Es el mismo problema de scroll horizontal que quedó en remitos.
  - El título de `ModalError` dice siempre "No se pudo guardar".

- **PR:** #36, con base en la rama de T2.

### T4 — Actualización de precios al confirmar

- **Ruta:** delegada a un writer.
- **Rama:** `feat/compras-04-actualizar-precios`, apilada sobre T3.
- **Commits:**
  - `a6ae6c7` SQL
  - `4e1398c` pantalla
- **Migración:** `20261105000005_compras_actualizar_precios.sql`.
  - `precios_comprobante_compra(p_id)` devuelve, por cada renglón con materia prima:
    - el precio de la factura por unidad de compra: precio × (1 − descuento) ÷ factor, con 4 decimales;
    - el precio vigente del proveedor a la fecha del comprobante;
    - la marca `cambio`.
  - `confirmar_comprobante_compra(p_id, p_actualizar_precios uuid[] default '{}')` inserta los precios elegidos en la misma transacción que la confirmación.
    - El precio nuevo pasa a ser el preferido si el preferido anterior era del mismo proveedor o si no había ninguno, igual que en la carga manual.
    - Errores nuevos: CP010 (renglón ajeno o sin materia prima) y CP011 (materia prima repetida).
- **En B y C:** se toma el precio tal cual, con un IVA que no se computa.
- **Diálogo "Actualizar precios":** al confirmar. Las casillas vienen marcadas cuando el precio cambió.
- **RED → GREEN:** pgTAP falló 3 de 32 sin las funciones. En Vitest, `precios.test.ts` falló porque el módulo no existía y `errores.test.ts` tuvo 2 tests en rojo; después todo pasó.
- **Checks:** typecheck y lint OK. Vitest con 1055 tests y pgTAP con 1094, todo en verde.
- **Navegador:** se cargó una FC A 00003-00012400 de Sogas Andinas con SG-8 a $1.450.
  - El diálogo mostró el precio vigente de $6.200 y una diferencia de −76,6%, con la casilla marcada.
  - Al confirmar, la materia prima quedó con $1.450 como preferido, con la observación "Compra FC A 00003-00012400", y el costeo pasó a $74,74 por metro.
- **Revisión RDD:** pendiente. El usuario interrumpió la pregunta de consentimiento.
- **Pendientes y decisiones:**
  - Las notas no actualizan precios (decisión del usuario; se implementa en T4b).
  - Idea a evaluar: resaltar las diferencias grandes, como el −76,6%, que es justo el caso de "precio raro".

## Próximo paso

T4b (notas asociadas a una factura), apilada sobre T4.

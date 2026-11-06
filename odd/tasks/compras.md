# Compras: comprobantes, remitos, pagos y cuentas corrientes de proveedores

Estado: en producción desde el 2026-11-06 (T1 a T9).

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
- [x] **T4b — Notas de crédito y débito asociadas a una factura.**
  - **Desde la factura:** una factura confirmada tiene botones "Nota de crédito" y "Nota de débito". Abren una nota asociada a esa factura con sus renglones y precios ya cargados, para ajustarlos.
  - **Nota suelta:** se carga con los importes que quiera el usuario.
  - **Precios de costeo:** las notas no los actualizan. El diálogo "Actualizar precios" queda solo para facturas.
- [x] **T5 — Remitos de compra: modelo.** Cabecera y renglones, vínculo parcial de renglones de factura con renglones de remito, bloqueo del remito facturado, vista de pendientes. Tests pgTAP.
- [x] **T6 — Remitos de compra: pantallas.** Listado, alta y detalle, y facturar desde remitos. Menú Compras → Remitos.
- [x] **T7 — Pagos: modelo.** Orden de pago, medios (efectivo, transferencia, cheques de terceros, cheques propios), imputación a comprobantes y saldo a favor. Tests pgTAP.
- [x] **T8 — Pagos: pantallas.** Listado, alta y detalle. Menú Compras → Pagos.
- [x] **T9 — Cuenta corriente de proveedores.** Vista de movimientos y saldo, aplicación de notas de crédito, y pantalla. Menú Compras → Cuentas corrientes.

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
- **Revisión RDD:** concedida más tarde y aprobada, en un worktree temporal parado en `04b72e5`. Hallazgos informativos:
  - Aviso: una factura con fecha anterior al precio preferido vigente lo desplaza igual, y el costeo vuelve a un precio viejo.
  - Aviso: las notas pasaban por la actualización de precios. Ya lo cerró T4b con CP013.
  - Sugerencias: la comparación no descuenta el IVA cuando el precio vigente lo incluye, y no hay tests de notas.
- **Pendientes y decisiones:**
  - Las notas no actualizan precios (decisión del usuario; se implementa en T4b).
  - Idea a evaluar: resaltar las diferencias grandes, como el −76,6%, que es justo el caso de "precio raro".

### T4b — Notas asociadas a una factura

- **Ruta:** delegada a un writer. El título del error se arregló inline.
- **Rama:** `feat/compras-04b-notas-asociadas`, apilada sobre T4.
- **Commits:**
  - `69f842c` SQL
  - `b885d09` librería y pantallas
  - `7b2ac5f` título de `ModalError` por acción
- **Migración `20261105000006_compras_notas_asociadas.sql`:**
  - Nueva columna `comprobante_compra.comprobante_asociado_id`.
  - El trigger `trg_comprobante_compra_asociado` controla la asociación: solo una NC o ND, asociada a una factura confirmada del mismo proveedor y la misma letra. Lo vuelve a controlar al confirmar, y bloquea la factura `for share`.
  - Errores nuevos:
    - CP012 asociación inválida
    - CP013 una nota no actualiza precios
    - CP014 una factura con notas confirmadas no se anula
  - Una nota en borrador no bloquea anular la factura, pero después no se puede confirmar.
- **Pantallas:**
  - La factura confirmada tiene los botones "Nota de crédito" y "Nota de débito", que abren `nuevo?desde=&tipo=` con los renglones y precios de la factura (sin percepciones).
  - En el editor, la "Factura asociada" es opcional para una nota suelta.
  - El detalle de la factura lista sus notas, y el de la nota muestra su factura.
- **RED → GREEN:**
  - pgTAP: falló 4 de 4 sin la migración; después pasaron 30 de 30.
  - Vitest: 8 tests en rojo y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 1066 tests y pgTAP con 1124, todo en verde.
- **Navegador:**
  - Desde la FC A 00003-00012345 se abrió una nota de crédito precargada: mismo proveedor y letra, asociada, con el renglón de 10 kg a $1.000. Se cambió la cantidad a 2.
  - Al confirmarla apareció el diálogo simple, sin precios. Quedó la NC A 00003-00000077 por $2.420, con su "Factura asociada".
  - La factura lista la nota. Al intentar anularla aparece "La factura tiene notas de crédito o débito confirmadas: anulá primero las notas.", con el título "No se pudo anular".
- **Revisión RDD:** concedida y aprobada, en un worktree temporal parado en `e86ddb2`. Hallazgos informativos:
  - Aviso: "Factura asociada" muestra "ya no está confirmada" cuando la factura sigue confirmada pero quedó fuera de las 200 más recientes, o cuando falló la lectura.
  - Sugerencia: falta un test unitario de que una nota se confirma sin precios.

### T5 — Remitos de compra: modelo

- **Ruta:** delegada a un writer.
- **Rama:** `feat/compras-05-remitos-modelo`, apilada sobre T4b.
- **Commits:**
  - `bd7aec8` SQL y pgTAP
  - `a5d99bd` tipos y mensajes de error
- **Migraciones `20261105000007_remitos_compra.sql` y `000008` (RLS):**
  - `remito_compra` pasa de borrador a recibido y de ahí a anulado.
  - Cada renglón de `remito_compra_item` tiene que tener un artículo del proveedor. `fn_compras_articulo` busca el artículo o lo crea, y la usan facturas y remitos.
  - `comprobante_compra_item.remito_compra_item_id` permite facturar en parte, por cantidad.
  - Vistas `v_remito_compra_item_pendiente` y `v_remito_compra_estado`.
  - `facturar_remitos_compra` sugiere como precio el vigente por el factor.
  - Funciones `guardar_remito_compra`, `recibir_remito_compra` y `anular_remito_compra`. Errores RC001 a RC011.
- **Falta (para T6):** el editor de T3 todavía no manda `remito_compra_item_id`.
- **Checks:** typecheck y lint OK. Vitest con 1074 tests y pgTAP con 1235, todo en verde (111 nuevos de pgTAP).
- **Revisión RDD:** riesgo medio, concedida y aprobada. Hallazgos informativos:
  - Aviso: `guardar_comprobante_compra` bloquea los remitos en el orden de los renglones, mientras que `facturar_remitos_compra` los bloquea por id. Dos guardados concurrentes pueden caer en un deadlock (40P01), que se muestra como un error genérico.
  - Sugerencia: no hay tests de cambiar el proveedor de una factura que tiene remitos, de un UPDATE directo que supere lo pendiente ni de RC006 en un INSERT directo.
- **Revisión de la rama entera:** concedida, pero supera el límite de contexto (`lens_context_budget_exceeded`). Quedan cubiertas las revisiones por tarea.

### Correcciones de las revisiones (T4, T4b y T5)

- **Ruta:** delegada a un writer, sobre la rama de T5.
- **Migración:** `20261105000009_compras_correcciones_revision.sql`.
- **Commits:**
  - `4cee2c7` deadlock:
    - `guardar_comprobante_compra` ahora bloquea `for update`, ordenados por id, todos los remitos que toca (los de los renglones nuevos y los de los que reemplaza) antes de borrar o insertar.
    - Los errores 40P01 y 40001 muestran "Otra persona estaba guardando un comprobante con los mismos remitos. Probá de nuevo."
  - `2b81c8b` factura con fecha anterior: si el precio preferido vigente tiene `vigente_desde` posterior a la fecha de la factura, el precio nuevo queda como histórico (`es_preferido` falso). Con la misma fecha lo reemplaza.
  - `05daa3f` "Factura asociada":
    - La página lee la factura asociada por id, y `facturaAsociadaEnEditor` (en `nota.ts`) la suma a las opciones.
    - El aviso aparece solo si la factura no está confirmada o no existe. Si la lectura falla, el mensaje es neutro.
    - Se agregó `confirmaConPrecios(tipo)`.
- **RED → GREEN:**
  - pgTAP: 1 de 7 en rojo para el deadlock y 2 de 13 para la fecha anterior; después todo en verde.
  - Vitest: 1 de 10 en `errores` y 8 de 16 en `nota`, en rojo y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 1083 tests y pgTAP con 1248, todo en verde. No se probó en el navegador.
- **Revisión RDD:** riesgo medio, concedida y aprobada.
  - El aviso de que el helper no compara proveedor ni letra no aplica: el editor vacía la factura asociada al cambiar el proveedor o la letra.
  - Sugerencia: la prueba del deadlock es textual, porque un test de una sola sesión no puede reproducir concurrencia.
- **Revisión de la rama entera:** concedida otra vez y vuelve a superar el límite de contexto.
- **Pendiente:** la acción `facturasAsociables` devuelve `[]` cuando falla la lectura, así que al recargar la lista en el navegador no se distingue un error de una lista vacía.

- **PR:** #39, con base en la rama de T4b (incluye las correcciones).

### T6 — Remitos de compra: pantallas

- **Ruta:** delegada a un writer. Sin migraciones.
- **Rama:** `feat/compras-06-remitos-pantallas`, apilada sobre T5.
- **Commits:**
  - `3dde32b` librería con tests (`src/lib/compras/remitos/{borrador,listado,facturacion}.ts`)
  - `fea1993` pantallas y menú
  - `664ac67` facturar desde remitos y vínculo en el editor de facturas
- **Pantallas:** en `/compras/remitos`:
  - listado con filtros por proveedor y estado;
  - `nuevo/`;
  - `[id]/`, con las acciones Recibir, Anular, Borrar y Facturar, más las facturas que cubren el remito;
  - `facturar/`, que elige renglones y cantidades parciales, carga la cabecera de la factura y crea el borrador.
- **Menú:** Compras → Remitos.
- **Editor de facturas:**
  - Guarda y envía `remito_compra_item_id`, y muestra la marca "Del remito …" con un enlace.
  - Con renglones de remitos, el proveedor y el tipo quedan bloqueados.
  - Una nota abierta desde una factura no copia esos vínculos.
- **`facturasAsociables`:** devuelve `{facturas}` o `{error}`. El editor distingue una lectura fallida de una lista vacía.
- **RED → GREEN:** 9 tests nuevos del borrador y de la nota, 3 módulos nuevos de remitos y el mapeo de errores, todos en rojo y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 1133 tests y pgTAP con 1248, todo en verde.
- **Navegador:**
  - Se creó y recibió el remito 00003-00000501 de Sogas Andinas, con 10 kg de SG-8.
  - Desde ahí se facturaron 6 kg y quedó el borrador de la FC A 00003-00012500, con precio sugerido de $1.450 y la marca del remito.
  - Se cambió la cantidad a 5 y se guardó: el vínculo se mantuvo. El remito quedó "Facturado en parte" (5 y 5), sin Anular y con la factura listada.
  - Al intentar facturar 6 de los 5 pendientes, la pantalla lo frena.
  - Sin errores en la consola.
- **Revisión RDD:** riesgo medio, concedida y aprobada. Quedan dos sugerencias:
  - la lista de errores de validación usa el mensaje como `key` y puede repetirse;
  - falta un test de la forma `{facturas}` / `{error}`.
- **Revisión de la rama entera:** concedida, y supera otra vez el límite de contexto.
- **Nota de comportamiento:** una factura en borrador cuenta como facturada, así que el remito no se anula hasta borrarla.

- **PR:** #40, con base en la rama de T5.

### T7 — Pagos: modelo

- **Ruta:** delegada a un writer.
- **Rama:** `feat/compras-07-pagos-modelo`, apilada sobre T6.
- **Commits:**
  - `206fd48` SQL y pgTAP
  - `88e0346` tipos y mensajes de error
- **Migraciones:** `20261106000001_pagos_compra.sql` y `20261106000002_rls_pagos_compra.sql`.
- **Tablas:**
  - `orden_pago_numeracion`
  - `orden_pago`, con número OP-00000001 y estados borrador, confirmado y anulado
  - `orden_pago_medio`: efectivo, transferencia, cheque_tercero y cheque_propio
  - `imputacion_compra`, que viene de una orden o de una nota de crédito
  - `cheque` suma `proveedor_id` y `orden_pago_id`.
- **Vistas:**
  - `v_comprobante_compra_saldo`: saldo y `estado_pago` de facturas y notas de débito confirmadas.
  - `v_proveedor_saldo_a_favor`
- **RPC:**
  - `guardar_orden_pago(p_id, p_orden, p_medios, p_imputaciones)`
  - `confirmar_orden_pago(p_id)`, que devuelve el número
  - `anular_orden_pago(p_id, p_motivo)`
- **Errores:** OP001 a OP017, en `src/lib/compras/pagos/errores.ts`.
- **Decisiones tomadas siguiendo a ventas:**
  - Numeración propia sin punto de venta, y motivo obligatorio para anular.
  - El saldo a favor se aplica solo al confirmar una factura o nota de débito, de la más vieja a la más nueva. Si la aplicación falla, la confirmación se cancela.
  - La nota de crédito asociada se aplica a su factura hasta el saldo, y el resto queda como saldo a favor.
  - Una factura o nota de débito con imputaciones no se anula (OP016). Una nota de crédito sí, y se deshacen sus aplicaciones.
  - El cheque de tercero va siempre por su importe. Lo entrega o lo devuelve solo la confirmación o la anulación de la orden (OP017).
- **RED → GREEN:** pgTAP falló porque faltaban las tablas y después dio 118 tests nuevos en verde. Vitest falló porque faltaba el módulo y después pasó.
- **Checks:** typecheck y lint OK. Vitest con 1140 tests y pgTAP con 1366, todo en verde.
- **Revisión RDD:** riesgo medio, concedida y aprobada. Hallazgos informativos:
  - Aviso: insertar a mano en `imputacion_compra` con `automatica = true` permite imputar el saldo de una orden confirmada. Ventas tiene el mismo patrón en `imputacion`. Dentro de una app interna con `authenticated` de acceso completo, no se corrige por ahora.
  - Aviso: OP001 también salta al tocar imputaciones de una nota de crédito, pero el mensaje habla de la orden de pago.
  - Sugerencia: traducir 23505 (comprobante o cheque repetido) y testear 40001.
- **Revisión de la rama entera:** concedida, y vuelve a superar el límite de contexto.

- **PR:** #41, con base en la rama de T6.

### T8 — Pagos: pantallas

- **Ruta:** delegada a un writer. El arreglo de safeupdate lo hice inline.
- **Rama:** `feat/compras-08-pagos-pantallas`, apilada sobre T7.
- **Commits:**
  - `91cd1fa` librería (`src/lib/compras/pagos/{medios,imputacion,guardado,listado,anulacion}.ts`), con los mensajes de 23505 y de OP001 para las notas
  - `9f6fa26` pantallas y menú
  - `c890ded` tarjeta "Pagos" y botón "Pagar" en el detalle del comprobante
  - `5832185` arreglo de safeupdate
- **Pantallas en `/compras/pagos`:**
  - Listado con filtros.
  - `nuevo/`, que acepta `?proveedor=&comprobante=` precargados.
  - `[id]/`: editor del borrador, o detalle con Anular y motivo.
- **Menú:** Compras → Pagos.
- **Bug de T7 encontrado en el navegador:** confirmar una orden fallaba siempre desde la app con "UPDATE requires a WHERE clause".
  - Causa: las sesiones de PostgREST cargan `pg-safeupdate`, y `confirmar_orden_pago` actualizaba el contador sin WHERE. pgTAP no lo detectaba porque corre sin esa extensión, y el rol de test no puede cargarla.
  - Arreglo: la migración `20261106000003_pagos_compra_safeupdate.sql` agrega `where n.id`.
  - El test `compras_safeupdate_test.sql` revisa todas las funciones de `public` y falla con cualquier UPDATE o DELETE sin WHERE. Falló antes del arreglo y pasó después.
- **RED → GREEN:** Vitest: 6 archivos en rojo (5 módulos que no existían y 2 tests de errores), después 45 tests en verde. pgTAP: el guard en rojo y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 1178 tests y pgTAP con 1367, todo en verde.
- **Navegador:**
  - Desde la FC A 00003-00012400 ("Pendiente"), "Pagar" abrió la orden precargada, con el aviso de $2.420 a favor.
  - Pagué con un cheque propio (Banco Nación N° 445566): quedó la OP-00000001 y la factura pasó a "Cancelado".
  - Anular sin motivo no se permite. Con motivo la orden se anula y la factura vuelve a "Pendiente".
  - El pago con cheque de terceros no se probó en el navegador porque no hay cheques en cartera en la base local. Lo cubre pgTAP.
- **Revisión RDD:** riesgo medio, concedida y aprobada.
  - El aviso de que la redefinición pierde la entrega de cheques no aplica: la hace el trigger `trg_orden_pago_confirmada`, y el cuerpo de la función es el mismo salvo el WHERE.
  - Aviso pendiente: al reabrir un borrador cuya factura ya se pagó por otra orden, su imputación queda oculta y bloquea la validación.
  - Sugerencia: el guard acepta un WHERE dentro de una subconsulta.
- **Pendientes menores:**
  - Los campos banco, número y fecha del cheque propio no tienen etiqueta accesible.
  - No hay PDF de la orden de pago.

- **PR:** #42, con base en la rama de T7.

### T9 — Cuenta corriente de proveedores

- **Ruta:** delegada a un writer. El número del comprobante en el aviso del borrador lo agregué inline.
- **Rama:** `feat/compras-09-cuenta-corriente`, apilada sobre T8.
- **Commits:**
  - `281fde6` vistas y aplicación manual del saldo a favor, con pgTAP
  - `fe20558` librería y mensajes OP018/OP019
  - `87747a2` pantallas y menú
  - `1d6fa75` arreglo del borrador con una imputación oculta
  - `c0cdc9d` el aviso nombra el comprobante
- **Migración:** `20261106000004_cuenta_corriente_proveedor.sql`.
  - Vistas `v_proveedor_cuenta_corriente` (movimientos con saldo acumulado), `v_proveedor_saldo` y `v_proveedor_cuenta_resumen`.
  - `aplicar_saldo_a_favor_compra(p_comprobante_compra_id)`: aplica los créditos del proveedor a un débito, del más viejo al más nuevo, y devuelve lo aplicado.
  - Errores nuevos: OP018 (sin saldo a favor) y OP019 (débito sin saldo).
- **Pantallas:**
  - `/compras/cuentas-corrientes`: proveedores con lo que les debemos, el saldo a favor y la deuda más vieja.
  - En la ficha del proveedor, la sección "Cuenta corriente" con pendientes, saldo a favor, movimientos, "Aplicar saldo a favor" y "Pagar".
  - Menú Compras → Cuentas corrientes.
- **Decisiones:**
  - Columnas `debito` y `credito`.
  - Se aplica débito por débito, empezando por el crédito más viejo.
  - No hay forma de desaplicar, igual que en ventas: se anula la nota de crédito o la orden de pago.
- **RED → GREEN:**
  - pgTAP: 37 tests en rojo y luego en verde.
  - Vitest: 15 tests de cuenta corriente, 2 de errores y 11 del borrador, en rojo y luego en verde.
- **Checks:** typecheck y lint OK. Vitest con 1198 tests y pgTAP con 1404, todo en verde.
- **Navegador:**
  - En Sogas Andinas se aplicó el saldo a favor a la FC A 00003-00012400. Quedó cancelada, el saldo a favor bajó de $2.420 a $665,50 y el saldo siguió en $11.734,50.
  - Los errores de hidratación del menú venían de un servidor de desarrollo desactualizado: tras reiniciarlo desaparecieron.
  - El arreglo del borrador no se probó en el navegador; lo cubre Vitest.
- **Revisión RDD:** riesgo medio, concedida y aprobada.
  - El aviso de la carrera con una anulación no aplica: el trigger de `imputacion_compra` vuelve a leer el débito `for update` y rechaza uno anulado.
  - Aviso pendiente: si la Server Action rechaza (por ejemplo, un error de red), `AplicarSaldoAFavor` no lo atrapa y el error no llega a `ModalError`.
  - Sugerencia: con más proveedores que el límite del listado, los totales y el orden por antigüedad quedan incompletos.
- **Revisión de la rama entera:** concedida, y otra vez supera el límite de contexto.

- **PR:** #43, con base en la rama de T8.

## Deploy (2026-11-06)

- **Merge:**
  - La cadena se mergeó de arriba hacia abajo, con merge commit: #43 → … → #35, cada uno en su rama padre.
  - Al final, #34 en `main` (`c21c01d`), con el título "comprobantes, remitos, pagos y cuentas corrientes de proveedores".
  - Después se borraron las ramas de compras.
- **Migraciones:**
  - `supabase migration list --linked` mostró el historial remoto igual al local hasta `20261104000004`.
  - `supabase db push --linked` aplicó las 13 migraciones nuevas, de `20261105000001` a `20261106000004`, sin errores.
- **Worker:** `silfe-costos` quedó desplegado, versión `1ae57166-3743-4894-8d75-5ed3a7c698d3`.
- **Verificación:** sin sesión, `/compras/remitos`, `/compras/pagos` y `/compras/cuentas-corrientes` redirigen a `/login` (307).
- **Falta probar en producción con un usuario:** sobre todo confirmar una orden de pago, el caso del bug de `pg-safeupdate`.

## Próximo paso

- Probar los flujos de compras en producción con un usuario real.
- Pendientes menores:
  - el try/catch de `AplicarSaldoAFavor`;
  - las etiquetas accesibles de los campos del cheque propio;
  - el PDF de la orden de pago;
  - el resaltado de diferencias grandes de precio;
  - el ancho de la tabla de renglones.

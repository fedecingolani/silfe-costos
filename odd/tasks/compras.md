# Compras: comprobantes, remitos, pagos y cuentas corrientes de proveedores

Estado: en curso (definición cerrada, implementación sin empezar).

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

- [ ] **T1 — Proveedor y catálogo de artículos.** Datos fiscales del proveedor (condición IVA, domicilio, CBU, alias). Tabla de artículos del proveedor (código, descripción, unidad, factor, materia prima). ABM del catálogo en el detalle del proveedor.
- [ ] **T2 — Comprobantes de compra: modelo.** Cabecera, renglones, alícuotas y percepciones. Funciones para guardar borrador, confirmar y anular. Número único por proveedor. Tests pgTAP.
- [ ] **T3 — Comprobantes de compra: pantallas.** Listado, alta y detalle. Editor con selección de materia prima y alta del artículo del proveedor en el momento. Menú Compras → Comprobantes.
- [ ] **T4 — Actualización de precios al confirmar.** Comparación por renglón, casillas y alta en `precio_materia_prima`.
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

Sin tareas empezadas.

## Próximo paso

T1 en la rama `feat/compras-01-proveedor-articulos`.

# Comprobantes X en punto de venta sin ARCA — SPEC

> Estado: **en implementación** (decisiones tomadas el 30/10/2026).
> Rama: `feat/comprobante-x` (sale de `feat/pdf-precio-con-descuento`, que también toca el PDF).

## Objetivo

Emitir facturas, notas de crédito y notas de débito **X** desde un punto de venta no conectado
a ARCA (por ejemplo el 9999), sin IVA.

## Problema y por qué

La base ya admite puntos de venta no electrónicos (`punto_venta.electronico = false`), pero la
app no los usa: el editor sólo lista los electrónicos, autorizar los rechaza, no hay numeración
propia, el PDF no los imprime y el listado filtra por ambiente de ARCA.

## Alcance

**Entra:** letra X, numeración propia, emisión sin ARCA, notas X, nota de débito X por cheque
rechazado, conversión de presupuesto a X, PDF no fiscal, filtro de listado.

**No entra:** comprobantes A/B en puntos no electrónicos (talonario manual), cambios en ARCA.

## Reglas de negocio

- Punto de venta no electrónico ⇒ siempre letra X. Electrónico ⇒ sólo A o B.
- X no tiene código de ARCA (`tipo_arca` null), ni CAE, ni ambiente.
- X no suma IVA: `iva = 0`, `iva_detalle` null, `total = neto + no_gravado`. Los precios se
  toman tal cual (un producto de $100 + IVA va a $100). La alícuota del ítem se ignora.
- Numeración: una secuencia por punto de venta y clase (factura X 9999-1, NC X 9999-1, …).
  Al autorizar se asigna `max + 1` con bloqueo, y pasa directo de borrador a autorizado.
- Una nota X sólo se asocia a comprobantes X (misma regla de letra que A/B).
- Cheque rechazado: si las facturas canceladas por el recibo son todas X, la ND sale X en un
  punto no electrónico activo. Si mezcla X con A/B, no se genera automáticamente (error claro).
- Presupuesto convertido en un punto no electrónico ⇒ X.
- PDF: recuadro "X", leyenda "Documento no válido como factura", sin CAE, QR ni código ARCA,
  sin columnas ni totales de IVA.
- Listado: opción para ver comprobantes no electrónicos (ambiente null).

## Tareas

| ID | Tarea | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 | DB: letra X, checks, validación en trigger/guardar, numeración propia, ND de cheque, presupuesto | delegada (2+ archivos, SQL) | pendiente | |
| T2 | TS: tipo, letra, cálculo sin IVA, editor con PV no electrónico, autorizar sin ARCA | delegada | pendiente | |
| T3 | Notas X (asociados por letra/clase), duplicar, cheques.ts | delegada | pendiente | |
| T4 | PDF no fiscal X y filtro de listado | delegada | pendiente | |

## Verificación

- `npm test`, `npm run typecheck`, `npm run lint` por tarea.
- SQL: no hay base local (Docker apagado); revisión estructural. Aplicar con `supabase db push`
  previa `supabase migration list` — decisión del usuario.

## Progreso

- 30/10: rama creada, mapeo de impacto hecho.

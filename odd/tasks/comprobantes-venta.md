# Comprobantes de venta con CAE (Fase 8 del roadmap, Ventas) — SPEC

> Estado: **spec cerrada, sin implementar** (preguntas respondidas el 15–16/10/2026).

## Objetivo

Cargar, autorizar en ARCA (CAE), consultar e imprimir **facturas, notas de crédito y notas de
débito** desde Sil-Fe ERP, y reemplazar al sistema de facturación actual en el punto de venta 7.

## Problema y por qué

Hoy se factura con otro sistema. La conexión con ARCA ya funciona (`/configuracion/arca`:
certificado de producción, ticket WSAA y `FECompUltimoAutorizado`, que da Factura A = 360 en el
punto de venta 7). Falta poder emitir comprobantes con los datos de clientes y productos que ya
están en la app.

Referencias usadas para esta spec:
- **Pantalla del sistema actual:** cliente, comprobante, fecha, vencimiento del cobro, punto de
  venta, número, condición de pago, "más opciones", ítems (producto/servicio, centro de costo,
  observaciones, cantidad, precio con 4 decimales, % descuento, importe, IVA, total),
  "percepciones e impuestos" y totales bruto / impuestos / total.
- **Factura impresa** (`A-00002-00000157`, de otra empresa, como modelo del formato):
  - encabezado con logo, razón social, domicilio, condición IVA, CUIT, IIBB e inicio de
    actividades; letra con código (`A` / `001`), número y fecha;
  - receptor: razón social, domicilio, CUIT y condición IVA;
  - moneda, provincia destino, fecha de vencimiento y forma de pago;
  - ítems con código, artículo, observaciones, cantidad, precio, % dto, importe, alícuota e
    importe con IVA;
  - pie con IVA discriminado por alícuota (2.5 / 5 / 10.5 / 21 / 27), bruto, impuestos y total;
    QR de ARCA, CAE y vencimiento del CAE.
- **Formulario preimpreso** (`A-09999-00000190`): solo datos (fecha, receptor, CUIT, condición,
  moneda, ítems con cantidad/precio/importe, totales), posicionados para imprimir sobre papel
  con el diseño ya impreso.

## Alcance

**Entra:**
- Factura, Nota de Crédito y Nota de Débito, letras **A y B** (el emisor es Responsable
  Inscripto).
- Concepto **Productos** (código 1).
- Moneda pesos.
- CRUD de borradores, autorización en ARCA, listado, detalle y PDF.

**No entra (por ahora):** letra C/M, exportación (E), servicios con período facturado, moneda
extranjera, percepciones/otros tributos, remitos, cuenta corriente/cobranzas, envío por mail.

## Reglas de negocio

### Ciclo de vida: "CRUD" sólo sobre borradores

| Estado | Se puede | No se puede |
| --- | --- | --- |
| `borrador` | crear, editar, duplicar, borrar, autorizar | imprimir como válido |
| `autorizado` (tiene CAE) | ver, imprimir PDF, duplicar, generar nota de crédito/débito asociada | editar, borrar |
| `rechazado` | ver el motivo, volver a borrador para corregir | — |

- Un comprobante autorizado **no se edita ni se borra nunca**: es un documento fiscal. Para
  corregirlo o anularlo se emite una **nota de crédito** asociada (total o parcial).
- El borrador no tiene número. El número se asigna **al autorizar**.

### Letra y tipo de comprobante

Según la condición IVA del receptor (emisor Responsable Inscripto):

| Receptor | Letra | Factura / NC / ND (código ARCA) |
| --- | --- | --- |
| Responsable Inscripto | A | 1 / 3 / 2 |
| Monotributista | A | 1 / 3 / 2 |
| Exento | B | 6 / 8 / 7 |
| Consumidor Final | B | 6 / 8 / 7 |

- La letra se calcula; el usuario elige sólo "Factura / Nota de crédito / Nota de débito".
- Si el cliente no tiene condición IVA cargada, no se puede autorizar: se pide completarla.

### Receptor

- **Letra A:** CUIT válida obligatoria (`DocTipo 80`, validada con `validarCuit`).
- **Letra B:** CUIT (`80`), DNI (`96`) u "otro" (`99`). Consumidor final sin identificar sólo
  por debajo del tope que fija ARCA (el tope se valida contra ARCA, no se hardcodea).
- `CondicionIVAReceptorId` (obligatorio en WSFE): RI = 1, Exento = 4, Consumidor Final = 5,
  Monotributista = 6.
- **Snapshot:** al autorizar se copian al comprobante razón social, CUIT, domicilio, condición
  IVA y provincia del cliente. Si después cambia la ficha del cliente, la factura no cambia.

### Numeración (sin intervención del usuario)

1. Al autorizar se toma un bloqueo por (ambiente, punto de venta, tipo de comprobante), con el
   mismo patrón que el ticket WSAA.
2. Se consulta `FECompUltimoAutorizado` y se usa **último + 1**.
3. Se llama a `FECAESolicitar`.
4. Si ARCA rechaza por número no correlativo (otro sistema emitió en el medio), se vuelve a
   consultar el último y se reintenta **una sola vez**.
5. **Respuesta perdida** (timeout o corte después de enviar): el comprobante queda en estado
   `verificando`. Antes de reintentar se consulta `FECompConsultar` con ese número.
   - Si ARCA lo tiene, se guarda su CAE.
   - Si no, se reintenta.
   - Nunca se pide un CAE dos veces a ciegas.

### Ítems y precios

- **Producto:** se elige del catálogo (`producto`, `TERMINADO` o `SUBGRUPO`). Se copian código,
  nombre, unidad de venta y `alicuota_iva`.
- **Ítem libre:** descripción y alícuota a mano (para conceptos que no son productos, como
  "Desarrollo de producto" en la factura de referencia).
- **Precio unitario sin IVA**, con 4 decimales.
  - Por defecto sale de la **lista de precios elegida en el comprobante** (`lista_precio_item.precio_final`, que ya es sin IVA).
  - Si el producto no está en esa lista, queda en 0 y hay que cargarlo.
  - Siempre se puede editar.
- Descuento por ítem en %.
- Observaciones por ítem (texto que se imprime debajo de la descripción).
- Cálculo por ítem: `importe = cantidad × precio × (1 − dto%)`, redondeado a 2 decimales;
  `iva = importe × alícuota`.
- Totales para WSFE:
  - `ImpNeto` = suma de importes gravados;
  - `ImpIVA` = suma por alícuota, cada alícuota redondeada a 2 decimales;
  - `ImpTotConc` = 0, `ImpOpEx` = 0 y `ImpTrib` = 0 (no entran en el alcance);
  - `ImpTotal` = `ImpNeto` + `ImpIVA`;
  - array `Iva` con un registro por alícuota (Id 3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%, 8 = 5%,
    9 = 2.5%).
- Mismo cálculo en el servidor al autorizar (lo que se ve en pantalla no es la fuente de
  verdad).

### Fechas

- **Fecha del comprobante:** hoy por defecto. Para concepto Productos, ARCA acepta hasta
  ±5 días; no puede ser anterior al último comprobante autorizado de ese tipo y punto de venta.
- **Vencimiento del cobro:** por defecto igual a la fecha. Se imprime; no va a ARCA en
  concepto Productos.

### Notas de crédito / débito

- Se crean desde una factura autorizada ("Generar nota de crédito"). Copia los ítems para
  ajustar cantidades o precios.
- Llevan comprobante asociado (`CbtesAsoc`: tipo, punto de venta, número, CUIT, fecha).
- **Facturas viejas** (1 a 360, emitidas con el sistema anterior): no están en la base. Para
  una NC sobre ellas se cargan a mano los datos del comprobante asociado.

### Ambiente

- Se emite en el ambiente activo de `/configuracion/arca`. En homologación el comprobante se
  marca "SIN VALIDEZ FISCAL" en pantalla y en el PDF.
- La numeración y los listados se separan por ambiente: los comprobantes de prueba nunca se
  mezclan con los reales.

## Datos

Tablas nuevas (nombres siguiendo las convenciones del repo, RLS en migración aparte):

- `comprobante`:
  - **Identificación:** `id`, `ambiente`, `estado` (borrador | verificando | autorizado | rechazado), `clase` (factura | nota_credito | nota_debito), `letra`, `tipo_arca`, `punto_venta`, `numero` (null en borrador).
  - **Fechas:** `fecha`, `fecha_vencimiento_pago`.
  - **Venta:** `cliente_id`, `lista_precio_id`, `condicion_pago`, `observaciones`, `moneda` ('PES').
  - **Snapshot del receptor:** `receptor_razon_social`, `receptor_doc_tipo`, `receptor_doc_nro`, `receptor_condicion_iva`, `receptor_domicilio`, `receptor_provincia`.
  - **Totales:** `neto`, `iva`, `total`.
  - **Resultado ARCA:** `cae`, `cae_vencimiento`, `arca_resultado`, `arca_observaciones` (jsonb), `arca_errores` (jsonb).
  - **Auditoría:** `creado_por`, `creado_en`, `autorizado_en`.
  - Único (`ambiente`, `punto_venta`, `tipo_arca`, `numero`) cuando `numero` no es null.
  - Trigger que impide modificar o borrar un comprobante `autorizado`.
- `comprobante_item`: `id`, `comprobante_id`, `orden`, `producto_id` (null en ítem libre),
  `codigo`, `descripcion`, `observaciones`, `unidad`, `cantidad`, `precio_unitario`
  (numeric 4 dec), `descuento_pct`, `alicuota_iva`, `importe`, `iva`.
- `comprobante_asociado`: `comprobante_id`, `asociado_id` (si está en la base) o tipo + punto
  de venta + número + fecha + CUIT (si es viejo).
- `arca_emisor` suma: domicilio comercial, ingresos brutos, inicio de actividades y logo, que
  hacen falta para el PDF.
- **Puntos de venta** (`punto_venta`): `numero`, `nombre`, `electronico` (bool), `activo`.
  - Arranca con el **7, electrónico**, que reemplaza a `arca_emisor.punto_venta`. Se migra el
    valor y se deja de usar esa columna.
  - **Electrónico:** el número lo da ARCA (último autorizado + 1) y se pide CAE.
  - **No electrónico** (se crea después): no pasa por ARCA. El número se asigna en nuestra base
    con una secuencia por (punto de venta, tipo), dentro de la misma transacción que "emite" el
    comprobante. Qué datos lleva depende de la pregunta 1 (CAI o documento interno).
  - `comprobante.punto_venta` referencia a esta tabla. El listado y la numeración se separan por
    punto de venta.

## Pantallas

Menú **Ventas → Comprobantes**.

- **Listado:**
  - Columnas: fecha, tipo y letra, número (`A-00007-00000361`), cliente, total, estado y CAE.
  - Filtros: rango de fechas, cliente, tipo, estado y ambiente.
  - Se ven todos los estados; los borradores arriba.
- **Nuevo / editar borrador** (inspirado en la pantalla actual):
  - **Cabecera:** cliente (buscador, igual que en clientes), clase de comprobante, fecha,
    vencimiento del cobro, condición de pago, lista de precios.
  - **Datos que se muestran calculados:** punto de venta, letra, y número "se asigna al
    autorizar".
  - **"Más opciones":** observaciones generales.
  - **Ítems:** producto o libre, observaciones, cantidad, precio, % dto, importe, IVA y total
    por fila. "Agregar ítem" y quitar fila.
  - **Totales:** neto, IVA discriminado por alícuota, y total.
  - Botones: **Guardar borrador** y **Autorizar en ARCA**. El segundo pide confirmación y
    muestra el resumen: "Se va a emitir Factura A al cliente X por $Y. No se puede deshacer".
  - **Validaciones antes de autorizar:** receptor completo, al menos un ítem, cantidades > 0,
    total > 0, fecha dentro del rango.
  - Los errores y observaciones de ARCA se muestran tal cual llegan, con código y texto.
- **Detalle del comprobante autorizado:** todos los datos de solo lectura, CAE y vencimiento,
  y botones "PDF", "Duplicar" y "Generar nota de crédito".

## Impresión

- **PDF de una sola copia** con el formato de la factura de referencia y los datos de Silfe:
  - QR de ARCA, que es obligatorio: JSON con los datos del comprobante en base64, en
    `https://www.arca.gob.ar/fe/qr/?p=…`;
  - leyenda "Comprobante Autorizado" con el CAE y su vencimiento.
- Generado en el Worker con `pdf-lib`, igual que las listas de precios. El QR necesita una
  librería pura JS o una implementación propia; hay que validar que funcione en el Worker.
- **Formulario preimpreso** (decidido): es un **formato de impresión** que se usa **sólo para
  comprobantes no electrónicos** (sin CAE, sin validez fiscal).
  - Imprime sólo los datos, en coordenadas fijas, sobre el papel ya diseñado. Sin logo, sin
    líneas, sin encabezados de columna, y sin CAE ni QR.
  - Las coordenadas salen del PDF de referencia `A-09999-00000190` y quedan en una constante
    (en mm), para poder ajustarlas sin tocar la lógica.
  - Se imprime al 100% en A4: el PDF no debe escalar.
- Los comprobantes **electrónicos** se imprimen sólo con el PDF completo.

## Fuera de la app (pase)

- Cortar el sistema anterior el mismo día que se empieza a emitir desde acá. Los dos nunca
  emiten a la vez en el punto de venta 7.
- Antes, probar todo en homologación: la tarjeta de homologación de producción tiene que tener
  `silfe-homo.crt`.

## Preguntas abiertas

1. ~~Preimpreso y comprobantes no electrónicos~~ **Respondido:**
   - Los comprobantes no electrónicos son **documentos sin validez fiscal**. Van por su propio
     punto de venta, con numeración en nuestra base, sin ARCA y sin CAE.
   - El formulario preimpreso se usa **sólo** para ellos.
   - **Decisión del usuario (16/10):** el documento sin validez fiscal se maneja **igual que el
     fiscal**: mismas clases (factura / NC / ND), misma letra A/B según el receptor, mismos ítems,
     totales, estados e inmutabilidad. La única diferencia es que **no se pide CAE**. Al
     "emitir", el número se asigna en nuestra base y pasa directo a `autorizado` sin CAE.
     - Se advirtió que la práctica habitual es la leyenda "DOCUMENTO NO VÁLIDO COMO FACTURA" y
       no usar letra; el usuario decidió mantener el mismo formato.
2. ~~Punto de venta 2 vs 7~~ **Respondido:** los comprobantes electrónicos van por el **7**.
   Más adelante se crea otro punto de venta para los no electrónicos (ver "Puntos de venta" en
   Datos).
3. ~~Centro de costo~~ **Respondido:** no se usa; queda afuera (ni columna ni campo).
4. ~~Percepciones e impuestos~~ **Respondido:** Silfe **no es agente** de percepción. `Tributos`
   e `ImpTrib` = 0 quedan fuera del alcance, y la sección "Percepciones e impuestos" de la
   pantalla actual no se replica.
5. ~~Condición de pago~~ **Respondido:**
   - Dos opciones fijas: **Cuenta corriente** y **Contado**.
     - Columna `condicion_pago` con check `('cuenta_corriente','contado')`.
     - Por defecto Cuenta corriente, como en el sistema actual.
     - Con Contado, el vencimiento del cobro es la fecha del comprobante.
   - **Segunda etapa:** en el sistema actual, Contado abre la carga del pago y genera el asiento
     automático. Queda fuera de este alcance, junto con cobranzas y contabilidad.
6. ~~Lista de precios por cliente~~ **Respondido:** se elige en cada comprobante. El cliente no
   tiene lista asignada; por defecto se propone la lista creada más recientemente.
7. ~~Servicios~~ **Respondido:** por ahora no. Sólo concepto Productos (1). Los ítems libres
   como "Desarrollo de producto" se facturan igual como concepto 1.
8. ~~Copias~~ **Respondido:** una sola copia, sin leyenda Original/Duplicado.

## Checklist (tentativo, se ajusta al cerrar las preguntas)

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Migraciones `comprobante`, `comprobante_item`, `comprobante_asociado`, campos nuevos del emisor, triggers de inmutabilidad y RLS (pgTAP en rojo primero) | delegada (writer) | [x] |
| T2 | `src/lib/comprobantes/`: letra/tipo, cálculo de totales e IVA por alícuota, armado y parseo de `FECAESolicitar`, `FECompConsultar`, QR. Extraer el `AlmacenTicket` de Supabase a un módulo compartido (Vitest) | delegada (writer) | [ ] |
| T3 | Autorización: bloqueo por punto de venta y tipo, último + 1, reintento correlativo, estado `verificando` y reconciliación | delegada (writer) | [ ] |
| T4 | Pantallas: listado, alta/edición de borrador y detalle | delegada (writer) | [ ] |
| T5 | Impresión: PDF completo con QR para comprobantes electrónicos | delegada (writer) | [ ] |
| T6 | Notas de crédito/débito con comprobante asociado | delegada (writer) | [ ] |
| T7 | Recorrido en homologación: Factura A, Factura B, NC parcial, rechazo de ARCA y respuesta perdida simulada | orquestador | [ ] |
| T8 | **Segunda etapa:** punto de venta no electrónico (numeración propia, sin ARCA) e impresión en formulario preimpreso | delegada (writer) | [ ] |

## Entrega

- Previsión: ~3000 líneas en la etapa 1 (T1–T7).
- Estrategia: PR único al terminar la etapa 1, igual que en `arca-configuracion`. Los commits separan cada tarea.
- Rutas: T1–T6 delegadas (cada una toca 2 o más archivos no triviales); T7 orquestador.

## Criterios de aceptación

- Un borrador se puede editar y borrar; un autorizado no (ni desde la app ni con SQL directo).
- Autorizar una Factura A en homologación devuelve CAE, numera último + 1 y el PDF muestra QR,
  CAE y vencimiento.
- Un cliente Consumidor Final genera Factura B; un RI o Monotributista, Factura A.
- Si ARCA rechaza, el comprobante queda `rechazado` con el código y mensaje de ARCA, sin número
  consumido.
- Una respuesta perdida no genera un CAE duplicado.
- Dos autorizaciones simultáneas en el mismo punto de venta y tipo no chocan en el número.
- Los totales del PDF coinciden con lo enviado a ARCA.

## Checks

- Test-first: pgTAP (restricciones, inmutabilidad, RLS) y Vitest (letra, totales, redondeo,
  armado/parseo SOAP con `fetch` simulado, QR).
- `npm test`, `supabase test db`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Recorrido en el navegador en homologación.

## Progreso

- Rama `feat/comprobantes-venta` creada desde `main` (6dc480f).
- T1 (delegada, writer: 3 archivos SQL no triviales): migraciones `20261024000001_comprobantes.sql` y
  `20261024000002_rls_comprobantes.sql`, test `supabase/tests/comprobantes_test.sql` (86 pruebas).
  - RED observado (tablas inexistentes) y luego GREEN con `supabase test db supabase/tests/comprobantes_test.sql`.
  - Bloqueo de numeración: tabla `comprobante_numeracion_bloqueo` + funciones `tomar_bloqueo_numeracion`
    (devuelve el vencimiento como llave, o null si está tomado) y `liberar_bloqueo_numeracion` (security invoker).
  - Errores de los triggers con SQLSTATE propio: CM001 autorizado inmutable, CM002 transición inválida,
    CM003 borrado no permitido, CM004 ítems/asociados bloqueados, CM005 punto de venta inconsistente.
  - Pendiente: `supabase/tests/arca_configuracion_test.sql` (fuera de la superficie de T1) espera las columnas
    viejas de `arca_emisor` y falla con las tres nuevas; hay que sumarlas a su `columns_are`.

## Próximo paso

T1 + T2.

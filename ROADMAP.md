# Roadmap — Silfe Costos

Silfe Costos es el **primer módulo** de un programa más grande que se va a construir alrededor
de este repo. Este roadmap ordena el trabajo que falta, empezando por la **lista de precios**,
que es la prioridad actual.

Referencia de formato: la lista de precios que se venía usando (`2023-DICIEMBRE.pdf`).

---

## Objetivo: lista de precios

Tomar el precio sugerido que ya calcula el sistema, permitir ajustarlo a mano y generar una
**lista de precios descargable** que quede guardada como **historial**.

### Qué tiene que hacer

- Nueva opción de menú **Listas de precios**.
- Índice de listas con **fecha de creación**, **nombre** y botón **Descargar**.
- Botón **Nueva lista**, que precarga:
  - todos los productos `TERMINADO` activos;
  - todos los `SUBGRUPO` activos (los repuestos, por ejemplo lona interior o correaje);
  - el **precio sugerido** de cada uno como valor inicial, **editable**.
- Posibilidad de **agregar ítems manuales** que no existen en el sistema.
- Una lista guardada queda **congelada**: es una foto de los precios de ese momento y no cambia
  aunque después se modifiquen los costos.

### Lo que muestra el formato de referencia

Cada renglón de la lista tiene:

| Dato | Ejemplo | ¿Existe hoy? |
| --- | --- | --- |
| Código | `001` | Sí (`producto.codigo`) |
| Descripción | Recolector grande de plástico acolchado completo | Sí (`producto.nombre`) |
| Presentación de venta | `x docena` | **No.** Solo existe `producto.unidad_id`, sin cantidad por presentación |
| Precio sin IVA | `$ 24500` | Parcial: hay `precio_sugerido` por unidad, no por presentación |
| Alícuota de IVA | `10,5%` / `21%` | **No.** El producto no tiene alícuota |

Además:

- **Agrupación visual**: bloques separados por espacio, y repuestos debajo de su producto
  ("Repuestos:").
- **Encabezado** con el logo y el título ("LISTA DE PRECIOS DICIEMBRE 2023").
- **Pie** con un texto destacado ("SIL – FE 30 AÑOS") y los datos de contacto.
- Los precios están **redondeados** (24500, 84500), no son el valor exacto calculado.

---

## Fases

### Fase 0 — Definiciones pendientes

Decisiones a cerrar antes de escribir código:

1. ~~**Presentación de venta.**~~ **Resuelto:** conviven los dos casos. Algunos productos se
   costean directamente por docena y otros por unidad y se venden por docena (× 12). Se modela
   con un factor por producto (ver Fase 1).
2. ~~**Redondeo.**~~ **Resuelto:** al crear la lista, el precio de cada ítem se precarga
   redondeado automáticamente a la centena, y se puede editar a mano. Se guardan los dos
   valores: el sugerido exacto y el final. El redondeo es **siempre hacia arriba**, para no
   perder margen: `ceil(precio / 100) * 100` (24.420 → 24.500).
3. ~~**Edición después de guardar.**~~ **Resuelto:** una lista guardada es **inmutable**. Para
   corregirla se **duplica** y se guarda como una lista nueva. No hay estado de borrador
   persistido: la lista existe recién cuando se guarda.
4. ~~**Formato de descarga.**~~ **Resuelto:** **PDF y Excel**. El botón Descargar del índice
   ofrece los dos formatos.
5. ~~**Integración con el programa principal.**~~ **Resuelto:** el programa principal todavía no
   existe y **se va a construir alrededor de este repo**. Este repo es la base: comparte login,
   base de datos y menú, y "Costos" es el primer módulo (ver "Transversal — Base del programa").

### Fase 1 — Datos de venta en el producto

Agregar al producto lo que la lista necesita y hoy no existe:

- [ ] `alicuota_iva` (10,5 / 21 / ...), con valor por defecto 21.
- [ ] Presentación de venta: `unidad_venta_id` (`docena`, `unidad`) y
      `factor_venta` = cuántas unidades de costeo entran en una presentación de venta.
  - Costeado por docena y vendido por docena: unidad de costeo = docena, factor = 1.
  - Costeado por unidad y vendido por docena: unidad de costeo = unidad, factor = 12.
  - Precio de la presentación = `precio_sugerido` × `factor_venta`. Va como columna
    nueva en la vista de costeo, para no recalcular en la app.
  - Valor por defecto: unidad de venta = unidad de costeo, factor = 1.
- [x] ~~Campos de agrupación~~ **Resuelto sin cambios en el producto:** la agrupación sale sola
      de la estructura. Cada `SUBGRUPO` aparece como repuesto ("Repuestos:") debajo de cada
      `TERMINADO` que lo usa en `producto_componente`. Se arma al generar la lista (Fase 2).
      Si un subgrupo lo usan varios productos, aparece debajo de cada uno. Si no lo usa
      ninguno, va a una sección "Otros repuestos" al final. El orden es por código.
- [ ] Mostrar y editar estos campos en la ficha del producto.

### Fase 2 — Modelo de listas (base de datos)

- [ ] Tabla `lista_precio`: nombre, fecha de creación, título, notas y usuario creador.
- [ ] Tabla `lista_precio_item`, que guarda una **foto** de cada ítem:
  - referencia opcional a `producto` (vacía en los ítems manuales);
  - código, descripción, presentación y alícuota de IVA **copiados** al momento de crear la lista;
  - `precio_sugerido` (el calculado) y `precio_final` (el editado);
  - orden y sección.
- [ ] RLS para las dos tablas, igual que en el resto del esquema.
- [ ] Una función o acción que crea el borrador a partir de la vista de costeo.

### Fase 3 — Interfaz

- [ ] Agregar la opción **Listas de precios** al menú.
- [ ] Índice de listas: fecha, nombre y botón **Descargar**.
- [ ] Pantalla **Nueva lista**:
  - tabla con todos los ítems precargados y el precio editable en línea;
  - comparación entre el precio sugerido y el precio final (diferencia en %);
  - **agregar ítem manual**, quitar ítems y reordenarlos;
  - botón **Guardar**, que congela la lista.
- [ ] Ver el detalle de una lista histórica (solo lectura).
- [ ] **Duplicar** una lista existente: abre la pantalla de nueva lista precargada con sus
      ítems y precios finales. Es la única forma de corregir una lista, porque son inmutables.
- [ ] La base impide modificar o borrar los ítems de una lista guardada (RLS sin `update` ni
      `delete`, o un trigger).

### Fase 4 — Descarga en PDF y Excel

- [ ] PDF con el formato de referencia: logo, título, renglones agrupados y pie con contacto.
- [ ] Logo nuevo guardado en el repo o en Supabase Storage (falta descargarlo de Drive).
- [ ] Encabezado y pie configurables desde **Configuración**: texto destacado y contacto.
- [ ] **Restricción técnica:** el deploy corre en Cloudflare Workers, así que no se puede usar
      Puppeteer ni Chrome headless. Hay que validar una librería compatible con Workers (por
      ejemplo `pdf-lib` o `@react-pdf/renderer`) o generar una página imprimible y usar
      "Imprimir → PDF" del navegador.
- [ ] Excel (`.xlsx`) con las mismas columnas: código, descripción, presentación, precio sin
      IVA y alícuota de IVA. Los precios van como números, no como texto, para poder operar con
      ellos. También hay que validar una librería compatible con Workers (por ejemplo SheetJS).
- [ ] Los dos archivos se generan **a pedido desde la foto guardada**. No hace falta almacenarlos:
      el resultado es siempre el mismo porque la lista es inmutable.

### Fase 5 — Mejoras

- [ ] Comparar una lista contra la anterior: % de aumento por ítem.
- [ ] Aumento masivo: aplicar un % a todos los ítems o a una sección.

### Transversal — Base del programa

Este repo va a crecer hasta convertirse en el programa completo. No hace falta reestructurar ahora,
pero conviene no cerrarse el camino:

- [ ] Agrupar el menú por módulo ("Costos" con sus pantallas actuales y "Listas de precios"),
      para que los módulos que vengan después tengan su propio lugar.
- [ ] Mantener la organización por feature en `src/app/(app)/`. Cada módulo nuevo es una
      carpeta más, no una capa transversal.
- [ ] Más adelante: roles y permisos por módulo. Hoy cualquier usuario logueado ve todo. No
      bloquea la lista de precios.
- [ ] Definir el nombre del programa y si el repo o el proyecto de Supabase se renombran.

### Transversal — Calidad

- [ ] El proyecto no tiene tests. Arrancar con tests del armado de la lista (foto, precio
      final, ítems manuales) y de las vistas de costeo de las que depende.
- [ ] Mergear la rama de trabajo actual (`claude/product-cost-system-qcq2tf`) a una rama
      principal antes de empezar a apilar features.

# Roadmap — Charoli Gestión

Charoli Gestión nació como el sistema de costos (su **primer módulo**) de un programa de uso interno que se va a construir
alrededor de este repo. Este roadmap registra lo que ya está hecho y ordena lo que sigue.

Producción: https://silfe-costos.fedechingo.workers.dev · Rama principal: `main`.

---

## Hecho: lista de precios (Fases 0 a 4 y pasada de mejoras)

Toma el precio sugerido que calcula el sistema, permite ajustarlo y genera una **lista de precios
descargable** que queda guardada como **historial inmutable**. El formato de referencia es la
lista que se venía usando (`2023-DICIEMBRE.pdf`).

### Decisiones tomadas (Fase 0)

1. **Presentación de venta:** algunos productos se costean por docena y otros por unidad y se
   venden por docena. Cada producto tiene `unidad_venta_id` y `factor_venta`, y el precio de la
   presentación es `precio_sugerido × factor_venta`.
2. **Redondeo:** el precio se precarga redondeado **hacia arriba a la centena** y se puede editar
   a mano. Se guardan el sugerido exacto y el final.
3. **Inmutabilidad:** una lista guardada no se modifica ni se borra; para corregirla, se duplica.
   Un producto que está en una lista guardada no se puede borrar, solo desactivar.
4. **Formatos:** PDF y Excel, generados a pedido desde la foto guardada.
5. **Programa:** el programa principal se construye alrededor de este repo; Costos es el primer
   módulo.
6. **Agrupación:** los repuestos (`SUBGRUPO`) aparecen solos debajo de cada producto que los usa,
   según la estructura.
7. **Ítems manuales:** se pueden cargar renglones libres (por ejemplo "Remeras SILFE $1000") que no
   hacen referencia a nada del sistema y existen solo en esa lista.

### Qué se construyó

- [x] **Fase 1 — Datos de venta del producto:** alícuota de IVA (tope 100), presentación de venta
      y factor, y el precio por presentación en la vista de costeo.
- [x] **Fase 2 — Modelo:** tablas `lista_precio` y `lista_precio_item` (foto inmutable), vista
      `v_lista_precio_base` y función `crear_lista_precio`, con RLS de solo lectura.
- [x] **Fase 3 — Interfaz:** menú **Ventas → Listas de precios**, índice, nueva lista editable
      (precio, ítems manuales, quitar y reordenar), detalle de solo lectura y **Duplicar**.
      Los productos con costos incompletos se marcan y exigen un precio a mano.
- [x] **Fase 4 — Descarga:** PDF con el formato de referencia (logo, título, repuestos,
      "x docena", "+ IVA (n%)" y pie configurable en Parámetros) y Excel con números.
- [x] **Mejoras:**
  - protección de las listas al borrar productos;
  - validación en el servidor;
  - duplicado con datos actuales;
  - descargas robustas;
  - PDF sin superposiciones;
  - permisos de `anon` revocados.
- [x] **Calidad:** tests de base de datos (pgTAP, `supabase test db`) y de la app (Vitest,
      `npm test`). Rama `main` creada y ramas viejas eliminadas.

El detalle de cada fase está en `odd/tasks/`.

### Pendientes menores

- [ ] Tests de la acción que guarda una lista: producto ausente tratado como incompleto y error
      de FK.
- [ ] Unificar el mensaje del servidor ("costos incompletos") con el de la pantalla ("Inactivo")
      para productos desactivados.

---

## Siguiente: CRM de clientes y ventas

Seguimiento de clientes y de la gestión comercial. Parte del módulo de clientes que ya existe:

- `cliente`: razón social, CUIT, dirección, localidad, provincia, CP, teléfono, zona y código
  legado;
- `zona`: catálogo cerrado;
- `cliente_contacto`: nombre, cargo y teléfono.

### Fase 6 — Ficha completa del cliente (ABM)

- [ ] Datos fiscales y comerciales: CUIT, condición frente al IVA, CBU, CVU o alias, y
      observaciones.
- [ ] **Transporte** habitual del cliente, tomado de un catálogo de transportes.
- [ ] **Sucursales** y **direcciones de entrega**: varias por cliente, con una marcada como
      principal.
- [ ] **Contactos:** sumar email y WhatsApp a los que ya hay.
- [ ] Búsqueda y filtros en el listado: zona, activo y texto.

### Fase 7 — Seguimiento (llamados, visitas, etc.)

- [ ] Registro de **interacciones** por cliente: tipo (llamado, visita, WhatsApp, email), fecha,
      contacto, resultado y notas.
- [ ] **Próximo contacto:** fecha de seguimiento y una vista "a contactar hoy o atrasados".
- [ ] Historial en la ficha del cliente, ordenado por fecha.

### Fase 8 — Ventas

- [ ] Alcance a definir.

---

## Más adelante

- **Lista de precios:**
  - comparar contra la lista anterior (% de aumento por ítem);
  - aumento masivo: aplicar un % a todos los ítems o a una sección.
- Definir el nombre del programa y si conviene renombrar el repo y el proyecto de Supabase.

## Fuera de alcance por ahora

- **Roles y permisos:** es un sistema de uso interno. Todos los usuarios logueados ven todo.

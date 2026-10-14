# Ficha completa del cliente (Fase 6 del roadmap, CRM)

## Objetivo

Completar el ABM de clientes con los datos que se necesitan para vender y despachar:

- datos fiscales y bancarios;
- transporte habitual;
- sucursales y direcciones de entrega;
- contactos completos;
- búsqueda y filtros en el listado.

## Problema y por qué

El módulo de clientes actual tiene lo básico: razón social, CUIT, una sola dirección, teléfono,
zona y contactos con nombre, cargo y teléfono. Para el seguimiento comercial (Fase 7) y las
ventas (Fase 8) falta saber cómo se le factura al cliente, adónde se le entrega, por qué
transporte y con quién se habla.

## Decisiones (defaults del agente, a confirmar por el usuario)

- **Domicilio fiscal:** son los campos de dirección que ya existen en `cliente` (dirección,
  localidad, provincia y CP). No se tocan.
- **Condición frente al IVA:** catálogo cerrado con Responsable Inscripto, Monotributista,
  Exento y Consumidor Final. Es opcional.
- **CUIT:** sigue siendo texto no único, porque los datos legados tienen repetidos y
  placeholders. La pantalla valida el dígito verificador y avisa si no cierra, sin bloquear.
- **Datos bancarios:**
  - CBU y CVU opcionales, de 22 dígitos, con validación de formato en la base;
  - los dígitos verificadores del CBU se validan en la app y avisan sin bloquear;
  - alias opcional, de 6 a 20 caracteres: letras, números, punto y guion.
- **Transporte:** catálogo `transporte` con nombre, teléfono y observaciones, administrable desde
  el menú. El cliente tiene un transporte habitual opcional.
- **Sucursales y direcciones de entrega:** una sola tabla, `cliente_sucursal`.
  - Datos: nombre ("Casa central", "Depósito Cipolletti"), dirección, localidad, provincia, CP,
    teléfono y observaciones.
  - `recibe_entregas`: indica si la sucursal es un punto de entrega.
  - `principal`: marca la dirección de entrega principal. Puede haber una sola por cliente,
    garantizado con un índice único parcial.
  - Transporte propio opcional, que reemplaza al habitual del cliente para esa sucursal.
- **Contactos:** se suman email, WhatsApp, observaciones y una sucursal opcional.
- **Listado:** búsqueda por razón social, CUIT o código legado, y filtros por zona y activo.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Migraciones: condición IVA, CBU/CVU/alias, `transporte`, `cliente_sucursal` y contactos ampliados, más su RLS (con tests pgTAP en rojo primero) | delegada (writer) | [x] |
| T2 | Validaciones puras de CUIT, CBU, CVU y alias, con Vitest | delegada (writer) | [x] |
| T3 | ABM de transportes (menú y pantalla) | delegada (writer) | [x] |
| T4 | Ficha del cliente: datos fiscales y bancarios, transporte, sucursales y direcciones de entrega, contactos ampliados | delegada (writer) | [x] |
| T5 | Listado de clientes con búsqueda y filtros | delegada (writer) | [x] |
| T6 | Recorrido en el navegador contra Supabase local | orquestador | [x] |

## Criterios de aceptación

- Un cliente existente sigue funcionando: todos los campos nuevos son opcionales.
- La base rechaza un CBU o CVU que no tenga exactamente 22 dígitos, y un alias con caracteres
  inválidos.
- No puede haber dos sucursales principales para el mismo cliente.
- Borrar un transporte usado por clientes o sucursales queda bloqueado, con un mensaje claro.
- La ficha permite alta, edición y baja de sucursales y contactos, y elegir el transporte.
- El listado filtra por texto, zona y activo, y mantiene los filtros en la URL.

## Checks

- Test-first: pgTAP para las restricciones de la base y Vitest para los validadores.
- `npm test`, `supabase test db`, `npm run typecheck`, `npm run lint` y `npm run build`.
- Recorrido en el navegador contra Supabase local.

## Progreso

- Rama `feat/crm`, desde `main` (`da05bd6`). Roadmap actualizado en `e44b4a6`.

- T1 a T5 implementados por un writer delegado:
  - migraciones `20261019000001_crm_ficha_cliente.sql` y `20261019000002_rls_crm_ficha_cliente.sql`;
  - `src/lib/clientes/` (validaciones y búsqueda);
  - ABM `/transportes`;
  - ficha y listado de clientes.
- Decisiones del writer:
  - la sucursal de un contacto tiene que ser del mismo cliente (FK compuesta con
    `on delete set null (sucursal_id)`);
  - el CVU usa los mismos dígitos verificadores que el CBU y empieza con `000` (BCRA A 8303);
  - la edición del cliente pasó al detalle (`?editar=1`);
  - sucursales y contactos se editan en modales;
  - se agregaron índices en `cliente(cuit)` y en las FK de transporte.
- RED observado: falló pgTAP del archivo nuevo y fallaron las suites de Vitest de `validaciones`
  y `busqueda`, porque no existían.
- GREEN: `supabase test db` con 127 tests y `npm test` con 98, todos en verde. Typecheck, lint y
  build OK.
- T6, recorrido en el navegador contra Supabase local, sin errores en consola:
  - alta de un transporte;
  - alta de un cliente con condición de IVA y transporte habitual;
  - un CUIT ficticio inválido muestra un aviso amarillo y no bloquea el guardado;
  - la ficha muestra los datos fiscales y comerciales;
  - se cargaron dos sucursales marcadas como principales: la principal pasó a la segunda;
  - la búsqueda "prueba" encuentra el cliente, y `%_` no se toma como comodín;
  - borrar un transporte en uso muestra el aviso.
- Seguimientos:
  - los errores de las acciones de sucursales y contactos se siguen lanzando, así que en
    producción Next muestra un mensaje genérico;
  - el formulario del cliente se vacía después de un error;
  - el contador dice "1 clientes";
  - los campos del alta de cliente no tienen las etiquetas asociadas (accesibilidad).

## Próximo paso

Commits, evaluación de riesgo y revisión. Después, Fase 7 (seguimiento de llamados).

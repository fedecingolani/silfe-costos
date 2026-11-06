# API de compras para Factura Digital

Estado: en curso.

## Objetivo

Que Factura Digital (repo `fedecingolani/factura_digital`) le envíe a Charoli las facturas de compra que digitaliza, y que pueda consultar y dar de alta proveedores, a través de una API HTTP autenticada con clave.

## Problema

Hoy las facturas de compra se cargan a mano en Charoli, aunque Factura Digital ya las tiene digitalizadas y revisadas. Charoli no tiene API: el middleware manda cualquier ruta sin sesión a `/login`.

## Por qué

- No cargar dos veces la misma factura.
- Era uno de los objetivos de la feature de compras: "dejar listo el modelo para un importador de facturas con IA" (`odd/tasks/compras.md`).

## Decisiones

### Autenticación

- Clave de API por integración: `Authorization: Bearer <clave>`. Se crea y revoca en Configuración → Integraciones. Se muestra completa una sola vez.
- En la base se guarda sólo el SHA-256 de la clave y un prefijo visible para reconocerla. Alcanza SHA-256 porque la clave es aleatoria de 32 bytes, no una contraseña.
- Las rutas `/api/v1/*` no pasan por el login del middleware; cada ruta valida la clave.
- La ruta escribe con la service-role key de Supabase (secreto nuevo del Worker `SUPABASE_SERVICE_ROLE_KEY`). Llama a las mismas funciones de base que las pantallas, así no se duplica lógica de negocio.

### Proveedores

- `GET /api/v1/proveedores?cuit=<11 dígitos>` devuelve la lista de coincidencias (vacía si no existe).
- `POST /api/v1/proveedores` lo crea con nombre, CUIT, condición de IVA y domicilio. Si el CUIT ya existe responde 409 con el proveedor existente.
- Factura Digital consulta el proveedor y, si no existe en Charoli, le sugiere al usuario crearlo. La API de comprobantes no crea proveedores.
- El CUIT pasa a guardarse sólo con dígitos y único entre proveedores (antes era texto libre sin índice).

### Comprobantes

- `POST /api/v1/comprobantes-compra` crea el comprobante siempre en borrador. Nunca lo confirma: una persona lo revisa y asocia cada artículo a una materia prima, como ya exige confirmar.
- El proveedor se identifica por CUIT. Si no existe, responde 422 `PROVEEDOR_NO_EXISTE`.
- Cada renglón busca el artículo en el catálogo del proveedor por código o descripción y lo crea si no está (`fn_compras_articulo`).
- No hay duplicados: si ya existe el mismo proveedor, tipo, letra, punto de venta y número (no anulado), responde 200 con el comprobante existente en lugar de 201.
- Se agregan al comprobante `cae`, `cae_vencimiento` y `origen` (`manual` o `api`).
- Percepciones: Factura Digital sólo puede mandar la suma de "otros impuestos", que entra como percepción `otro`. El desglose queda para más adelante.
- El PDF original no viaja en esta etapa: Factura Digital no lo expone a las integraciones.

### Factura Digital

- Charoli se agrega como preset de integración (`charoliIntegration()` + `charoliPurchaseConfig()`), al lado del de Xubio. El motor genérico ya resuelve reintentos, `Idempotency-Key` y estado de envío por documento.
- Se envían sólo facturas, notas de crédito y de débito (los remitos quedan afuera por `documentTypes`).
- Esas tareas se siguen en el repo de Factura Digital, con su propio documento.

## Contrato

Errores: `{ "error": { "codigo": "...", "mensaje": "..." } }` con 400 (JSON inválido), 401 (clave faltante o inválida), 404, 409, 422 (validación) y 500.

```jsonc
// POST /api/v1/comprobantes-compra
{
  "proveedor": { "cuit": "30712345678" },
  "tipo": "factura",                // factura | nota_credito | nota_debito
  "letra": "A",                     // A | B | C | M
  "punto_venta": 3,
  "numero": 1234,
  "fecha": "2026-11-05",
  "fecha_vencimiento": null,
  "cae": "76123456789012",
  "cae_vencimiento": "2026-11-15",
  "items": [
    {
      "codigo": "SPP8",              // opcional
      "descripcion": "SOGA PP diam 8MM",
      "unidad": "m",                 // opcional
      "cantidad": 100,
      "precio_unitario": 120.5,
      "descuento_pct": 0,            // opcional
      "alicuota_iva": 21             // 0 | 2.5 | 5 | 10.5 | 21 | 27
    }
  ],
  "percepciones": [{ "tipo": "otro", "descripcion": "Otros impuestos", "importe": 350 }]
}
// 201 (creado) o 200 (ya existía)
{ "id": "uuid", "estado": "borrador", "creado": true }
```

## Tareas

Entrega: un PR por tarea, cada uno sobre la rama de la anterior, como en compras.

- [x] T1 Esquema: tabla `api_clave` + RLS; `cae`, `cae_vencimiento` y `origen` en `comprobante_compra`; CUIT del proveedor normalizado y único. Rama `feat/api-compras-01-esquema`.
- [x] T2 Base de la API: cliente service-role, validación de clave, middleware que deja pasar `/api/v1`, respuestas de error JSON, secreto documentado. Rama `feat/api-compras-02-base`.
- [x] T3 Endpoints de proveedores (GET por CUIT, POST). Rama `feat/api-compras-03-proveedores`.
- [ ] T4 Endpoint de comprobantes de compra. Rama `feat/api-compras-04-comprobantes`.
- [ ] T5 Pantalla Configuración → Integraciones (crear, listar y revocar claves). Rama `feat/api-compras-05-pantalla-claves`.
- [ ] T6 Documentación de la API y deploy (migraciones, secreto, worker).

## Verificación

- `npm run typecheck`, `npm run lint`, `npm test` en cada tarea.
- Tests unitarios (Vitest) de los helpers puros: hash y formato de clave, validación del payload, normalización de CUIT.
- Prueba local de los endpoints con `curl` contra `npm run dev` y una clave creada desde la pantalla.

## Progreso

### T1 Esquema — hecho

- Commit `d844bf1` en `feat/api-compras-01-esquema`. Ruta: delegada (un writer para T1–T4; toca migraciones, helpers, acción del formulario y tipos).
- Migraciones `20261106000005_api_compras_esquema.sql` y `20261106000006_rls_api_compras.sql`.
- CUIT: lo normaliza un trigger (`trg_proveedor_normalizar_cuit`) en lugar de sólo un check, para que el seed (CUIT con guiones) y SQL directo sigan andando. Check de 11 dígitos NOT VALID e índice único `proveedor_cuit_uq`. Si al migrar quedan CUIT repetidos, la migración falla y los lista.
- service_role: la base local no le da permisos por defecto sobre las tablas y funciones del proyecto. Se otorgan explícitamente los que usa `guardar_comprobante_compra` (security invoker): cabecera, renglones, percepciones, catálogo del proveedor, remitos de compra (el `FOR UPDATE` pide UPDATE) y `fn_comprobante_compra_totales`. Probado con `set role service_role` contra la base local.
- Formulario de proveedores: normaliza el CUIT (`validarCuit`) y traduce el duplicado y el formato inválido.
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1207 pasan (RED observado antes: 9 fallaban). `supabase migration up --local` aplicó las dos migraciones. `supabase test db`: 1 falla, `supabase/tests/cuenta_corriente_proveedor_test.sql` test 15 espera el CUIT con guiones (`30-11111111-1`) y ahora se guarda `30111111111`; hay que actualizar ese valor esperado (archivo fuera del alcance de esta tarea).

### T2 Base de la API — hecho

- Commit `b6524a0` en `feat/api-compras-02-base`. Ruta: delegada.
- `src/lib/supabase/servicio.ts` (cliente service-role sin sesión; `ErrorConfiguracion` si falta el secreto), `src/lib/api/clave.ts` (generar, hash SHA-256 con Web Crypto, prefijo de 12 caracteres, Bearer), `src/lib/api/respuestas.ts` (errores del contrato y lectura del JSON), `src/lib/api/autenticar.ts`.
- Middleware: `/api/v1` pasa sin consultar la sesión.
- Códigos de error: `JSON_INVALIDO` (400), `NO_AUTORIZADO` (401), `NO_ENCONTRADO` (404), `PROVEEDOR_EXISTE` (409), `VALIDACION` y `PROVEEDOR_NO_EXISTE` (422), `ERROR_INTERNO` (500).
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1220 pasan (RED observado antes: los módulos no existían). Contra la base local, por PostgREST con la service-role key: buscar la clave por hash con `revocada_en is null` y anotar `ultimo_uso_en` responden bien.

### T3 Endpoints de proveedores — hecho

- Commit `7d98256` en `feat/api-compras-03-proveedores`. Ruta: delegada.
- `src/app/api/v1/proveedores/route.ts` y validación pura en `src/lib/api/proveedores.ts`. El CUIT de la consulta y del alta acepta guiones y se normaliza a 11 dígitos.
- POST: 201 `{ proveedor }`; 409 `PROVEEDOR_EXISTE` con `proveedor` si el CUIT ya existe (también si otro pedido lo crea a la vez: lo frena `proveedor_cuit_uq` y se vuelve a buscar); nombre repetido con otro CUIT → 422 `VALIDACION`.
- Checks: `npm run typecheck` ok; `npm run lint` ok; `npm test` 1227 pasan (RED observado antes: el módulo no existía). Prueba con `curl` contra `next dev` apuntado a la base local y una clave creada a mano: 401 sin clave, GET 200 con coincidencia, 422 CUIT corto, 409 duplicado, 201 alta, 400 JSON inválido, 422 nombre repetido; `/proveedores` sin sesión sigue redirigiendo a `/login`.

## Próximo paso

T4.

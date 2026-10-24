# Silfe Costos

Sistema de costeo de productos para la fabricación de elementos de cosecha de fruta.

Calcula el costo de cada producto a partir de tres cosas: las **materias primas** (con sus
precios por proveedor y sus conversiones de unidad), la **estructura del producto** (subgrupos
y componentes, hasta dos niveles) y la **mano de obra** (procesos por producto, medidos en
tiempo o con costo fijo).

## Qué resuelve

**Conversión de unidades por material.** Una materia prima se compra en una unidad y se consume
en otra: la soga se compra por kilo y se usa por metro. Cada material define su unidad de compra,
su unidad de uso y el `factor_conversion` que las vincula (1 kg = 20 m). El rendimiento depende
del material, así que no es una tabla de equivalencias global —eso existe aparte, para casos como
kg ↔ g— sino un dato de cada materia prima.

**Estructura en dos niveles.** Un producto terminado (por ejemplo un bolso recolector) se compone
de subgrupos (Lona, Juego de correas) y de materias primas sueltas (remaches, arandelas,
mosquetones). Cada subgrupo, a su vez, lleva sus propias materias primas. La base impide por
trigger que un subgrupo contenga otro subgrupo, para que la estructura no se vuelva recursiva.

**Mano de obra por proceso.** Cada producto y cada subgrupo tiene sus procesos (corte, costura,
remachado, armado, soldadura, pintura, embalaje). Un proceso se puede costear de dos maneras:

- **Tiempo × tarifa**: minutos estándar × costo horario de la categoría de operario, con cargas
  sociales incluidas.
- **Monto fijo**: un costo por unidad, para trabajo a destajo o tercerizado.

Cuando un proceso rinde para varias unidades a la vez (una tanda de pintura), el campo
`cantidad_por_ciclo` reparte el costo entre esas unidades.

**Mermas en dos lugares.** Cada material tiene su merma propia (recortes, puntas) y cada uso
dentro de una estructura puede tener una merma adicional específica de ese corte.

## Cómo se calcula

```
costo de la MP por unidad de uso = precio de compra ÷ factor de conversión ÷ (1 − merma del material)
costo de un componente           = cantidad ÷ (1 − merma de uso) × costo por unidad de uso
costo de un subgrupo             = Σ sus materias primas + Σ sus procesos
costo de un proceso (tiempo)     = minutos ÷ 60 × costo/hora × (1 + cargas sociales) ÷ unidades por ciclo
costo de un proceso (fijo)       = costo fijo ÷ unidades por ciclo
costo directo                    = materiales (propios + de subgrupos) + mano de obra (propia + de subgrupos)
costo total                      = costo directo × (1 + gastos generales)
precio sugerido                  = costo total × (1 + margen)
```

Todo el cálculo vive en vistas de Postgres, así que un cambio de precio o de tiempo se propaga
solo a todos los productos que dependen de él.

## Modelo de datos

| Tabla | Para qué |
| --- | --- |
| `unidad_medida` | Catálogo de unidades (kg, m, m², u) |
| `conversion_unidad` | Equivalencias genéricas dentro de una magnitud (kg ↔ g) |
| `proveedor` | Quién vende cada material |
| `materia_prima` | Material, con unidad de compra, unidad de uso, factor y merma |
| `precio_materia_prima` | Precios por proveedor, con vigencia y uno marcado como preferido |
| `producto` | Productos terminados y subgrupos (`tipo`) |
| `producto_componente` | Estructura: qué lleva cada producto o subgrupo |
| `proceso` | Catálogo de operaciones productivas |
| `categoria_mano_obra` | Costo horario por categoría de operario + cargas sociales |
| `producto_proceso` | Procesos aplicados a un producto, por tiempo o por monto fijo |
| `parametro_costeo` | Gastos generales y margen (fila única) |

Vistas de cálculo: `v_materia_prima_costo`, `v_proceso_costo`, `v_subgrupo_costo`,
`v_componente_detalle`, `v_producto_costo`, `v_explosion_materiales`, `v_uso_materia_prima`.

`v_explosion_materiales` lista todas las materias primas que consume un producto terminado
atravesando los subgrupos, y `v_uso_materia_prima` responde la pregunta inversa: qué productos
se ven afectados si cambia el precio de un material.

## Puesta en marcha

El proyecto de Supabase ya existe (`silfe-costos`, región `sa-east-1`), con las cuatro
migraciones aplicadas y los datos de ejemplo cargados: unidades, cuatro proveedores, doce
materias primas con precios, tres subgrupos y dos productos terminados ya costeados.

1. Configurar las variables de entorno:

   ```bash
   cp .env.example .env.local
   ```

   Los valores están en el dashboard de Supabase, en *Settings → API*.

2. Crear el primer usuario en *Authentication → Users* del dashboard. La app usa email y
   contraseña, y no tiene registro abierto: los usuarios se dan de alta desde ahí.

3. Levantar la app:

   ```bash
   npm install
   npm run dev
   ```

Para levantar el esquema en otra base (una copia de prueba, por ejemplo), aplicar las
migraciones en orden desde el SQL Editor del dashboard o con la CLI:

```bash
supabase link --project-ref <ref-del-proyecto>
supabase db push
```

Los datos de ejemplo están en `supabase/seed.sql` y se pueden volver a correr: son idempotentes
por código.

## ARCA (factura electrónica)

En **Configuración → ARCA** (`/configuracion/arca`) se cargan los datos del emisor (CUIT,
razón social, condición frente al IVA, ambiente activo y los datos que se imprimen en el
comprobante: domicilio comercial, ingresos brutos e inicio de actividades), los puntos de venta
y, por ambiente (homologación y producción), el certificado de ARCA y su clave privada.
"Probar conexión" consulta el estado de los servidores, hace login en WSAA y lee el último
comprobante autorizado en un punto de venta electrónico activo.

- Puntos de venta: número, nombre, si es electrónico (numera y pide CAE en ARCA) y si está
  activo (sólo los activos se ofrecen en los comprobantes nuevos). Uno con comprobantes no se
  borra: se desactiva.

- La clave privada y el ticket de acceso se guardan cifrados (AES-256-GCM) con el secreto
  `ARCA_CLAVE_CIFRADO`. La clave privada nunca vuelve al navegador.
- En local, el secreto va en `.dev.vars` (ver `.dev.vars.example`; se genera con
  `openssl rand -base64 32`). En producción: `npx wrangler secret put ARCA_CLAVE_CIFRADO`.
- Si el secreto se pierde o se cambia, las claves guardadas no se pueden recuperar: hay que
  volver a subir las credenciales.
- El ticket de WSAA dura 12 horas y se reutiliza. Si ARCA responde que ya entregó uno que la
  app no guardó, hay que esperar a que venza.

## Comprobantes de venta

En **Ventas → Comprobantes** (`/comprobantes`) se cargan facturas y notas de débito como
borradores y se autorizan en ARCA (CAE). El listado filtra por fechas, cliente, tipo, estado y
ambiente (por defecto, el activo); los borradores van arriba.

- Un borrador se guarda entero o no se guarda: la cabecera y los ítems van juntos en la función
  `guardar_borrador_comprobante`. Los importes y totales se recalculan en el servidor.
- "Autorizar en ARCA" guarda, muestra un resumen para confirmar y pide el CAE. Un comprobante
  que quedó "verificando" (respuesta perdida) se verifica con ARCA antes de volver a pedirlo.
- Un autorizado no se modifica ni se borra; se puede duplicar como borrador nuevo.

## Seguridad

Todas las tablas tienen RLS activo. El rol `anon` no tiene acceso a nada; el rol `authenticated`
puede leer y escribir. Es el modelo apropiado para una app interna donde todos los usuarios son
de la empresa. Si más adelante hacen falta permisos por rol (por ejemplo, que producción vea
costos pero no los modifique), el lugar para eso son las políticas en
`supabase/migrations/20260901000003_rls.sql`.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Auth)

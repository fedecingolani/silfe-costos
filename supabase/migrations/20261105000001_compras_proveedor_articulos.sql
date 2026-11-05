-- =====================================================================
-- Charoli Gestión - Compras: datos fiscales del proveedor y catálogo de
-- artículos del proveedor
--
-- El proveedor suma los datos que hacen falta para registrar sus
-- comprobantes y pagarle: condición frente al IVA, domicilio, CBU y alias.
--
-- Cada proveedor tiene un catálogo de artículos: su código, la descripción
-- tal como la factura (ej. "SOGA PP diam 8MM"), su unidad y el factor que
-- la lleva a la unidad de compra de la materia prima del sistema. Un
-- artículo se asocia a lo sumo a una materia prima; puede no tenerla
-- (fletes, servicios). Los renglones de facturas y remitos de compra
-- apuntan a estos artículos, y el futuro importador busca primero acá.
--
-- Unicidad por proveedor, sin distinguir mayúsculas ni espacios en los
-- bordes: el código cuando lo hay; la descripción cuando no hay código.
-- =====================================================================

-- ----- Datos fiscales del proveedor --------------------------------------

alter table proveedor
  add column condicion_iva text,
  add column domicilio     text,
  add column cbu           text,
  add column alias         text,
  add constraint proveedor_condicion_iva_check check (
    condicion_iva in ('Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final')
  ),
  add constraint proveedor_cbu_check check (cbu ~ '^[0-9]{22}$'),
  add constraint proveedor_alias_check check (alias ~ '^[A-Za-z0-9.-]{6,20}$');

comment on column proveedor.condicion_iva is 'Condición del proveedor frente al IVA';
comment on column proveedor.domicilio is 'Domicilio del proveedor';
comment on column proveedor.cbu is 'CBU de la cuenta del proveedor: 22 dígitos, sin espacios';
comment on column proveedor.alias is 'Alias del CBU: de 6 a 20 letras, números, puntos o guiones';

-- ----- Artículo del proveedor --------------------------------------------

create table proveedor_articulo (
  id                uuid primary key default gen_random_uuid(),
  proveedor_id      uuid not null references proveedor(id) on delete cascade,
  codigo            text,
  descripcion       text not null,
  unidad            text,
  factor_conversion numeric(20,8) not null default 1,
  materia_prima_id  uuid references materia_prima(id) on delete restrict,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint proveedor_articulo_descripcion_check check (btrim(descripcion) <> ''),
  constraint proveedor_articulo_factor_check check (factor_conversion > 0)
);

comment on table proveedor_articulo is
  'Catálogo de artículos de cada proveedor, tal como los factura, asociados a una materia prima del sistema';
comment on column proveedor_articulo.codigo is 'Código del artículo para el proveedor (opcional)';
comment on column proveedor_articulo.descripcion is 'Descripción del artículo tal como la factura el proveedor';
comment on column proveedor_articulo.unidad is 'Unidad en la que vende el proveedor (texto libre, ej. rollo, caja)';
comment on column proveedor_articulo.factor_conversion is
  'Cuántas unidades de compra de la materia prima equivale una unidad del proveedor. 1 = 1 a 1';
comment on column proveedor_articulo.materia_prima_id is
  'Materia prima del sistema a la que corresponde. Vacía en fletes y servicios';
comment on column proveedor_articulo.activo is 'Un artículo inactivo no se ofrece en la carga de comprobantes';

create unique index proveedor_articulo_codigo_uq
  on proveedor_articulo (proveedor_id, lower(btrim(codigo)))
  where codigo is not null;
create unique index proveedor_articulo_descripcion_uq
  on proveedor_articulo (proveedor_id, lower(btrim(descripcion)))
  where codigo is null;
create index proveedor_articulo_materia_prima_idx on proveedor_articulo (materia_prima_id);

create trigger trg_proveedor_articulo_actualizado before update on proveedor_articulo
  for each row execute function fn_set_actualizado_en();

-- =====================================================================
-- Tests de la actualización de precios al confirmar un comprobante de
-- compra: precio de la factura llevado a la unidad de compra y sin IVA,
-- precio vigente del proveedor, marca de cambio, confirmación con y sin
-- precios elegidos, filas nuevas de precio_materia_prima, precio
-- preferido, renglones inválidos o repetidos y atomicidad.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------

select has_function('public', 'precios_comprobante_compra', array['uuid'], 'Existe precios_comprobante_compra');
select has_function('public', 'confirmar_comprobante_compra', array['uuid', 'uuid[]'],
  'confirmar_comprobante_compra recibe los renglones cuyos precios se actualizan');
select hasnt_function('public', 'confirmar_comprobante_compra', array['uuid'],
  'No queda la versión de un solo argumento (sin ambigüedad)');
select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.precios_comprobante_compra(uuid)',
  'public.confirmar_comprobante_compra(uuid, uuid[])'
]) as f;
select ok(
  has_function_privilege('authenticated', f, 'execute'),
  format('authenticated ejecuta %s', f)
)
from unnest(array[
  'public.precios_comprobante_compra(uuid)',
  'public.confirmar_comprobante_compra(uuid, uuid[])'
]) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000002a1', 'test-ap-kg', 'Kilo de prueba precios', 'MASA');

-- MP1: el proveedor 1 tiene el preferido. MP2: el preferido es del
-- proveedor 2. MP3: sin precios.
insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000002b1', 'TEST-AP-MP-1', 'Malla de prueba',
   '00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000002a1'),
  ('00000000-0000-4000-8000-0000000002b2', 'TEST-AP-MP-2', 'Lona de prueba',
   '00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000002a1'),
  ('00000000-0000-4000-8000-0000000002b3', 'TEST-AP-MP-3', 'Correa de prueba',
   '00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000002a1');

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000002c1', 'Proveedor precios 1'),
  ('00000000-0000-4000-8000-0000000002c2', 'Proveedor precios 2');

-- d1: una caja del proveedor son 10 unidades de compra de MP1.
insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, materia_prima_id, factor_conversion) values
  ('00000000-0000-4000-8000-0000000002d1', '00000000-0000-4000-8000-0000000002c1', 'M-10', 'MALLA x10',
   '00000000-0000-4000-8000-0000000002b1', 10),
  ('00000000-0000-4000-8000-0000000002d2', '00000000-0000-4000-8000-0000000002c1', 'L-1', 'LONA',
   '00000000-0000-4000-8000-0000000002b2', 1),
  ('00000000-0000-4000-8000-0000000002d3', '00000000-0000-4000-8000-0000000002c1', 'M-1', 'MALLA suelta',
   '00000000-0000-4000-8000-0000000002b1', 1),
  ('00000000-0000-4000-8000-0000000002d4', '00000000-0000-4000-8000-0000000002c1', 'C-1', 'CORREA',
   '00000000-0000-4000-8000-0000000002b3', 1);

insert into precio_materia_prima (materia_prima_id, proveedor_id, precio, vigente_desde, es_preferido) values
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000002c1', 7, '2026-09-01', false),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000002c1', 9, '2026-10-01', true),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000002c1', 99, '2026-12-01', false),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000002c2', 8, '2026-10-15', false),
  ('00000000-0000-4000-8000-0000000002b2', '00000000-0000-4000-8000-0000000002c1', 4.5, '2026-10-01', false),
  ('00000000-0000-4000-8000-0000000002b2', '00000000-0000-4000-8000-0000000002c2', 5, '2026-10-01', true);

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table cc (nombre text primary key, id uuid);

create function pg_temp.cabecera(p_letra text, p_numero bigint)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'proveedor_id', '00000000-0000-4000-8000-0000000002c1', 'tipo', 'factura', 'letra', p_letra,
    'punto_venta', 3, 'numero', p_numero, 'fecha', '2026-11-01'
  );
$$;

-- Renglón del comprobante por orden.
create function pg_temp.item(p_nombre text, p_orden integer)
returns uuid
language sql
as $$
  select i.id from comprobante_compra_item i
  where i.comprobante_compra_id = (select id from cc where nombre = p_nombre) and i.orden = p_orden;
$$;

create function pg_temp.renglon(p_articulo text, p_cantidad numeric, p_precio numeric,
  p_descuento numeric default 0, p_alicuota numeric default 21)
returns jsonb
language sql
as $$
  select jsonb_build_object('proveedor_articulo_id', p_articulo, 'descripcion', 'Renglón ' || p_articulo,
    'cantidad', p_cantidad, 'precio_unitario', p_precio, 'descuento_pct', p_descuento, 'alicuota_iva', p_alicuota);
$$;

insert into cc values ('A', guardar_comprobante_compra(
  null,
  pg_temp.cabecera('A', 12345),
  jsonb_build_array(
    pg_temp.renglon('00000000-0000-4000-8000-0000000002d1', 2, 1000, 10),
    pg_temp.renglon('00000000-0000-4000-8000-0000000002d2', 4, 4.5),
    pg_temp.renglon('00000000-0000-4000-8000-0000000002d4', 3, 10),
    jsonb_build_object('descripcion', 'Flete', 'cantidad', 1, 'precio_unitario', 25),
    pg_temp.renglon('00000000-0000-4000-8000-0000000002d3', 1, 95)
  ),
  '[]'::jsonb
));

insert into cc values ('B', guardar_comprobante_compra(
  null,
  pg_temp.cabecera('B', 200),
  jsonb_build_array(pg_temp.renglon('00000000-0000-4000-8000-0000000002d2', 2, 121, 0, null)),
  '[]'::jsonb
));

insert into cc values ('sin_cambios', guardar_comprobante_compra(
  null,
  pg_temp.cabecera('A', 300),
  jsonb_build_array(pg_temp.renglon('00000000-0000-4000-8000-0000000002d4', 1, 50)),
  '[]'::jsonb
));

create temp table precios_antes as select count(*) as n from precio_materia_prima;

-- ---------------------------------------------------------------------
-- Vista previa (borrador)
-- ---------------------------------------------------------------------

select is(
  (select array_agg(orden order by orden) from precios_comprobante_compra((select id from cc where nombre = 'A'))),
  array[0, 1, 2, 4],
  'Una fila por renglón con materia prima; el renglón libre no aparece'
);
select is(
  (select precio_factura from precios_comprobante_compra((select id from cc where nombre = 'A')) where orden = 0),
  90.0000::numeric,
  'Precio de la factura: unitario con descuento dividido por el factor del artículo (1000 × 0,9 / 10)'
);
select is(
  (select array[precio_vigente::text, incluye_iva::text, cambio::text]
   from precios_comprobante_compra((select id from cc where nombre = 'A')) where orden = 0),
  array['9.0000', 'false', 'true'],
  'Precio vigente: el último del proveedor a la fecha del comprobante (ignora uno futuro y los de otro proveedor)'
);
select is(
  (select array[precio_factura::text, precio_vigente::text, cambio::text]
   from precios_comprobante_compra((select id from cc where nombre = 'A')) where orden = 1),
  array['4.5000', '4.5000', 'false'],
  'Mismo precio: sin cambio'
);
select is(
  (select array[coalesce(precio_vigente::text, 'null'), cambio::text]
   from precios_comprobante_compra((select id from cc where nombre = 'A')) where orden = 2),
  array['null', 'true'],
  'Sin precio del proveedor: vigente vacío y con cambio'
);
select is(
  (select array[materia_prima_codigo, unidad_compra, descripcion]
   from precios_comprobante_compra((select id from cc where nombre = 'A')) where orden = 0),
  array['TEST-AP-MP-1', 'test-ap-kg', 'Renglón 00000000-0000-4000-8000-0000000002d1'],
  'Trae la materia prima, su unidad de compra y la descripción del renglón'
);
select is(
  (select precio_factura from precios_comprobante_compra((select id from cc where nombre = 'B'))),
  121.0000::numeric,
  'Letra B: el precio incluye el IVA no computable y se toma tal cual'
);

-- ---------------------------------------------------------------------
-- Renglones inválidos: no confirma ni carga precios
-- ---------------------------------------------------------------------

select throws_ok(
  format('select confirmar_comprobante_compra(%L, array[%L]::uuid[])',
    (select id from cc where nombre = 'A'), '00000000-0000-4000-8000-00000000ffff'),
  'CP010', null, 'Un renglón inexistente no se acepta'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L, array[%L]::uuid[])',
    (select id from cc where nombre = 'A'), pg_temp.item('B', 0)),
  'CP010', null, 'Un renglón de otro comprobante no se acepta'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L, array[%L]::uuid[])',
    (select id from cc where nombre = 'A'), pg_temp.item('A', 3)),
  'CP010', null, 'Un renglón libre no actualiza precios'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L, array[%L, %L]::uuid[])',
    (select id from cc where nombre = 'A'), pg_temp.item('A', 0), pg_temp.item('A', 4)),
  'CP011', null, 'Dos renglones de la misma materia prima no se actualizan juntos'
);
select is(
  (select estado from comprobante_compra where id = (select id from cc where nombre = 'A')),
  'borrador',
  'Si falla la carga de precios, el comprobante sigue en borrador'
);
select is(
  (select count(*) from precio_materia_prima),
  (select n from precios_antes),
  'Si falla, no queda ningún precio cargado'
);

-- ---------------------------------------------------------------------
-- Confirmación con precios elegidos
-- ---------------------------------------------------------------------

select lives_ok(
  format('select confirmar_comprobante_compra(%L, array[%L, %L]::uuid[])',
    (select id from cc where nombre = 'A'), pg_temp.item('A', 0), pg_temp.item('A', 2)),
  'Confirma y actualiza los precios elegidos'
);
select is(
  (select estado from comprobante_compra where id = (select id from cc where nombre = 'A')),
  'confirmado',
  'El comprobante queda confirmado'
);
select is(
  (select count(*) from precio_materia_prima),
  (select n + 2 from precios_antes),
  'Una fila de precio por renglón elegido'
);
select is(
  (select array[precio::text, incluye_iva::text, vigente_desde::text, es_preferido::text, observaciones]
   from precio_materia_prima
   where materia_prima_id = '00000000-0000-4000-8000-0000000002b1'
     and proveedor_id = '00000000-0000-4000-8000-0000000002c1' and vigente_desde = '2026-11-01'),
  array['90.0000', 'false', '2026-11-01', 'true', 'Compra FC A 00003-00012345'],
  'Precio nuevo: por unidad de compra, sin IVA, vigente desde la fecha del comprobante y preferido'
);
select is(
  (select count(*) from precio_materia_prima
   where materia_prima_id = '00000000-0000-4000-8000-0000000002b1' and es_preferido),
  1::bigint,
  'El preferido anterior del proveedor deja de serlo: queda uno solo'
);
select is(
  (select precio_compra from v_materia_prima_costo where id = '00000000-0000-4000-8000-0000000002b1'),
  90.0000::numeric,
  'El costeo toma el precio nuevo, como si se hubiera cargado a mano'
);
select is(
  (select array[precio::text, es_preferido::text] from precio_materia_prima
   where materia_prima_id = '00000000-0000-4000-8000-0000000002b3'),
  array['10.0000', 'true'],
  'Una materia prima sin preferido toma el precio nuevo como preferido'
);
select is(
  (select count(*) from precio_materia_prima where materia_prima_id = '00000000-0000-4000-8000-0000000002b2'),
  2::bigint,
  'Un renglón no elegido no carga precio'
);

-- ---------------------------------------------------------------------
-- Preferido de otro proveedor y confirmación sin precios
-- ---------------------------------------------------------------------

select lives_ok(
  format('select confirmar_comprobante_compra(%L, array[%L]::uuid[])',
    (select id from cc where nombre = 'B'), pg_temp.item('B', 0)),
  'Confirma la letra B actualizando el precio'
);
select is(
  (select array_agg(array[proveedor_id::text, precio::text, es_preferido::text] order by vigente_desde, precio)
   from precio_materia_prima where materia_prima_id = '00000000-0000-4000-8000-0000000002b2'),
  array[
    array['00000000-0000-4000-8000-0000000002c1', '4.5000', 'false'],
    array['00000000-0000-4000-8000-0000000002c2', '5.0000', 'true'],
    array['00000000-0000-4000-8000-0000000002c1', '121.0000', 'false']
  ],
  'Si el preferido es de otro proveedor, lo conserva y el precio nuevo no es preferido'
);

select lives_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'sin_cambios')),
  'Sin renglones elegidos confirma como antes'
);
select is(
  (select count(*) from precio_materia_prima where materia_prima_id = '00000000-0000-4000-8000-0000000002b3'),
  1::bigint,
  'Sin renglones elegidos no carga precios'
);

select * from finish();
rollback;

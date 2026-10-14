-- =====================================================================
-- Tests de v_lista_precio_base y del tope de producto.alicuota_iva.
-- Corre con `supabase test db`. Todo pasa dentro de una transacción que
-- se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- ---------------------------------------------------------------------
-- Fixtures: se desactivan los productos del seed para que la vista sólo
-- muestre los de este test, y se dejan gastos y margen en 0 para que el
-- precio sugerido sea exactamente el costo.
-- ---------------------------------------------------------------------

update producto set activo = false;
update parametro_costeo set gastos_generales_pct = 0, margen_pct = 0 where id;

insert into producto (codigo, nombre, tipo, unidad_id, unidad_venta_id, factor_venta, alicuota_iva, activo)
select x.codigo, x.nombre, x.tipo::tipo_producto,
       (select id from unidad_medida where codigo = x.unidad),
       (select id from unidad_medida where codigo = x.unidad_venta),
       x.factor, x.iva, x.activo
from (values
  ('ZT-001', 'Terminado uno',     'TERMINADO', 'u', 'doc', 12, 10.5, true),
  ('ZT-002', 'Terminado dos',     'TERMINADO', 'u', null,   1, 21,   true),
  ('ZT-003', 'Terminado inactivo','TERMINADO', 'u', null,   1, 21,   false),
  ('ZS-001', 'Subgrupo compartido','SUBGRUPO', 'u', null,   1, 21,   true),
  ('ZS-002', 'Subgrupo propio',   'SUBGRUPO',  'u', null,   1, 21,   true),
  ('ZS-003', 'Subgrupo sin uso',  'SUBGRUPO',  null, null,  1, 21,   true),
  ('ZS-004', 'Subgrupo inactivo', 'SUBGRUPO',  'u', null,   1, 21,   false),
  ('ZS-005', 'Subgrupo inactivo usado','SUBGRUPO','u', null, 1, 21,  false)
) as x(codigo, nombre, tipo, unidad, unidad_venta, factor, iva, activo);

-- ZT-001 usa ZS-002, ZS-001 (cargados al revés del código) y uno inactivo.
-- ZT-002 también usa ZS-001. ZS-003 sólo lo usa un terminado inactivo.
insert into producto_componente (producto_id, tipo, subgrupo_id, cantidad, orden)
select pr.id, 'SUBGRUPO', sg.id, 1, c.orden
from (values
  ('ZT-001', 'ZS-002', 1),
  ('ZT-001', 'ZS-001', 2),
  ('ZT-001', 'ZS-005', 3),
  ('ZT-002', 'ZS-001', 1),
  ('ZT-003', 'ZS-003', 1)
) as c(producto, subgrupo, orden)
join producto pr on pr.codigo = c.producto
join producto sg on sg.codigo = c.subgrupo;

-- Costos fijos por unidad: ZT-001 cuesta 1234.5 por unidad (x 12 la docena),
-- ZT-002 cuesta exactamente 500.
insert into proceso (codigo, nombre) values ('ZPR-01', 'Proceso de test');

insert into producto_proceso (producto_id, proceso_id, modo, costo_fijo)
select pr.id, pc.id, 'FIJO', x.costo
from (values ('ZT-001', 1234.5), ('ZT-002', 500.0)) as x(producto, costo)
join producto pr on pr.codigo = x.producto
cross join proceso pc
where pc.codigo = 'ZPR-01';

-- ---------------------------------------------------------------------
-- Orden y agrupación
-- ---------------------------------------------------------------------

select results_eq(
  $$
    select b.orden::int, b.codigo, b.es_repuesto, padre.codigo
    from v_lista_precio_base b
    left join producto padre on padre.id = b.padre_producto_id
    order by b.orden
  $$,
  $$
    values
      (1, 'ZT-001', false, null::text),
      (2, 'ZS-001', true,  'ZT-001'),
      (3, 'ZS-002', true,  'ZT-001'),
      (4, 'ZT-002', false, null),
      (5, 'ZS-001', true,  'ZT-002'),
      (6, 'ZS-003', true,  null)
  $$,
  'Terminados por código, sus subgrupos debajo como repuesto, los sin uso al final'
);

select is(
  (select count(*) from v_lista_precio_base where codigo in ('ZT-003', 'ZS-004', 'ZS-005')),
  0::bigint,
  'Los productos inactivos no aparecen'
);

select is(
  (select count(*) from v_lista_precio_base where codigo = 'ZS-001'),
  2::bigint,
  'Un subgrupo usado por dos terminados aparece debajo de cada uno'
);

select is(
  (select producto_id from v_lista_precio_base where codigo = 'ZT-001'),
  (select id from producto where codigo = 'ZT-001'),
  'Cada fila lleva el producto_id de su producto'
);

-- ---------------------------------------------------------------------
-- Datos de la fila: descripción, presentación, IVA y precios
-- ---------------------------------------------------------------------

select is(
  (select descripcion from v_lista_precio_base where codigo = 'ZT-001'),
  'Terminado uno',
  'La descripción es el nombre del producto'
);

select is(
  (select presentacion from v_lista_precio_base where codigo = 'ZT-001'),
  'Docena',
  'La presentación es el nombre de la unidad de venta'
);

select is(
  (select presentacion from v_lista_precio_base where codigo = 'ZT-002'),
  (select nombre from unidad_medida where codigo = 'u'),
  'Sin unidad de venta, la presentación es la unidad de costeo'
);

select is(
  (select presentacion from v_lista_precio_base where codigo = 'ZS-003'),
  null,
  'Un producto sin unidad aparece igual, sin presentación'
);

select is(
  (select alicuota_iva from v_lista_precio_base where codigo = 'ZT-001'),
  10.5::numeric,
  'Lleva la alícuota de IVA del producto'
);

select is(
  (select precio_sugerido from v_lista_precio_base where codigo = 'ZT-001'),
  14814::numeric,
  'El precio sugerido es el de la presentación (1234.5 x 12)'
);

select is(
  (select precio_sugerido from v_lista_precio_base where codigo = 'ZT-001'),
  (select precio_presentacion from v_producto_costo where codigo = 'ZT-001'),
  'El precio sugerido coincide con precio_presentacion de v_producto_costo'
);

select is(
  (select precio_redondeado from v_lista_precio_base where codigo = 'ZT-001'),
  14900::numeric,
  'El precio redondeado sube a la centena siguiente'
);

select is(
  (select precio_redondeado from v_lista_precio_base where codigo = 'ZT-002'),
  500::numeric,
  'Un precio que ya es centena exacta no cambia al redondear'
);

select is(
  (select precio_redondeado from v_lista_precio_base where codigo = 'ZS-002'),
  0::numeric,
  'Un producto sin costos queda en 0'
);

-- ---------------------------------------------------------------------
-- Redondeo: se redondea a centavos antes de subir a la centena, para que
-- los decimales residuales de un cálculo no salten a la centena siguiente
-- ---------------------------------------------------------------------

select has_function(
  'public', 'redondear_precio_lista', array['numeric'],
  'Existe redondear_precio_lista(numeric)'
);

select is(
  redondear_precio_lista(24500.0000001),
  24500::numeric,
  'Un decimal residual por debajo del centavo no sube a la centena siguiente'
);

select is(
  redondear_precio_lista(24500.01),
  24600::numeric,
  'Un centavo por encima de la centena sube a la centena siguiente'
);

select is(
  redondear_precio_lista(null),
  null::numeric,
  'Sin precio sugerido no hay precio redondeado'
);

select is(
  (select count(*) from v_lista_precio_base
   where precio_redondeado is distinct from redondear_precio_lista(precio_sugerido)),
  0::bigint,
  'La vista redondea con redondear_precio_lista'
);

select ok(
  has_function_privilege('authenticated', 'public.redondear_precio_lista(numeric)', 'execute')
  and not has_function_privilege('anon', 'public.redondear_precio_lista(numeric)', 'execute'),
  'redondear_precio_lista la ejecuta authenticated y no anon'
);

-- ---------------------------------------------------------------------
-- Vista de sólo lectura
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.v_lista_precio_base', 'insert, update, delete'),
  'La vista es de sólo lectura para authenticated'
);

-- ---------------------------------------------------------------------
-- Tope de la alícuota de IVA del producto
-- ---------------------------------------------------------------------

select throws_ok(
  $$ update producto set alicuota_iva = 100.01 where codigo = 'ZT-001' $$,
  '23514', null,
  'producto.alicuota_iva rechaza valores mayores a 100'
);

select lives_ok(
  $$ update producto set alicuota_iva = 100 where codigo = 'ZT-001' $$,
  'producto.alicuota_iva acepta 100'
);

select * from finish();
rollback;

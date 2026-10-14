-- =====================================================================
-- Tests de v_lista_precio_base.costos_incompletos: marca los productos
-- cuyo precio sugerido no es confiable porque falta el precio de alguna
-- materia prima (propia o de un subgrupo) o porque el costo total es 0.
-- Corre con `supabase test db`. Todo pasa dentro de una transacción que
-- se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- ---------------------------------------------------------------------
-- Fixtures: se desactivan los productos del seed para que la vista sólo
-- muestre los de este test.
-- ---------------------------------------------------------------------

update producto set activo = false;
update parametro_costeo set gastos_generales_pct = 0, margen_pct = 0 where id;

-- Una materia prima con precio vigente, una sin precio y otra con un
-- precio que todavía no entró en vigencia.
insert into materia_prima (codigo, nombre, unidad_compra_id, unidad_uso_id)
select x.codigo, x.nombre,
       (select id from unidad_medida where codigo = 'u'),
       (select id from unidad_medida where codigo = 'u')
from (values
  ('ZMP-OK',     'Materia prima con precio'),
  ('ZMP-SIN',    'Materia prima sin precio'),
  ('ZMP-FUTURO', 'Materia prima con precio futuro')
) as x(codigo, nombre);

insert into precio_materia_prima (materia_prima_id, precio, vigente_desde)
select mp.id, x.precio, x.desde
from (values
  ('ZMP-OK',     100.0, current_date - 1),
  ('ZMP-FUTURO', 100.0, current_date + 30)
) as x(codigo, precio, desde)
join materia_prima mp on mp.codigo = x.codigo;

insert into producto (codigo, nombre, tipo, unidad_id, activo)
select x.codigo, x.nombre, x.tipo::tipo_producto,
       (select id from unidad_medida where codigo = 'u'), true
from (values
  ('ZT-A', 'Terminado con materia prima sin precio', 'TERMINADO'),
  ('ZT-B', 'Terminado con subgrupo incompleto',      'TERMINADO'),
  ('ZT-C', 'Terminado sin componentes',              'TERMINADO'),
  ('ZT-D', 'Terminado completo',                     'TERMINADO'),
  ('ZT-E', 'Terminado con precio futuro',            'TERMINADO'),
  ('ZS-B', 'Subgrupo con materia prima sin precio',  'SUBGRUPO'),
  ('ZS-D', 'Subgrupo completo',                      'SUBGRUPO')
) as x(codigo, nombre, tipo);

insert into producto_componente (producto_id, tipo, materia_prima_id, cantidad, orden)
select pr.id, 'MATERIA_PRIMA', mp.id, 1, c.orden
from (values
  ('ZT-A', 'ZMP-OK',     1),
  ('ZT-A', 'ZMP-SIN',    2),
  ('ZS-B', 'ZMP-OK',     1),
  ('ZS-B', 'ZMP-SIN',    2),
  ('ZT-D', 'ZMP-OK',     1),
  ('ZS-D', 'ZMP-OK',     1),
  ('ZT-E', 'ZMP-OK',     1),
  ('ZT-E', 'ZMP-FUTURO', 2)
) as c(producto, mp, orden)
join producto pr      on pr.codigo = c.producto
join materia_prima mp on mp.codigo = c.mp;

insert into producto_componente (producto_id, tipo, subgrupo_id, cantidad, orden)
select pr.id, 'SUBGRUPO', sg.id, 1, c.orden
from (values
  ('ZT-B', 'ZS-B', 1),
  ('ZT-D', 'ZS-D', 2)
) as c(producto, subgrupo, orden)
join producto pr on pr.codigo = c.producto
join producto sg on sg.codigo = c.subgrupo;

-- ---------------------------------------------------------------------
-- Columna
-- ---------------------------------------------------------------------

select has_column(
  'public', 'v_lista_precio_base', 'costos_incompletos',
  'v_lista_precio_base tiene la columna costos_incompletos'
);

-- ---------------------------------------------------------------------
-- Casos marcados
-- ---------------------------------------------------------------------

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZT-A'),
  true,
  'Una materia prima propia sin precio marca el producto'
);

select ok(
  (select precio_sugerido from v_lista_precio_base where codigo = 'ZT-A') > 0,
  'El caso de materia prima sin precio tiene precio sugerido mayor a 0 (no lo marca el costo 0)'
);

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZT-B'),
  true,
  'Una materia prima sin precio dentro de un subgrupo marca al terminado'
);

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZS-B'),
  true,
  'El subgrupo con una materia prima sin precio también queda marcado'
);

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZT-C'),
  true,
  'Un producto con costo total 0 queda marcado'
);

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZT-E'),
  true,
  'Una materia prima con un precio que todavía no está vigente marca el producto'
);

-- ---------------------------------------------------------------------
-- Casos completos
-- ---------------------------------------------------------------------

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZT-D'),
  false,
  'Un producto con todos los precios y costo mayor a 0 no queda marcado'
);

select is(
  (select costos_incompletos from v_lista_precio_base where codigo = 'ZS-D'),
  false,
  'Un subgrupo con todos los precios no queda marcado'
);

select * from finish();
rollback;

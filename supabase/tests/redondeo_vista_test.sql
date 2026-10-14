-- =====================================================================
-- Tests del redondeo de v_lista_precio_base con valores concretos:
-- gastos generales y margen con decimales producen precios sugeridos con
-- centavos o con decimales residuales, y la vista los redondea a la
-- centena siguiente después de redondearlos a centavos.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

update producto set activo = false;

insert into producto (codigo, nombre, tipo, unidad_id)
select x.codigo, x.nombre, 'TERMINADO', (select id from unidad_medida where codigo = 'u')
from (values
  ('ZR-001', 'Precio con centavos'),
  ('ZR-002', 'Precio con decimal residual')
) as x(codigo, nombre);

insert into proceso (codigo, nombre) values ('ZPR-R1', 'Proceso de redondeo');

-- ZR-001: 1000 por unidad. ZR-002: 200 cada 3 unidades (66,666...).
insert into producto_proceso (producto_id, proceso_id, modo, costo_fijo, cantidad_por_ciclo)
select pr.id, pc.id, 'FIJO', x.costo, x.ciclo
from (values ('ZR-001', 1000.0, 1.0), ('ZR-002', 200.0, 3.0)) as x(producto, costo, ciclo)
join producto pr on pr.codigo = x.producto
cross join proceso pc
where pc.codigo = 'ZPR-R1';

-- ---------------------------------------------------------------------
-- Gastos 10 % y margen 33,33 %: 1000 x 1,10 x 1,3333 = 1466,63
-- ---------------------------------------------------------------------

update parametro_costeo set gastos_generales_pct = 10, margen_pct = 33.33 where id;

select is(
  (select round(precio_sugerido, 2) from v_lista_precio_base where codigo = 'ZR-001'),
  1466.63::numeric,
  'El precio sugerido tiene centavos (1000 x 1,10 x 1,3333)'
);

select is(
  (select precio_redondeado from v_lista_precio_base where codigo = 'ZR-001'),
  1500::numeric,
  'Un precio con centavos sube a la centena siguiente (1466,63 -> 1500)'
);

-- ---------------------------------------------------------------------
-- Gastos 50 % y margen 0: 200 / 3 x 1,5 = 100,00000000000000005
-- ---------------------------------------------------------------------

update parametro_costeo set gastos_generales_pct = 50, margen_pct = 0 where id;

select ok(
  (select precio_sugerido > 100 and round(precio_sugerido, 2) = 100
     from v_lista_precio_base where codigo = 'ZR-002'),
  'El precio sugerido apenas supera 100 por un decimal residual'
);

select is(
  (select precio_redondeado from v_lista_precio_base where codigo = 'ZR-002'),
  100::numeric,
  'El decimal residual no sube el precio a la centena siguiente (queda en 100, no en 200)'
);

select * from finish();
rollback;

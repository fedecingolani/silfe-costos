-- =====================================================================
-- Tests de los créditos de compras: saldo a favor de las órdenes de pago
-- aplicado a las facturas y notas de débito que se confirman después,
-- notas de crédito imputadas a su factura asociada (y a mano a otro
-- débito), y la anulación de comprobantes con imputaciones.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000008c1', 'Proveedor créditos 1'),
  ('00000000-0000-4000-8000-0000000008c2', 'Proveedor créditos 2');

-- Caja de la que sale el efectivo de las órdenes (nombre único: la base
-- local puede tener cuentas cargadas a mano).
insert into cuenta_fondos (id, tipo, nombre)
values ('00000000-0000-4000-8000-0000000008f1', 'caja', 'Caja créditos ' || gen_random_uuid());
-- Saldo inicial: una caja no queda en negativo
-- (20261112000005_finanzas_caja_sin_negativo.sql).
insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
values ('00000000-0000-4000-8000-0000000008f1', '2000-01-01', 'ingreso', 10000000, 'Saldo inicial');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table cr (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text)
returns uuid
language sql
as $$ select id from cr where nombre = p_nombre; $$;

-- Comprobante letra C con un renglón libre por el importe (total = importe).
create function pg_temp.comprobante(
  p_nombre text, p_tipo text, p_numero bigint, p_importe numeric,
  p_asociado uuid default null,
  p_proveedor uuid default '00000000-0000-4000-8000-0000000008c1', p_confirmar boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_comprobante_compra(null,
    jsonb_build_object('proveedor_id', p_proveedor, 'tipo', p_tipo, 'letra', 'C',
      'punto_venta', 8, 'numero', p_numero, 'fecha', '2026-11-01', 'comprobante_asociado_id', p_asociado),
    jsonb_build_array(jsonb_build_object('descripcion', 'Servicio', 'cantidad', 1, 'precio_unitario', p_importe)),
    '[]'::jsonb);
  if p_confirmar then
    perform confirmar_comprobante_compra(v_id);
  end if;
  insert into cr values (p_nombre, v_id);
  return v_id;
end;
$$;

create function pg_temp.saldo(p_nombre text)
returns numeric
language sql
as $$ select saldo from v_comprobante_compra_saldo where comprobante_compra_id = pg_temp.id(p_nombre); $$;

create function pg_temp.disponible(p_nombre text)
returns numeric
language sql
as $$
  select coalesce(sum(disponible), 0) from v_proveedor_saldo_a_favor
  where pg_temp.id(p_nombre) in (orden_pago_id, nota_credito_id);
$$;

-- Una orden de pago confirmada en efectivo que imputa a F1 lo que se pida.
create function pg_temp.pagar(p_nombre text, p_efectivo numeric, p_factura text, p_importe numeric, p_confirmar boolean default true)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_orden_pago(null,
    jsonb_build_object('proveedor_id', '00000000-0000-4000-8000-0000000008c1', 'fecha', '2026-11-02'),
    jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', p_efectivo,
      'cuenta_id', '00000000-0000-4000-8000-0000000008f1')),
    jsonb_build_array(jsonb_build_object('comprobante_compra_id', pg_temp.id(p_factura), 'importe', p_importe)));
  if p_confirmar then
    perform confirmar_orden_pago(v_id);
  end if;
  insert into cr values (p_nombre, v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Saldo a favor de una orden de pago
-- ---------------------------------------------------------------------

do $$ begin perform pg_temp.comprobante('F1', 'factura', 1, 1000); end $$;
do $$ begin perform pg_temp.pagar('OP_A', 1500, 'F1', 1000); end $$;

select is(pg_temp.disponible('OP_A'), 500.00::numeric, 'La orden que paga de más deja 500 a favor');

do $$ begin perform pg_temp.comprobante('F2', 'factura', 2, 800); end $$;

select is(pg_temp.saldo('F2'), 300.00::numeric, 'Al confirmar una factura se le aplica el saldo a favor');
select is(
  (select orden_pago_id || '|' || importe || '|' || automatica from imputacion_compra where comprobante_compra_id = pg_temp.id('F2')),
  pg_temp.id('OP_A') || '|500.00|true',
  'Como una imputación automática de la orden'
);
select is(pg_temp.disponible('OP_A'), 0::numeric, 'La orden ya no tiene saldo a favor');

-- ---------------------------------------------------------------------
-- Notas de crédito
-- ---------------------------------------------------------------------

do $$ begin perform pg_temp.comprobante('NC1', 'nota_credito', 3, 200, pg_temp.id('F2')); end $$;

select is(pg_temp.saldo('F2'), 100.00::numeric, 'Una nota de crédito se imputa a su factura asociada al confirmarse');
select is(pg_temp.disponible('NC1'), 0::numeric, 'Lo imputado no queda a favor');

do $$ begin perform pg_temp.comprobante('NC_grande', 'nota_credito', 4, 400, pg_temp.id('F2')); end $$;

select is(pg_temp.saldo('F2'), 0::numeric, 'La nota cubre hasta el saldo de su factura');
select is(pg_temp.disponible('NC_grande'), 300.00::numeric, 'Y el resto queda a favor');

do $$ begin perform pg_temp.comprobante('ND1', 'nota_debito', 5, 100); end $$;

select is(pg_temp.saldo('ND1'), 0::numeric, 'Una nota de débito también consume el saldo a favor');
select is(pg_temp.disponible('NC_grande'), 200.00::numeric, 'Que se descuenta de la nota de crédito');

do $$ begin perform pg_temp.comprobante('F3', 'factura', 6, 500); end $$;
select is(pg_temp.saldo('F3'), 300.00::numeric, 'Se aplica lo que queda a favor y el resto queda pendiente');

do $$ begin perform pg_temp.comprobante('NC_suelta', 'nota_credito', 7, 100); end $$;
select is(pg_temp.disponible('NC_suelta'), 100.00::numeric, 'Una nota de crédito sin factura asociada queda entera a favor');

select lives_ok(
  format('insert into imputacion_compra (nota_credito_id, comprobante_compra_id, importe) values (%L, %L, 60)',
    pg_temp.id('NC_suelta'), pg_temp.id('F3')),
  'Una nota de crédito se imputa a mano a otro débito del proveedor'
);
select is(pg_temp.saldo('F3'), 240.00::numeric, 'Y baja su saldo');
select throws_ok(
  format('insert into imputacion_compra (nota_credito_id, comprobante_compra_id, importe) values (%L, %L, 10)',
    pg_temp.id('NC_suelta'), pg_temp.id('F3')),
  '23505', null, 'Una sola imputación por nota y comprobante'
);
select throws_ok(
  format('delete from imputacion_compra where nota_credito_id = %L', pg_temp.id('NC_suelta')),
  'OP001', null, 'Las imputaciones de una nota de crédito no se borran'
);

do $$ begin perform pg_temp.comprobante('F_otro', 'factura', 8, 100, null, '00000000-0000-4000-8000-0000000008c2'); end $$;
select throws_ok(
  format('insert into imputacion_compra (nota_credito_id, comprobante_compra_id, importe) values (%L, %L, 10)',
    pg_temp.id('NC_suelta'), pg_temp.id('F_otro')),
  'OP008', null, 'Una nota de crédito no se imputa a otro proveedor'
);
do $$ begin perform pg_temp.comprobante('NC_borr', 'nota_credito', 9, 100, null, '00000000-0000-4000-8000-0000000008c1', false); end $$;
select throws_ok(
  format('insert into imputacion_compra (nota_credito_id, comprobante_compra_id, importe) values (%L, %L, 10)',
    pg_temp.id('NC_borr'), pg_temp.id('F3')),
  'OP014', null, 'Una nota de crédito en borrador no imputa'
);
select throws_ok(
  format('insert into imputacion_compra (nota_credito_id, comprobante_compra_id, importe) values (%L, %L, 10)',
    pg_temp.id('NC_suelta'), pg_temp.id('F1')),
  'OP006', null, 'Ni más que el saldo pendiente del débito'
);

-- ---------------------------------------------------------------------
-- Anular comprobantes con imputaciones
-- ---------------------------------------------------------------------

select throws_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('F1')),
  'OP016', null, 'Una factura con pagos imputados no se anula'
);
select throws_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('ND1')),
  'OP016', null, 'Una nota de débito con créditos imputados no se anula'
);
select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('NC_suelta')),
  'Una nota de crédito con imputaciones se anula'
);
select is(pg_temp.saldo('F3'), 300.00::numeric, 'Y sus imputaciones se deshacen');

select lives_ok(
  format('select anular_orden_pago(%L, %L)', pg_temp.id('OP_A'), 'Pago duplicado'),
  'Al anular la orden'
);
select is(
  (select array_agg(pg_temp.saldo(n) order by n) from unnest(array['F1', 'F2']) n),
  array[1000.00, 500.00]::numeric[],
  'Se deshacen también las aplicaciones automáticas de su saldo a favor'
);
select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('F1')),
  'Una factura sin imputaciones vigentes se anula'
);
select throws_ok(
  format('select guardar_orden_pago(null, %L, %L, %L)',
    jsonb_build_object('proveedor_id', '00000000-0000-4000-8000-0000000008c1'),
    jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', 10)),
    jsonb_build_array(jsonb_build_object('comprobante_compra_id', pg_temp.id('F1'), 'importe', 10))),
  'OP007', null, 'Una factura anulada no recibe imputaciones'
);

-- Un borrador que imputa no impide anular; después no se confirma.
do $$ begin perform pg_temp.comprobante('F4', 'factura', 10, 100); end $$;
do $$ begin perform pg_temp.pagar('OP_B', 100, 'F4', 100, false); end $$;
select lives_ok(
  format('select anular_comprobante_compra(%L)', pg_temp.id('F4')),
  'Las imputaciones de una orden en borrador no impiden anular'
);
select throws_ok(
  format('select confirmar_orden_pago(%L)', pg_temp.id('OP_B')),
  'OP007', null, 'Y la orden ya no se confirma con esa factura'
);

select * from finish();
rollback;

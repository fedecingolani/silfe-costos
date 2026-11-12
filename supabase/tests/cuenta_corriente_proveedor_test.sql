-- =====================================================================
-- Tests de la cuenta corriente de proveedores
-- (20261106000004_cuenta_corriente_proveedor.sql): movimientos con saldo
-- acumulado, saldo por proveedor, resumen para el listado y aplicación a
-- mano del saldo a favor (órdenes de pago y notas de crédito) a un débito
-- pendiente.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into proveedor (id, nombre, cuit) values
  ('00000000-0000-4000-8000-0000000009c1', 'Proveedor cuenta 1', '30-11111111-1'),
  ('00000000-0000-4000-8000-0000000009c2', 'Proveedor cuenta 2', null),
  ('00000000-0000-4000-8000-0000000009c3', 'Proveedor cuenta 3 sin movimientos', null);

-- Caja de la que sale el efectivo de las órdenes (nombre único: la base
-- local puede tener cuentas cargadas a mano).
insert into cuenta_fondos (id, tipo, nombre)
values ('00000000-0000-4000-8000-0000000009f1', 'caja', 'Caja cuenta corriente ' || gen_random_uuid());
-- Saldo inicial: una caja no queda en negativo
-- (20261112000005_finanzas_caja_sin_negativo.sql).
insert into ajuste_fondos (cuenta_id, fecha, tipo, importe, concepto)
values ('00000000-0000-4000-8000-0000000009f1', '2000-01-01', 'ingreso', 10000000, 'Saldo inicial');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table cc (nombre text primary key, id uuid);

create function pg_temp.id(p_nombre text)
returns uuid
language sql
as $$ select id from cc where nombre = p_nombre; $$;

-- Comprobante letra C con un renglón libre por el importe (total = importe).
create function pg_temp.comprobante(
  p_nombre text, p_tipo text, p_numero bigint, p_importe numeric, p_fecha date,
  p_proveedor uuid default '00000000-0000-4000-8000-0000000009c1', p_confirmar boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_comprobante_compra(null,
    jsonb_build_object('proveedor_id', p_proveedor, 'tipo', p_tipo, 'letra', 'C',
      'punto_venta', 9, 'numero', p_numero, 'fecha', p_fecha),
    jsonb_build_array(jsonb_build_object('descripcion', 'Servicio', 'cantidad', 1, 'precio_unitario', p_importe)),
    '[]'::jsonb);
  if p_confirmar then
    perform confirmar_comprobante_compra(v_id);
  end if;
  insert into cc values (p_nombre, v_id);
  return v_id;
end;
$$;

-- Orden de pago en efectivo del proveedor 1 que imputa a una factura.
create function pg_temp.pagar(
  p_nombre text, p_efectivo numeric, p_factura text, p_importe numeric, p_fecha date, p_confirmar boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_orden_pago(null,
    jsonb_build_object('proveedor_id', '00000000-0000-4000-8000-0000000009c1', 'fecha', p_fecha),
    jsonb_build_array(jsonb_build_object('tipo', 'efectivo', 'importe', p_efectivo,
      'cuenta_id', '00000000-0000-4000-8000-0000000009f1')),
    jsonb_build_array(jsonb_build_object('comprobante_compra_id', pg_temp.id(p_factura), 'importe', p_importe)));
  if p_confirmar then
    perform confirmar_orden_pago(v_id);
  end if;
  insert into cc values (p_nombre, v_id);
  return v_id;
end;
$$;

create function pg_temp.saldo(p_nombre text)
returns numeric
language sql
as $$ select saldo from v_comprobante_compra_saldo where comprobante_compra_id = pg_temp.id(p_nombre); $$;

create function pg_temp.a_favor(p_proveedor uuid default '00000000-0000-4000-8000-0000000009c1')
returns numeric
language sql
as $$ select coalesce(sum(disponible), 0) from v_proveedor_saldo_a_favor where proveedor_id = p_proveedor; $$;

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_view('public', 'v_proveedor_cuenta_corriente', 'Existe la vista de movimientos del proveedor');
select has_view('public', 'v_proveedor_saldo', 'Existe la vista de saldo por proveedor');
select has_view('public', 'v_proveedor_cuenta_resumen', 'Existe la vista de resumen de cuentas de proveedores');
select is(
  (select count(*)::int from pg_class
   where relname in ('v_proveedor_cuenta_corriente', 'v_proveedor_saldo', 'v_proveedor_cuenta_resumen')
     and 'security_invoker=true' = any (reloptions)),
  3,
  'Las tres vistas son security_invoker'
);
select has_function('public', 'aplicar_saldo_a_favor_compra', array['uuid'], 'Existe aplicar_saldo_a_favor_compra(uuid)');

-- ---------------------------------------------------------------------
-- Movimientos y saldo
-- ---------------------------------------------------------------------

do $$ begin perform pg_temp.comprobante('F1', 'factura', 1, 1000, '2026-10-01'); end $$;
do $$ begin perform pg_temp.comprobante('F2', 'factura', 2, 500, '2026-10-03'); end $$;
-- Se anula antes de que haya saldo a favor (si no, lo consumiría al confirmarse).
do $$ begin perform pg_temp.comprobante('F_anulada', 'factura', 5, 777, '2026-10-09'); end $$;
do $$ begin perform anular_comprobante_compra(pg_temp.id('F_anulada')); end $$;
do $$ begin perform pg_temp.pagar('OP_A', 1200, 'F1', 1000, '2026-10-05'); end $$;
do $$ begin perform pg_temp.comprobante('NC1', 'nota_credito', 3, 300, '2026-10-07'); end $$;
-- No cuentan: un borrador, un comprobante anulado y una orden en borrador.
do $$ begin perform pg_temp.comprobante('F_borrador', 'factura', 4, 999, '2026-10-08', p_confirmar => false); end $$;
do $$ begin perform pg_temp.pagar('OP_borrador', 50, 'F2', 50, '2026-10-10', p_confirmar => false); end $$;

select is(
  (select count(*)::int from v_proveedor_cuenta_corriente where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  4,
  'Movimientos: facturas, NC y órdenes confirmadas; sin borradores ni anulados'
);
select is(
  (select array_agg(tipo order by fecha) from v_proveedor_cuenta_corriente
   where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  array['factura', 'factura', 'orden_pago', 'nota_credito'],
  'Cada movimiento con su tipo'
);
select is(
  (select array_agg(debito order by fecha) from v_proveedor_cuenta_corriente
   where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  array[1000, 500, 0, 0]::numeric[],
  'Facturas y notas de débito van al débito (suman deuda)'
);
select is(
  (select array_agg(credito order by fecha) from v_proveedor_cuenta_corriente
   where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  array[0, 0, 1200, 300]::numeric[],
  'Órdenes de pago y notas de crédito van al crédito (restan deuda)'
);
select is(
  (select array_agg(saldo order by fecha) from v_proveedor_cuenta_corriente
   where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  array[1000, 1500, 300, 0]::numeric[],
  'Saldo acumulado por fecha'
);
select is(
  (select numero_texto from v_proveedor_cuenta_corriente where orden_pago_id = pg_temp.id('OP_A')),
  (select numero_texto from orden_pago where id = pg_temp.id('OP_A')),
  'La orden de pago se muestra con su número'
);
select is(
  (select numero_texto from v_proveedor_cuenta_corriente where comprobante_compra_id = pg_temp.id('F1')),
  'FC C 00009-00000001',
  'El comprobante se muestra con tipo, letra y número'
);

select is(
  (select debito || '|' || credito || '|' || saldo || '|' || deuda_pendiente || '|' || saldo_a_favor || '|' || pendiente_mas_viejo
   from v_proveedor_saldo where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  '1500.00|1500.00|0.00|500.00|500.00|2026-10-03',
  'Saldo del proveedor: neto cero, con deuda pendiente y saldo a favor'
);
select is(
  (select saldo || '|' || deuda_pendiente || '|' || saldo_a_favor
   from v_proveedor_saldo where proveedor_id = '00000000-0000-4000-8000-0000000009c3'),
  '0|0|0',
  'Un proveedor sin movimientos tiene todo en cero'
);

select is(
  (select pendientes || '|' || nombre || '|' || cuit from v_proveedor_cuenta_resumen
   where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  '1|Proveedor cuenta 1|30111111111',
  'El resumen incluye al proveedor con deuda y a favor aunque el neto sea cero'
);
select is(
  (select count(*)::int from v_proveedor_cuenta_resumen where proveedor_id = '00000000-0000-4000-8000-0000000009c3'),
  0,
  'El resumen no incluye proveedores sin nada en la cuenta'
);

-- ---------------------------------------------------------------------
-- Aplicar el saldo a favor
-- ---------------------------------------------------------------------

select is(aplicar_saldo_a_favor_compra(pg_temp.id('F2')), 500.00::numeric, 'Aplicar devuelve lo aplicado');
select is(pg_temp.saldo('F2'), 0::numeric, 'Y cancela el débito');
select is(pg_temp.a_favor(), 0::numeric, 'Y consume el saldo a favor');
select is(
  (select array_agg(coalesce(orden_pago_id, nota_credito_id) || '|' || importe || '|' || automatica order by importe)
   from imputacion_compra where comprobante_compra_id = pg_temp.id('F2') and orden_pago_id is distinct from pg_temp.id('OP_borrador')),
  array[pg_temp.id('OP_A') || '|200.00|true', pg_temp.id('NC1') || '|300.00|true'],
  'Del crédito más viejo al más nuevo: primero la orden y después la nota de crédito'
);
select is(
  (select saldo || '|' || deuda_pendiente || '|' || saldo_a_favor
   from v_proveedor_saldo where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  '0.00|0|0',
  'Aplicar no cambia el saldo neto: sólo cancela deuda contra lo que estaba a favor'
);
select is(
  (select count(*)::int from v_proveedor_cuenta_resumen where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  0,
  'Sin deuda ni a favor, el proveedor sale del resumen'
);

select throws_ok(
  format('select aplicar_saldo_a_favor_compra(%L)', pg_temp.id('F2')),
  'OP019', null,
  'Un débito sin saldo pendiente no se aplica (OP019)'
);

do $$ begin perform pg_temp.comprobante('F3', 'factura', 6, 800, '2026-10-11'); end $$;

select throws_ok(
  format('select aplicar_saldo_a_favor_compra(%L)', pg_temp.id('F3')),
  'OP018', null,
  'Sin saldo a favor no hay nada que aplicar (OP018)'
);

-- Un crédito de otro proveedor no se usa.
do $$ begin perform pg_temp.comprobante('NC_otro', 'nota_credito', 7, 50, '2026-10-12', '00000000-0000-4000-8000-0000000009c2'); end $$;
do $$ begin perform pg_temp.comprobante('NC2', 'nota_credito', 8, 100, '2026-10-13'); end $$;

select is(aplicar_saldo_a_favor_compra(pg_temp.id('F3')), 100.00::numeric, 'Aplica hasta agotar lo que hay a favor');
select is(pg_temp.saldo('F3'), 700.00::numeric, 'Y el resto queda pendiente');
select is(pg_temp.a_favor('00000000-0000-4000-8000-0000000009c2'), 50.00::numeric, 'Sin tocar el crédito de otro proveedor');

do $$ begin perform pg_temp.comprobante('NC_grande', 'nota_credito', 9, 1000, '2026-10-14'); end $$;

select is(aplicar_saldo_a_favor_compra(pg_temp.id('F3')), 700.00::numeric, 'Aplica hasta el saldo del débito');
select is(pg_temp.a_favor(), 300.00::numeric, 'Y lo que sobra sigue a favor');

select throws_ok(
  format('select aplicar_saldo_a_favor_compra(%L)', pg_temp.id('NC_grande')),
  'OP007', null,
  'Una nota de crédito no es un débito (OP007)'
);
select throws_ok(
  format('select aplicar_saldo_a_favor_compra(%L)', pg_temp.id('F_borrador')),
  'OP007', null,
  'Un borrador no es un débito (OP007)'
);
select throws_ok(
  'select aplicar_saldo_a_favor_compra(''00000000-0000-4000-8000-000000000000'')',
  'OP007', null,
  'Un comprobante inexistente tampoco (OP007)'
);

-- ---------------------------------------------------------------------
-- Anulaciones
-- ---------------------------------------------------------------------

do $$ begin perform anular_orden_pago(pg_temp.id('OP_A'), 'Prueba'); end $$;

select is(
  (select count(*)::int from v_proveedor_cuenta_corriente where orden_pago_id = pg_temp.id('OP_A')),
  0,
  'Una orden anulada sale de los movimientos'
);
select is(pg_temp.saldo('F1'), 1000.00::numeric, 'Y su factura vuelve a estar pendiente');
select is(pg_temp.saldo('F2'), 200.00::numeric, 'También lo que había aplicado como saldo a favor');
select is(
  (select saldo from v_proveedor_saldo where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  (select sum(debito) - sum(credito) from v_proveedor_cuenta_corriente
   where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  'El saldo del proveedor es débitos menos créditos de sus movimientos'
);
select is(
  (select saldo from v_proveedor_saldo where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  (select deuda_pendiente - saldo_a_favor from v_proveedor_saldo where proveedor_id = '00000000-0000-4000-8000-0000000009c1'),
  'Y es igual a la deuda pendiente menos el saldo a favor'
);

select * from finish();
rollback;

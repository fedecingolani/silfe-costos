-- =====================================================================
-- Tests del borrado de comprobantes X emitidos: se borra un X autorizado
-- sin comprobantes que dependan de él, se deshacen sus imputaciones
-- automáticas (el saldo vuelve a quedar a favor) y un presupuesto
-- convertido en ese X vuelve a abierto. Los A y B autorizados siguen sin
-- borrarse. Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into cliente (id, razon_social, condicion_iva) values
  ('cd000000-0000-0000-0000-000000000001', 'X sin dependencias', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000002', 'X con recibo', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000003', 'X con nota', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000004', 'X con saldo a favor', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000005', 'X con nota de crédito', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000006', 'X de presupuesto', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000007', 'A autorizada', 'Responsable Inscripto'),
  ('cd000000-0000-0000-0000-000000000008', 'X de contado', 'Responsable Inscripto');

insert into punto_venta (numero, nombre, electronico) values
  (9207, 'Electrónico borrar X', true),
  (9299, 'Interno borrar X', false);

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
insert into recibo_punto_venta (numero, nombre) values (19, 'Recibos borrar X');

set local role authenticated;

-- Facturas X de cuenta corriente, en borrador.
insert into comprobante (id, punto_venta, clase, letra, cliente_id, condicion_pago, neto, total, fecha) values
  ('cd100000-0000-0000-0000-000000000001', 9299, 'factura', 'X',
   'cd000000-0000-0000-0000-000000000001', 'cuenta_corriente', 100, 100, '2026-10-01'),
  ('cd100000-0000-0000-0000-000000000002', 9299, 'factura', 'X',
   'cd000000-0000-0000-0000-000000000002', 'cuenta_corriente', 50, 50, '2026-10-01'),
  ('cd100000-0000-0000-0000-000000000003', 9299, 'factura', 'X',
   'cd000000-0000-0000-0000-000000000003', 'cuenta_corriente', 30, 30, '2026-10-01'),
  ('cd100000-0000-0000-0000-000000000005', 9299, 'factura', 'X',
   'cd000000-0000-0000-0000-000000000005', 'cuenta_corriente', 100, 100, '2026-10-01'),
  ('cd100000-0000-0000-0000-000000000008', 9299, 'factura', 'X',
   'cd000000-0000-0000-0000-000000000008', 'contado', 45, 45, '2026-10-01');

select autorizar_comprobante_interno(id)
from comprobante
where id in ('cd100000-0000-0000-0000-000000000001', 'cd100000-0000-0000-0000-000000000002',
             'cd100000-0000-0000-0000-000000000003', 'cd100000-0000-0000-0000-000000000005',
             'cd100000-0000-0000-0000-000000000008');

-- ---------------------------------------------------------------------
-- X sin dependencias
-- ---------------------------------------------------------------------

select lives_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000001'$$,
  'Se borra una factura X autorizada sin comprobantes que dependan de ella'
);
select ok(
  not exists (select 1 from comprobante where id = 'cd100000-0000-0000-0000-000000000001'),
  'La factura X ya no existe'
);

-- ---------------------------------------------------------------------
-- A autorizada: sigue sin borrarse
-- ---------------------------------------------------------------------

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id, total, fecha)
values ('cd100000-0000-0000-0000-000000000007', 9207, 'homologacion', 'factura', 'A', 1,
        'cd000000-0000-0000-0000-000000000007', 10, '2026-10-01');
update comprobante set estado = 'verificando', intento_numero = 1 where id = 'cd100000-0000-0000-0000-000000000007';
update comprobante set estado = 'autorizado', numero = 1, cae = '12345678901234', cae_vencimiento = '2026-12-31'
where id = 'cd100000-0000-0000-0000-000000000007';

select throws_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000007'$$,
  'CM001', null, 'Una factura A autorizada no se borra'
);

-- ---------------------------------------------------------------------
-- X con un recibo que le imputa a mano
-- ---------------------------------------------------------------------

insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cd200000-0000-0000-0000-000000000002', 19, 'cd000000-0000-0000-0000-000000000002', '2026-10-02', 50);
insert into recibo_medio (recibo_id, tipo, importe) values ('cd200000-0000-0000-0000-000000000002', 'efectivo', 50);
insert into imputacion (recibo_id, comprobante_id, importe)
values ('cd200000-0000-0000-0000-000000000002', 'cd100000-0000-0000-0000-000000000002', 50);
select emitir_recibo('cd200000-0000-0000-0000-000000000002');

select throws_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000002'$$,
  'CM010', null, 'Un X con un recibo que le imputa no se borra'
);
select ok(
  exists (select 1 from imputacion where comprobante_id = 'cd100000-0000-0000-0000-000000000002'),
  'La imputación del recibo sigue en pie'
);

-- ---------------------------------------------------------------------
-- X de contado con su pago
-- ---------------------------------------------------------------------

insert into recibo (id, punto_venta, cliente_id, fecha, total, comprobante_contado_id) values
  ('cd200000-0000-0000-0000-000000000008', 19, 'cd000000-0000-0000-0000-000000000008', '2026-10-02', 45,
   'cd100000-0000-0000-0000-000000000008');

select throws_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000008'$$,
  'CM010', null, 'Un X de contado con su recibo de pago (aunque sea un borrador) no se borra'
);

-- ---------------------------------------------------------------------
-- X con una nota asociada
-- ---------------------------------------------------------------------

insert into comprobante (id, punto_venta, clase, letra, cliente_id, condicion_pago, neto, total, fecha)
values ('cd100000-0000-0000-0000-000000000033', 9299, 'nota_credito', 'X',
        'cd000000-0000-0000-0000-000000000003', 'cuenta_corriente', 5, 5, '2026-10-03');
insert into comprobante_asociado (comprobante_id, asociado_id)
values ('cd100000-0000-0000-0000-000000000033', 'cd100000-0000-0000-0000-000000000003');

select throws_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000003'$$,
  'CM010', null, 'Un X con una nota asociada no se borra'
);

-- ---------------------------------------------------------------------
-- X que consumió saldo a favor: la imputación automática se deshace
-- ---------------------------------------------------------------------

insert into recibo (id, punto_venta, cliente_id, fecha, total) values
  ('cd200000-0000-0000-0000-000000000004', 19, 'cd000000-0000-0000-0000-000000000004', '2026-10-02', 80);
insert into recibo_medio (recibo_id, tipo, importe) values ('cd200000-0000-0000-0000-000000000004', 'efectivo', 80);
select emitir_recibo('cd200000-0000-0000-0000-000000000004');

insert into comprobante (id, punto_venta, clase, letra, cliente_id, condicion_pago, neto, total, fecha)
values ('cd100000-0000-0000-0000-000000000004', 9299, 'factura', 'X',
        'cd000000-0000-0000-0000-000000000004', 'cuenta_corriente', 50, 50, '2026-10-04');
select autorizar_comprobante_interno('cd100000-0000-0000-0000-000000000004');

select results_eq(
  $$select importe, automatica from imputacion where comprobante_id = 'cd100000-0000-0000-0000-000000000004'$$,
  $$values (50.00::numeric(14,2), true)$$,
  'Al emitir la factura X se le aplica el saldo a favor del recibo'
);
select is(
  (select disponible from v_cliente_saldo_a_favor where recibo_id = 'cd200000-0000-0000-0000-000000000004'),
  30.00::numeric,
  'Al recibo le quedan 30 a favor'
);
select lives_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000004'$$,
  'Se borra un X cuyas únicas imputaciones son automáticas'
);
select ok(
  not exists (select 1 from imputacion where recibo_id = 'cd200000-0000-0000-0000-000000000004'),
  'La imputación automática se deshizo'
);
select is(
  (select disponible from v_cliente_saldo_a_favor where recibo_id = 'cd200000-0000-0000-0000-000000000004'),
  80.00::numeric,
  'El recibo vuelve a tener todo su saldo a favor'
);

-- ---------------------------------------------------------------------
-- Nota de crédito X con sus imputaciones automáticas
-- ---------------------------------------------------------------------

insert into comprobante (id, punto_venta, clase, letra, cliente_id, condicion_pago, neto, total, fecha)
values ('cd100000-0000-0000-0000-000000000055', 9299, 'nota_credito', 'X',
        'cd000000-0000-0000-0000-000000000005', 'cuenta_corriente', 40, 40, '2026-10-05');
insert into comprobante_asociado (comprobante_id, asociado_id)
values ('cd100000-0000-0000-0000-000000000055', 'cd100000-0000-0000-0000-000000000005');
select autorizar_comprobante_interno('cd100000-0000-0000-0000-000000000055');

select is(
  (select saldo from v_comprobante_saldo where comprobante_id = 'cd100000-0000-0000-0000-000000000005'),
  60.00::numeric,
  'La nota de crédito X cancela 40 de la factura'
);
select throws_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000005'$$,
  'CM010', null, 'La factura X con una nota de crédito asociada no se borra'
);
select lives_ok(
  $$delete from comprobante where id = 'cd100000-0000-0000-0000-000000000055'$$,
  'Se borra la nota de crédito X con sus imputaciones automáticas'
);
select ok(
  not exists (select 1 from imputacion where nota_credito_id = 'cd100000-0000-0000-0000-000000000055'),
  'Las imputaciones de la nota de crédito se deshicieron'
);
select is(
  (select saldo from v_comprobante_saldo where comprobante_id = 'cd100000-0000-0000-0000-000000000005'),
  100.00::numeric,
  'La factura vuelve a tener todo su saldo pendiente'
);

-- ---------------------------------------------------------------------
-- Presupuesto convertido en un X
-- ---------------------------------------------------------------------

create temp table px (nombre text primary key, id uuid);
insert into px
select 'pres', guardar_presupuesto(
  null,
  '{"cliente_id": "cd000000-0000-0000-0000-000000000006", "fecha": "2026-10-06", "valido_hasta": null,
    "fecha_vencimiento_pago": null, "condicion_pago": "cuenta_corriente", "lista_precio_id": null,
    "observaciones": null, "neto": 100, "no_gravado": 0, "iva": 21, "total": 121}'::jsonb,
  '[{"producto_id": null, "codigo": null, "descripcion": "Lona", "observaciones": null,
     "unidad": "u", "cantidad": 1, "precio_unitario": 100, "descuento_pct": 0, "gravado": true,
     "alicuota_iva": 21, "importe": 100, "iva": 21}]'::jsonb
);
insert into px select 'fact', convertir_presupuesto((select id from px where nombre = 'pres'), 9299);
select autorizar_comprobante_interno((select id from px where nombre = 'fact'));

select lives_ok(
  $$delete from comprobante where id = (select id from px where nombre = 'fact')$$,
  'Se borra la factura X autorizada que salió de un presupuesto'
);
select results_eq(
  $$select estado, comprobante_id, convertido_en from presupuesto where id = (select id from px where nombre = 'pres')$$,
  $$values ('abierto'::text, null::uuid, null::timestamptz)$$,
  'El presupuesto vuelve a abierto'
);

reset role;

select * from finish();
rollback;

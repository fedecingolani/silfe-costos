-- =====================================================================
-- Tests de presupuestos de venta: estructura, permisos, numeración,
-- guardar_presupuesto, convertir_presupuesto, inmutabilidad de los
-- convertidos y vuelta a abierto al borrar el borrador de factura.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(78);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array['presupuesto', 'presupuesto_item']) as t;

select has_column('public', 'presupuesto', c, format('presupuesto tiene %s', c))
from unnest(array[
  'numero', 'cliente_id', 'fecha', 'valido_hasta', 'fecha_vencimiento_pago', 'condicion_pago', 'lista_precio_id',
  'observaciones', 'neto', 'no_gravado', 'iva', 'total', 'estado', 'comprobante_id', 'convertido_en'
]) as c;
select has_column('public', 'presupuesto_item', 'gravado', 'presupuesto_item distingue ítems no gravados');

select col_default_is('public', 'presupuesto', 'estado', 'abierto', 'Un presupuesto nace abierto');
select col_default_is('public', 'presupuesto', 'condicion_pago', 'cuenta_corriente', 'Por defecto, cuenta corriente');
select has_trigger('public', 'presupuesto', 'trg_presupuesto_validar', 'presupuesto valida estado e inmutabilidad');
select has_trigger('public', 'presupuesto', 'trg_presupuesto_borrar', 'presupuesto valida el borrado');
select has_trigger('public', 'presupuesto_item', 'trg_presupuesto_item_bloqueo', 'Los ítems se bloquean con el presupuesto');
select has_function('public', 'guardar_presupuesto', array['uuid', 'jsonb', 'jsonb'], 'Existe guardar_presupuesto');
select has_function('public', 'convertir_presupuesto', array['uuid', 'integer'], 'Existe convertir_presupuesto');

-- ---------------------------------------------------------------------
-- Anónimos
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['presupuesto', 'presupuesto_item']) as t;

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.guardar_presupuesto(uuid, jsonb, jsonb)',
  'public.convertir_presupuesto(uuid, integer)'
]) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

update arca_emisor set ambiente = 'homologacion' where id;

insert into cliente (id, razon_social, cuit, condicion_iva)
values ('c0000000-0000-0000-0000-000000000011', 'Cliente presupuesto', '30712345671', 'Responsable Inscripto'),
       ('c0000000-0000-0000-0000-000000000012', 'Consumidor presupuesto', '20111111112', 'Consumidor Final');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

insert into punto_venta (numero, nombre, electronico) values (9007, 'Electrónico de prueba', true);

-- ---------------------------------------------------------------------
-- Alta directa: número automático y valores por defecto
-- ---------------------------------------------------------------------

create temp table pres (nombre text primary key, id uuid);

select lives_ok(
  $$with x as (
      insert into presupuesto (cliente_id, fecha) values ('c0000000-0000-0000-0000-000000000011', '2026-03-01')
      returning id
    )
    insert into pres select 'directo', id from x$$,
  'Un usuario autenticado crea un presupuesto'
);
select results_eq(
  $$select estado, valido_hasta, fecha_vencimiento_pago, creado_por
    from presupuesto where id = (select id from pres where nombre = 'directo')$$,
  $$values ('abierto'::text, '2026-03-16'::date, '2026-03-01'::date, '11111111-1111-1111-1111-111111111111'::uuid)$$,
  'Por defecto: abierto, válido 15 días, vence el pago en la fecha y guarda quién lo creó'
);
select ok(
  (select numero > 0 from presupuesto where id = (select id from pres where nombre = 'directo')),
  'El número se asigna solo al crear'
);
select throws_ok(
  $$insert into presupuesto (cliente_id, numero) values ('c0000000-0000-0000-0000-000000000011', 999999)$$,
  '428C9', null, 'El número no se elige'
);
select throws_ok(
  $$update presupuesto set numero = numero + 1000 where id = (select id from pres where nombre = 'directo')$$,
  null, null, 'El número no se cambia'
);
select throws_ok(
  $$insert into presupuesto (cliente_id, estado) values ('c0000000-0000-0000-0000-000000000011', 'convertido')$$,
  'PR002', null, 'Un presupuesto se crea abierto'
);
select throws_ok(
  $$insert into presupuesto (cliente_id, fecha, valido_hasta)
    values ('c0000000-0000-0000-0000-000000000011', '2026-03-10', '2026-03-09')$$,
  '23514', null, 'Válido hasta no puede ser anterior a la fecha'
);
select throws_ok(
  $$insert into presupuesto (cliente_id, fecha, fecha_vencimiento_pago)
    values ('c0000000-0000-0000-0000-000000000011', '2026-03-10', '2026-03-09')$$,
  '23514', null, 'El vencimiento del pago no puede ser anterior a la fecha'
);
select throws_ok(
  $$insert into presupuesto (cliente_id, condicion_pago) values ('c0000000-0000-0000-0000-000000000011', 'cheque')$$,
  '23514', null, 'La condición de pago es cuenta corriente o contado'
);
select throws_ok(
  $$insert into presupuesto (fecha) values ('2026-03-10')$$,
  '23502', null, 'El cliente es obligatorio'
);
select throws_ok(
  $$update presupuesto set estado = 'convertido' where id = (select id from pres where nombre = 'directo')$$,
  'PR002', null, 'Un presupuesto no se marca convertido a mano'
);

select lives_ok(
  $$with x as (
      insert into presupuesto (cliente_id) values ('c0000000-0000-0000-0000-000000000011') returning id
    )
    insert into pres select 'segundo', id from x$$,
  'Se crea otro presupuesto'
);
select ok(
  (select p2.numero > p1.numero
   from presupuesto p1, presupuesto p2
   where p1.id = (select id from pres where nombre = 'directo') and p2.id = (select id from pres where nombre = 'segundo')),
  'La numeración es correlativa'
);

-- ---------------------------------------------------------------------
-- Ítems
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into presupuesto_item (presupuesto_id, descripcion, cantidad, gravado, alicuota_iva)
    values ((select id from pres where nombre = 'directo'), 'X', 1, true, 19)$$,
  '23514', null, 'La alícuota es una de las de ARCA'
);
select throws_ok(
  $$insert into presupuesto_item (presupuesto_id, descripcion, cantidad, gravado, alicuota_iva)
    values ((select id from pres where nombre = 'directo'), 'X', 1, false, 21)$$,
  '23514', null, 'Un ítem no gravado no lleva alícuota'
);
select throws_ok(
  $$insert into presupuesto_item (presupuesto_id, descripcion, cantidad, alicuota_iva)
    values ((select id from pres where nombre = 'directo'), 'X', 0, 21)$$,
  '23514', null, 'La cantidad es positiva'
);

-- ---------------------------------------------------------------------
-- guardar_presupuesto
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into pres
    select 'rpc', guardar_presupuesto(
      null,
      '{"cliente_id": "c0000000-0000-0000-0000-000000000011", "fecha": "2026-01-10", "valido_hasta": null,
        "fecha_vencimiento_pago": "2026-01-20", "condicion_pago": "cuenta_corriente", "lista_precio_id": null,
        "observaciones": "Entrega en planta", "neto": 1100, "no_gravado": 0, "iva": 220.5, "total": 1320.5}'::jsonb,
      '[{"producto_id": null, "codigo": null, "descripcion": "Lona", "observaciones": null,
         "unidad": "u", "cantidad": 1, "precio_unitario": 1000, "descuento_pct": 0, "gravado": true,
         "alicuota_iva": 21, "importe": 1000, "iva": 210},
        {"producto_id": null, "codigo": "X", "descripcion": "Correa", "observaciones": "nota",
         "unidad": "u", "cantidad": 2, "precio_unitario": 50, "descuento_pct": 0, "alicuota_iva": 10.5,
         "importe": 100, "iva": 10.5}]'::jsonb
    )$$,
  'guardar_presupuesto crea un presupuesto con sus ítems'
);
select results_eq(
  $$select estado, valido_hasta, total, observaciones from presupuesto where id = (select id from pres where nombre = 'rpc')$$,
  $$values ('abierto'::text, '2026-01-25'::date, 1320.50::numeric(14,2), 'Entrega en planta'::text)$$,
  'Sin válido hasta, vale 15 días desde la fecha'
);
select results_eq(
  $$select orden, descripcion, gravado from presupuesto_item
    where presupuesto_id = (select id from pres where nombre = 'rpc') order by orden$$,
  $$values (0, 'Lona'::text, true), (1, 'Correa'::text, true)$$,
  'Los ítems se guardan en el orden recibido (gravado por defecto)'
);

select lives_ok(
  $$select guardar_presupuesto(
      (select id from pres where nombre = 'rpc'),
      '{"cliente_id": "c0000000-0000-0000-0000-000000000011", "fecha": "2026-01-10", "valido_hasta": "2026-02-10",
        "fecha_vencimiento_pago": "2026-01-20", "condicion_pago": "contado", "lista_precio_id": null,
        "observaciones": "Entrega en planta", "neto": 1000, "no_gravado": 500, "iva": 210, "total": 1710}'::jsonb,
      '[{"producto_id": null, "codigo": null, "descripcion": "Lona", "observaciones": null,
         "unidad": "u", "cantidad": 1, "precio_unitario": 1000, "descuento_pct": 0, "gravado": true,
         "alicuota_iva": 21, "importe": 1000, "iva": 210},
        {"producto_id": null, "codigo": null, "descripcion": "Flete", "observaciones": null,
         "unidad": null, "cantidad": 1, "precio_unitario": 500, "descuento_pct": 0, "gravado": false,
         "alicuota_iva": null, "importe": 500, "iva": 0}]'::jsonb
    )$$,
  'guardar_presupuesto actualiza un presupuesto abierto'
);
select results_eq(
  $$select condicion_pago, valido_hasta, no_gravado, total from presupuesto where id = (select id from pres where nombre = 'rpc')$$,
  $$values ('contado'::text, '2026-02-10'::date, 500.00::numeric(14,2), 1710.00::numeric(14,2))$$,
  'Se actualiza la cabecera'
);
select results_eq(
  $$select descripcion, gravado, alicuota_iva from presupuesto_item
    where presupuesto_id = (select id from pres where nombre = 'rpc') order by orden$$,
  $$values ('Lona'::text, true, 21.00::numeric(5,2)), ('Flete'::text, false, null::numeric(5,2))$$,
  'Los ítems se reemplazan'
);
select throws_ok(
  $$select guardar_presupuesto(
      null,
      '{"cliente_id": "c0000000-0000-0000-0000-000000000011", "fecha": "2026-01-10", "valido_hasta": "2026-01-09"}'::jsonb,
      '[]'::jsonb
    )$$,
  '23514', null, 'guardar_presupuesto rechaza un válido hasta anterior a la fecha'
);
select throws_ok(
  $$select guardar_presupuesto(
      'f0000000-0000-0000-0000-000000000000',
      '{"cliente_id": "c0000000-0000-0000-0000-000000000011"}'::jsonb,
      '[]'::jsonb
    )$$,
  'PR004', null, 'guardar_presupuesto informa un presupuesto inexistente'
);

-- ---------------------------------------------------------------------
-- convertir_presupuesto
-- ---------------------------------------------------------------------

create temp table fact (nombre text primary key, id uuid);

select throws_ok(
  $$select convertir_presupuesto('f0000000-0000-0000-0000-000000000000', 9007)$$,
  'PR004', null, 'No se convierte un presupuesto inexistente'
);
select throws_ok(
  $$select convertir_presupuesto((select id from pres where nombre = 'rpc'), 9999)$$,
  'PR007', null, 'No se convierte en un punto de venta inexistente'
);

select lives_ok(
  $$insert into fact select 'rpc', convertir_presupuesto((select id from pres where nombre = 'rpc'), 9007)$$,
  'Se convierte un presupuesto abierto'
);
select results_eq(
  $$select estado, clase, punto_venta, ambiente, letra, tipo_arca, cliente_id, condicion_pago, observaciones,
           fecha, fecha_vencimiento_pago, neto, no_gravado, iva, total
    from comprobante where id = (select id from fact where nombre = 'rpc')$$,
  $$values ('borrador'::text, 'factura'::text, 9007, 'homologacion'::text, 'A'::text, 1,
            'c0000000-0000-0000-0000-000000000011'::uuid, 'contado'::text, 'Entrega en planta'::text,
            (now() at time zone 'America/Argentina/Buenos_Aires')::date,
            (now() at time zone 'America/Argentina/Buenos_Aires')::date,
            1000.00::numeric(14,2), 500.00::numeric(14,2), 210.00::numeric(14,2), 1710.00::numeric(14,2))$$,
  'Genera un borrador de factura de hoy con los datos y totales del presupuesto'
);
select results_eq(
  $$select orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct,
           gravado, alicuota_iva, importe, iva
    from comprobante_item where comprobante_id = (select id from fact where nombre = 'rpc') order by orden$$,
  $$select orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct,
           gravado, alicuota_iva, importe, iva
    from presupuesto_item where presupuesto_id = (select id from pres where nombre = 'rpc') order by orden$$,
  'Los ítems se copian tal cual'
);
select results_eq(
  $$select estado, comprobante_id, convertido_en is not null from presupuesto where id = (select id from pres where nombre = 'rpc')$$,
  $$select 'convertido'::text, (select id from fact where nombre = 'rpc'), true$$,
  'El presupuesto queda convertido y enlazado a la factura'
);

-- Inmutable una vez convertido
select throws_ok(
  $$select convertir_presupuesto((select id from pres where nombre = 'rpc'), 9007)$$,
  'PR005', null, 'Un presupuesto se convierte una sola vez'
);
select throws_ok(
  $$update presupuesto set observaciones = 'otra' where id = (select id from pres where nombre = 'rpc')$$,
  'PR001', null, 'Un presupuesto convertido no se edita'
);
select throws_ok(
  $$select guardar_presupuesto(
      (select id from pres where nombre = 'rpc'),
      '{"cliente_id": "c0000000-0000-0000-0000-000000000011", "fecha": "2026-01-10"}'::jsonb,
      '[]'::jsonb
    )$$,
  'PR001', null, 'guardar_presupuesto no edita un convertido'
);
select throws_ok(
  $$update presupuesto set estado = 'abierto', comprobante_id = null, convertido_en = null
    where id = (select id from pres where nombre = 'rpc')$$,
  'PR002', null, 'Un convertido no se desvincula a mano mientras la factura existe'
);
select throws_ok(
  $$delete from presupuesto where id = (select id from pres where nombre = 'rpc')$$,
  'PR003', null, 'Un presupuesto convertido no se borra'
);
select throws_ok(
  $$update presupuesto_item set cantidad = 5 where presupuesto_id = (select id from pres where nombre = 'rpc')$$,
  'PR001', null, 'Los ítems de un convertido no se editan'
);
select throws_ok(
  $$delete from presupuesto_item where presupuesto_id = (select id from pres where nombre = 'rpc')$$,
  'PR001', null, 'Los ítems de un convertido no se borran'
);
select throws_ok(
  $$insert into presupuesto_item (presupuesto_id, descripcion, cantidad, alicuota_iva)
    values ((select id from pres where nombre = 'rpc'), 'Nuevo', 1, 21)$$,
  'PR001', null, 'A un convertido no se le agregan ítems'
);

-- Fuera de saldos y cuentas corrientes
select is(
  (select count(*)::integer from v_cuenta_corriente where cliente_id = 'c0000000-0000-0000-0000-000000000011'),
  0,
  'Los presupuestos (y el borrador generado) no aparecen en la cuenta corriente'
);
select results_eq(
  $$select debe, haber, saldo from v_cliente_saldo where cliente_id = 'c0000000-0000-0000-0000-000000000011'$$,
  $$values (0::numeric, 0::numeric, 0::numeric)$$,
  'Los presupuestos no suman al saldo del cliente'
);

-- Borrar el borrador de factura devuelve el presupuesto a abierto
select lives_ok(
  $$delete from comprobante where id = (select id from fact where nombre = 'rpc')$$,
  'Se borra el borrador de factura generado'
);
select results_eq(
  $$select estado, comprobante_id, convertido_en from presupuesto where id = (select id from pres where nombre = 'rpc')$$,
  $$values ('abierto'::text, null::uuid, null::timestamptz)$$,
  'El presupuesto vuelve a abierto, sin vínculo'
);
select results_eq(
  $$select count(*)::integer from presupuesto_item where presupuesto_id = (select id from pres where nombre = 'rpc')$$,
  $$values (2)$$,
  'Conserva sus ítems'
);
select lives_ok(
  $$update presupuesto set observaciones = 'Reabierto' where id = (select id from pres where nombre = 'rpc')$$,
  'Vuelve a poder editarse'
);

-- Se vuelve a convertir, con el punto de venta por defecto
select lives_ok(
  $$insert into fact select 'default', convertir_presupuesto((select id from pres where nombre = 'rpc'))$$,
  'Se vuelve a convertir sin indicar punto de venta'
);
select is(
  (select punto_venta from comprobante where id = (select id from fact where nombre = 'default')),
  (select min(numero) from punto_venta where activo and electronico),
  'Sin punto de venta usa el primer electrónico activo'
);

-- Letra B para un consumidor final; vencimiento futuro se respeta
select lives_ok(
  $$insert into fact select 'cf', convertir_presupuesto(
      guardar_presupuesto(
        null,
        jsonb_build_object(
          'cliente_id', 'c0000000-0000-0000-0000-000000000012',
          'fecha', (now() at time zone 'America/Argentina/Buenos_Aires')::date,
          'fecha_vencimiento_pago', (now() at time zone 'America/Argentina/Buenos_Aires')::date + 30,
          'neto', 100, 'iva', 21, 'total', 121
        ),
        '[{"descripcion": "Malla", "cantidad": 1, "precio_unitario": 100, "alicuota_iva": 21,
           "importe": 100, "iva": 21}]'::jsonb
      ),
      9007
    )$$,
  'Se convierte el presupuesto de un consumidor final'
);
select results_eq(
  $$select letra, tipo_arca, fecha_vencimiento_pago from comprobante where id = (select id from fact where nombre = 'cf')$$,
  $$values ('B'::text, 6, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 30)$$,
  'La letra sale del cliente y un vencimiento futuro se conserva'
);

-- Un presupuesto abierto se borra (con sus ítems)
select lives_ok(
  $$delete from presupuesto where id = (select id from pres where nombre = 'directo')$$,
  'Un presupuesto abierto se borra'
);

select * from finish();
rollback;

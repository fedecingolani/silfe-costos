-- =====================================================================
-- Tests de comprobantes de venta: puntos de venta, comprobante con sus
-- ítems y comprobantes asociados, transiciones de estado, inmutabilidad
-- de los autorizados, numeración única por ambiente / punto de venta /
-- tipo, bloqueo de numeración y permisos. Corre con `supabase test db`.
-- Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(122);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array[
  'punto_venta', 'comprobante', 'comprobante_item', 'comprobante_asociado', 'comprobante_numeracion_bloqueo'
]) as t;

select has_column('public', 'arca_emisor', c, format('arca_emisor tiene %s', c))
from unnest(array['domicilio_comercial', 'ingresos_brutos', 'inicio_actividades']) as c;

select col_is_pk('public', 'punto_venta', 'numero', 'El punto de venta se identifica por su número');
select col_default_is('public', 'comprobante', 'estado', 'borrador', 'Un comprobante nace en borrador');
select col_default_is('public', 'comprobante', 'condicion_pago', 'cuenta_corriente', 'Por defecto, cuenta corriente');
select col_default_is('public', 'comprobante', 'moneda', 'PES', 'Por defecto, pesos');
select has_index('public', 'comprobante', 'comprobante_numero_unico', 'Numeración única por ambiente, punto de venta y tipo');
select has_trigger('public', 'comprobante', 'trg_comprobante_validar', 'comprobante valida estado e inmutabilidad');
select has_trigger('public', 'comprobante', 'trg_comprobante_borrar', 'comprobante valida el borrado');
select has_trigger('public', 'comprobante', 'trg_comprobante_actualizado', 'comprobante actualiza actualizado_en');
select has_trigger('public', 'comprobante_item', 'trg_comprobante_item_bloqueo', 'Los ítems se bloquean con el comprobante');
select has_trigger('public', 'comprobante_asociado', 'trg_comprobante_asociado_bloqueo', 'Los asociados se bloquean con el comprobante');
select has_function('public', 'tomar_bloqueo_numeracion', array['text', 'integer', 'integer', 'interval'],
  'Existe tomar_bloqueo_numeracion');
select has_function('public', 'liberar_bloqueo_numeracion', array['text', 'integer', 'integer', 'timestamp with time zone'],
  'Existe liberar_bloqueo_numeracion');

-- ---------------------------------------------------------------------
-- Anónimos
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array[
  'punto_venta', 'comprobante', 'comprobante_item', 'comprobante_asociado', 'comprobante_numeracion_bloqueo'
]) as t;

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.tomar_bloqueo_numeracion(text, integer, integer, interval)',
  'public.liberar_bloqueo_numeracion(text, integer, integer, timestamp with time zone)'
]) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into cliente (id, razon_social, cuit, condicion_iva)
values ('c0000000-0000-0000-0000-000000000001', 'Cliente de prueba', '30712345671', 'Responsable Inscripto'),
       ('c0000000-0000-0000-0000-000000000002', 'Otro cliente', '20111111112', 'Monotributista');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$insert into punto_venta (numero, nombre, electronico) values
      (9007, 'Electrónico de prueba', true),
      (9099, 'Interno de prueba', false)$$,
  'Un usuario autenticado carga puntos de venta'
);
select throws_ok(
  $$insert into punto_venta (numero, electronico) values (0, true)$$,
  '23514', null, 'El punto de venta empieza en 1'
);

-- ---------------------------------------------------------------------
-- Alta de borradores
-- ---------------------------------------------------------------------

select throws_ok(
  $$insert into comprobante (punto_venta, clase, cliente_id)
    values (9007, 'factura', 'c0000000-0000-0000-0000-000000000001')$$,
  'CM005', null, 'Un punto de venta electrónico exige el ambiente'
);
select throws_ok(
  $$insert into comprobante (punto_venta, ambiente, clase, cliente_id)
    values (9099, 'produccion', 'factura', 'c0000000-0000-0000-0000-000000000001')$$,
  'CM005', null, 'Un punto de venta no electrónico no lleva ambiente'
);
select throws_ok(
  $$insert into comprobante (punto_venta, ambiente, clase, cliente_id, estado)
    values (9007, 'homologacion', 'factura', 'c0000000-0000-0000-0000-000000000001', 'autorizado')$$,
  'CM002', null, 'Un comprobante se crea en borrador'
);
select throws_ok(
  $$insert into comprobante (punto_venta, ambiente, clase, cliente_id)
    values (9007, 'homologacion', 'recibo', 'c0000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'La clase es factura, nota de crédito o nota de débito'
);
select throws_ok(
  $$insert into comprobante (punto_venta, ambiente, clase, letra, tipo_arca, cliente_id)
    values (9007, 'homologacion', 'factura', 'B', 1, 'c0000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'El tipo de ARCA corresponde a la clase y la letra'
);
select throws_ok(
  $$insert into comprobante (punto_venta, ambiente, clase, cliente_id, numero)
    values (9007, 'homologacion', 'factura', 'c0000000-0000-0000-0000-000000000001', 5)$$,
  '23514', null, 'Un borrador no tiene número'
);
select throws_ok(
  $$insert into comprobante (punto_venta, ambiente, clase, cliente_id, condicion_pago)
    values (9007, 'homologacion', 'factura', 'c0000000-0000-0000-0000-000000000001', 'cheque')$$,
  '23514', null, 'La condición de pago es cuenta corriente o contado'
);

select lives_ok(
  $$insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id)
    values ('a0000000-0000-0000-0000-000000000001', 9007, 'homologacion', 'factura', 'A', 1,
            'c0000000-0000-0000-0000-000000000001')$$,
  'Un usuario autenticado crea un borrador'
);
select is(
  (select fecha from comprobante where id = 'a0000000-0000-0000-0000-000000000001'),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  'La fecha por defecto es hoy en Argentina'
);
select is(
  (select fecha_vencimiento_pago from comprobante where id = 'a0000000-0000-0000-0000-000000000001'),
  (select fecha from comprobante where id = 'a0000000-0000-0000-0000-000000000001'),
  'El vencimiento del cobro por defecto es la fecha del comprobante'
);
select is(
  (select creado_por from comprobante where id = 'a0000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Se registra quién creó el comprobante'
);

-- ---------------------------------------------------------------------
-- Ítems y comprobantes asociados
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into comprobante_item (id, comprobante_id, orden, descripcion, cantidad, precio_unitario, alicuota_iva, importe, iva)
    values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1,
            'Desarrollo de producto', 1, 1000, 21, 1000, 210)$$,
  'Se carga un ítem libre en un borrador'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva)
    values ('a0000000-0000-0000-0000-000000000001', 'x', 0, 1, 21)$$,
  '23514', null, 'La cantidad es mayor a cero'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva)
    values ('a0000000-0000-0000-0000-000000000001', 'x', 1, -1, 21)$$,
  '23514', null, 'El precio no es negativo'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva)
    values ('a0000000-0000-0000-0000-000000000001', 'x', 1, 1, 22)$$,
  '23514', null, 'La alícuota es una de las de ARCA'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva, descuento_pct)
    values ('a0000000-0000-0000-0000-000000000001', 'x', 1, 1, 21, 101)$$,
  '23514', null, 'El descuento está entre 0 y 100'
);
select throws_ok(
  $$insert into comprobante_asociado (comprobante_id, tipo_arca, punto_venta)
    values ('a0000000-0000-0000-0000-000000000001', 1, 7)$$,
  '23514', null, 'Un asociado manual necesita tipo, punto de venta, número, fecha y CUIT'
);
select lives_ok(
  $$insert into comprobante_asociado (comprobante_id, tipo_arca, punto_venta, numero, fecha, cuit)
    values ('a0000000-0000-0000-0000-000000000001', 1, 7, 150, '2026-01-10', '30712345671')$$,
  'Se asocia a mano un comprobante que no está en la base'
);

-- ---------------------------------------------------------------------
-- Transiciones
-- ---------------------------------------------------------------------

select throws_ok(
  $$update comprobante set estado = 'rechazado' where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'CM002', null, 'Un borrador no pasa directo a rechazado'
);
select throws_ok(
  $$update comprobante set estado = 'autorizado', numero = 1, cae = '1', cae_vencimiento = current_date
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'CM002', null, 'Un borrador electrónico no se autoriza sin pasar por ARCA'
);
select throws_ok(
  $$update comprobante set estado = 'verificando' where id = 'a0000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Para verificar hace falta el número enviado a ARCA'
);
select lives_ok(
  $$update comprobante set estado = 'verificando', intento_numero = 361
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'Un borrador pasa a verificando con el número enviado'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva)
    values ('a0000000-0000-0000-0000-000000000001', 'x', 1, 1, 21)$$,
  'CM004', null, 'Mientras se verifica no se agregan ítems'
);
select throws_ok(
  $$update comprobante set estado = 'autorizado', numero = 361
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'CM005', null, 'Un comprobante electrónico autorizado tiene CAE'
);
select lives_ok(
  $$update comprobante
    set estado = 'autorizado', numero = 361, cae = '76123456789012', cae_vencimiento = current_date + 10,
        arca_resultado = 'A', autorizado_en = now()
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'Un comprobante verificado pasa a autorizado con número y CAE'
);

-- ---------------------------------------------------------------------
-- Inmutabilidad del autorizado
-- ---------------------------------------------------------------------

select throws_ok(
  $$update comprobante set observaciones = 'cambio' where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'CM001', null, 'Un comprobante autorizado no se modifica'
);
select throws_ok(
  $$delete from comprobante where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'CM001', null, 'Un comprobante autorizado no se borra'
);
select throws_ok(
  $$update comprobante_item set cantidad = 2 where id = 'b0000000-0000-0000-0000-000000000001'$$,
  'CM004', null, 'Los ítems de un autorizado no se modifican'
);
select throws_ok(
  $$delete from comprobante_item where id = 'b0000000-0000-0000-0000-000000000001'$$,
  'CM004', null, 'Los ítems de un autorizado no se borran'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva)
    values ('a0000000-0000-0000-0000-000000000001', 'x', 1, 1, 21)$$,
  'CM004', null, 'A un autorizado no se le agregan ítems'
);
select throws_ok(
  $$delete from comprobante_asociado where comprobante_id = 'a0000000-0000-0000-0000-000000000001'$$,
  'CM004', null, 'Los asociados de un autorizado no se borran'
);

-- ---------------------------------------------------------------------
-- Numeración única
-- ---------------------------------------------------------------------

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id)
values ('a0000000-0000-0000-0000-000000000002', 9007, 'homologacion', 'factura', 'A', 1,
        'c0000000-0000-0000-0000-000000000001');
update comprobante set estado = 'verificando', intento_numero = 361
where id = 'a0000000-0000-0000-0000-000000000002';

select throws_ok(
  $$update comprobante set estado = 'autorizado', numero = 361, cae = '1', cae_vencimiento = current_date
    where id = 'a0000000-0000-0000-0000-000000000002'$$,
  '23505', null, 'No se repite el número en el mismo ambiente, punto de venta y tipo'
);

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id)
values ('a0000000-0000-0000-0000-000000000003', 9007, 'produccion', 'factura', 'A', 1,
        'c0000000-0000-0000-0000-000000000001');
update comprobante set estado = 'verificando', intento_numero = 361
where id = 'a0000000-0000-0000-0000-000000000003';
select lives_ok(
  $$update comprobante set estado = 'autorizado', numero = 361, cae = '2', cae_vencimiento = current_date
    where id = 'a0000000-0000-0000-0000-000000000003'$$,
  'El mismo número en otro ambiente no choca'
);

-- ----- Verificando: rechazo, vuelta a borrador y borrado ----------------

select throws_ok(
  $$delete from comprobante where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'CM003', null, 'Un comprobante en verificación no se borra'
);
select lives_ok(
  $$update comprobante set estado = 'rechazado', intento_numero = null, arca_resultado = 'R',
      arca_errores = '[{"code": 10016, "msg": "no correlativo"}]'
    where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'ARCA rechaza: el comprobante queda rechazado sin número'
);
select throws_ok(
  $$update comprobante set estado = 'autorizado', numero = 362, cae = '3', cae_vencimiento = current_date
    where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'CM002', null, 'Un rechazado no pasa directo a autorizado'
);
select lives_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, precio_unitario, alicuota_iva)
    values ('a0000000-0000-0000-0000-000000000002', 'Corrección', 1, 1, 21)$$,
  'Un rechazado se puede corregir'
);
select lives_ok(
  $$update comprobante set estado = 'borrador' where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'Un rechazado vuelve a borrador'
);
select lives_ok(
  $$update comprobante set estado = 'verificando', intento_numero = 362
    where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'Se vuelve a intentar'
);
select lives_ok(
  $$update comprobante set estado = 'borrador', intento_numero = null
    where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'Si ARCA no lo tiene, un comprobante en verificación vuelve a borrador'
);
select lives_ok(
  $$delete from comprobante where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'Un borrador se borra'
);
select is(
  (select count(*)::int from comprobante_item where comprobante_id = 'a0000000-0000-0000-0000-000000000002'),
  0,
  'Al borrar el borrador se borran sus ítems'
);

-- ---------------------------------------------------------------------
-- Verificando: el número enviado queda anclado y los datos no cambian
-- ---------------------------------------------------------------------

insert into punto_venta (numero, nombre, electronico) values (9008, 'Otro electrónico', true);
insert into comprobante (
  id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id,
  receptor_razon_social, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva,
  receptor_domicilio, receptor_provincia, neto, iva, total
)
values ('a0000000-0000-0000-0000-000000000007', 9007, 'homologacion', 'factura', 'A', 1,
        'c0000000-0000-0000-0000-000000000001', 'Cliente de prueba', 80, '30712345671',
        'Responsable Inscripto', 'Calle 1', 'Río Negro', 100, 21, 121);
update comprobante set estado = 'verificando', intento_numero = 500
where id = 'a0000000-0000-0000-0000-000000000007';

select throws_ok(
  format('update comprobante set %I = %s where id = %L', c, v, 'a0000000-0000-0000-0000-000000000007'),
  'CM004', null, format('En verificación no cambia %s', c)
)
from (values
  ('punto_venta', '9008'),
  ('ambiente', $$'produccion'$$),
  ('clase', $$'nota_debito'$$),
  ('letra', $$'B'$$),
  ('tipo_arca', '6'),
  ('cliente_id', $$'c0000000-0000-0000-0000-000000000002'$$),
  ('fecha', 'fecha + 1'),
  ('neto', '101'),
  ('iva', '22'),
  ('total', '123'),
  ('receptor_razon_social', $$'Otra razón social'$$),
  ('receptor_doc_tipo', '96'),
  ('receptor_doc_nro', $$'20111111112'$$),
  ('receptor_condicion_iva', $$'Monotributista'$$),
  ('receptor_domicilio', $$'Calle 2'$$),
  ('receptor_provincia', $$'Neuquén'$$)
) as t(c, v);

select lives_ok(
  $$update comprobante set intento_numero = 501 where id = 'a0000000-0000-0000-0000-000000000007'$$,
  'En verificación cambia el número a intentar (reintento por número no correlativo)'
);
select throws_ok(
  $$update comprobante set estado = 'autorizado', numero = 500, cae = '9', cae_vencimiento = current_date
    where id = 'a0000000-0000-0000-0000-000000000007'$$,
  'CM002', null, 'Se autoriza sólo con el número enviado a ARCA'
);
select lives_ok(
  $$update comprobante set estado = 'autorizado', numero = 501, cae = '9', cae_vencimiento = current_date
    where id = 'a0000000-0000-0000-0000-000000000007'$$,
  'Se autoriza con el número enviado a ARCA'
);

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id)
values ('a0000000-0000-0000-0000-000000000008', 9007, 'homologacion', 'factura', 'A', 1,
        'c0000000-0000-0000-0000-000000000001');

select throws_ok(
  $$update comprobante set intento_numero = 7 where id = 'a0000000-0000-0000-0000-000000000008'$$,
  'CM002', null, 'Un borrador no cambia el número a intentar sin pasar a verificación'
);
update comprobante set estado = 'verificando', intento_numero = 7 where id = 'a0000000-0000-0000-0000-000000000008';
update comprobante set estado = 'rechazado', arca_resultado = 'R' where id = 'a0000000-0000-0000-0000-000000000008';
select throws_ok(
  $$update comprobante set intento_numero = 8 where id = 'a0000000-0000-0000-0000-000000000008'$$,
  'CM002', null, 'Un rechazado no cambia el número a intentar'
);

-- ---------------------------------------------------------------------
-- Punto de venta no electrónico
-- ---------------------------------------------------------------------

insert into comprobante (id, punto_venta, clase, letra, tipo_arca, cliente_id)
values ('a0000000-0000-0000-0000-000000000004', 9099, 'factura', 'A', 1, 'c0000000-0000-0000-0000-000000000001'),
       ('a0000000-0000-0000-0000-000000000005', 9099, 'factura', 'A', 1, 'c0000000-0000-0000-0000-000000000001');

select lives_ok(
  $$update comprobante set estado = 'autorizado', numero = 1 where id = 'a0000000-0000-0000-0000-000000000004'$$,
  'Un borrador no electrónico se emite sin CAE'
);
select throws_ok(
  $$update comprobante set estado = 'autorizado', numero = 1 where id = 'a0000000-0000-0000-0000-000000000005'$$,
  '23505', null, 'La numeración no electrónica (sin ambiente) también es única'
);
select throws_ok(
  $$update comprobante set estado = 'verificando', intento_numero = 2
    where id = 'a0000000-0000-0000-0000-000000000005'$$,
  'CM002', null, 'Un comprobante no electrónico no pasa por ARCA'
);
select throws_ok(
  $$update comprobante set punto_venta = 9007 where id = 'a0000000-0000-0000-0000-000000000005'$$,
  'CM005', null, 'Cambiar a un punto de venta electrónico exige el ambiente'
);
select throws_ok(
  $$delete from punto_venta where numero = 9099$$,
  '23503', null, 'Un punto de venta con comprobantes no se borra'
);

-- ---------------------------------------------------------------------
-- Comprobante asociado en la base
-- ---------------------------------------------------------------------

insert into comprobante (id, punto_venta, ambiente, clase, letra, tipo_arca, cliente_id)
values ('a0000000-0000-0000-0000-000000000006', 9007, 'homologacion', 'nota_credito', 'A', 3,
        'c0000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into comprobante_asociado (comprobante_id, asociado_id)
    values ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001')$$,
  'Una nota de crédito se asocia a una factura de la base'
);
select throws_ok(
  $$insert into comprobante_asociado (comprobante_id, asociado_id, numero)
    values ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 3)$$,
  '23514', null, 'Un asociado de la base no lleva datos manuales'
);
select throws_ok(
  $$insert into comprobante_asociado (comprobante_id, asociado_id)
    values ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006')$$,
  '23514', null, 'Un comprobante no se asocia a sí mismo'
);

-- ---------------------------------------------------------------------
-- Bloqueo de numeración
-- ---------------------------------------------------------------------

create temporary table bloqueo_prueba (hasta timestamptz) on commit drop;
grant all on bloqueo_prueba to authenticated;
insert into bloqueo_prueba select tomar_bloqueo_numeracion('homologacion', 9007, 1, interval '1 minute');

select isnt((select hasta from bloqueo_prueba), null, 'Se toma el bloqueo libre');
select is(
  tomar_bloqueo_numeracion('homologacion', 9007, 1, interval '1 minute'),
  null,
  'Un bloqueo vigente no se vuelve a tomar'
);
select isnt(
  tomar_bloqueo_numeracion('homologacion', 9007, 6, interval '1 minute'),
  null,
  'Otro tipo de comprobante tiene su propio bloqueo'
);
select lives_ok(
  $$select liberar_bloqueo_numeracion('homologacion', 9007, 1, now() + interval '1 hour')$$,
  'Liberar con un bloqueo ajeno no falla'
);
select is(
  tomar_bloqueo_numeracion('homologacion', 9007, 1, interval '1 minute'),
  null,
  'Liberar con un bloqueo ajeno no lo suelta'
);
select liberar_bloqueo_numeracion('homologacion', 9007, 1, (select hasta from bloqueo_prueba));
select isnt(
  tomar_bloqueo_numeracion('homologacion', 9007, 1, interval '1 minute'),
  null,
  'Liberado, el bloqueo se vuelve a tomar'
);
update comprobante_numeracion_bloqueo set bloqueado_hasta = now() - interval '1 second'
where ambiente = 'homologacion' and punto_venta = 9007 and tipo_arca = 1;
select isnt(
  tomar_bloqueo_numeracion('homologacion', 9007, 1, interval '1 minute'),
  null,
  'Un bloqueo vencido se vuelve a tomar'
);

-- ---------------------------------------------------------------------
-- guardar_borrador_comprobante: cabecera e ítems en una sola transacción
-- ---------------------------------------------------------------------

update arca_emisor set ambiente = 'produccion' where id;

create temp table borrador_rpc (id uuid);
select lives_ok(
  $$insert into borrador_rpc
    select guardar_borrador_comprobante(
      null,
      '{"punto_venta": 9007, "clase": "factura", "letra": "A", "tipo_arca": 1, "fecha": "2026-10-16",
        "fecha_vencimiento_pago": "2026-10-30", "cliente_id": "c0000000-0000-0000-0000-000000000001",
        "lista_precio_id": null, "condicion_pago": "cuenta_corriente", "observaciones": "Entrega en planta",
        "neto": 1100, "iva": 220.5, "total": 1320.5}'::jsonb,
      '[{"producto_id": null, "codigo": null, "descripcion": "Desarrollo de producto", "observaciones": null,
         "unidad": null, "cantidad": 1, "precio_unitario": 1000, "descuento_pct": 0, "alicuota_iva": 21,
         "importe": 1000, "iva": 210},
        {"producto_id": null, "codigo": "X", "descripcion": "Otro", "observaciones": "nota",
         "unidad": "u", "cantidad": 2, "precio_unitario": 50, "descuento_pct": 0, "alicuota_iva": 10.5,
         "importe": 100, "iva": 10.5}]'::jsonb
    )$$,
  'guardar_borrador_comprobante crea un borrador con sus ítems'
);
select results_eq(
  $$select estado, ambiente, total, observaciones from comprobante where id = (select id from borrador_rpc)$$,
  $$values ('borrador'::text, 'produccion'::text, 1320.50::numeric(14,2), 'Entrega en planta'::text)$$,
  'El borrador nuevo de un punto de venta electrónico toma el ambiente activo del emisor'
);
select results_eq(
  $$select orden, descripcion from comprobante_item where comprobante_id = (select id from borrador_rpc) order by orden$$,
  $$values (0, 'Desarrollo de producto'::text), (1, 'Otro'::text)$$,
  'Los ítems se guardan en el orden recibido'
);

update arca_emisor set ambiente = 'homologacion' where id;

select lives_ok(
  $$select guardar_borrador_comprobante(
      (select id from borrador_rpc),
      '{"punto_venta": 9007, "clase": "nota_debito", "letra": "A", "tipo_arca": 2, "fecha": "2026-10-17",
        "fecha_vencimiento_pago": "2026-10-17", "cliente_id": "c0000000-0000-0000-0000-000000000001",
        "lista_precio_id": null, "condicion_pago": "contado", "observaciones": null,
        "neto": 50, "iva": 10.5, "total": 60.5}'::jsonb,
      '[{"producto_id": null, "descripcion": "Ajuste", "cantidad": 1, "precio_unitario": 50,
         "descuento_pct": 0, "alicuota_iva": 21, "importe": 50, "iva": 10.5}]'::jsonb
    )$$,
  'guardar_borrador_comprobante actualiza un borrador existente'
);
select results_eq(
  $$select clase, condicion_pago, ambiente, total from comprobante where id = (select id from borrador_rpc)$$,
  $$values ('nota_debito'::text, 'contado'::text, 'produccion'::text, 60.50::numeric(14,2))$$,
  'Al actualizar se conserva el ambiente con que se creó el borrador'
);
select is(
  (select count(*)::int from comprobante_item where comprobante_id = (select id from borrador_rpc)),
  1,
  'Al actualizar se reemplazan los ítems'
);

select throws_ok(
  $$select guardar_borrador_comprobante(
      (select id from borrador_rpc),
      '{"punto_venta": 9007, "clase": "factura", "fecha": "2026-10-17", "fecha_vencimiento_pago": "2026-10-17",
        "cliente_id": "c0000000-0000-0000-0000-000000000001", "condicion_pago": "contado",
        "neto": 0, "iva": 0, "total": 0}'::jsonb,
      '[{"descripcion": "Sin cantidad", "cantidad": 0, "precio_unitario": 1, "descuento_pct": 0,
         "alicuota_iva": 21, "importe": 0, "iva": 0}]'::jsonb
    )$$,
  '23514', null, 'Un ítem inválido hace fallar todo el guardado'
);
select results_eq(
  $$select c.clase, (select count(*)::int from comprobante_item i where i.comprobante_id = c.id)
    from comprobante c where c.id = (select id from borrador_rpc)$$,
  $$values ('nota_debito'::text, 1)$$,
  'Si el guardado falla, el borrador queda como estaba (cabecera e ítems)'
);

-- Un rechazado vuelve a borrador al guardarlo y se limpian los mensajes de ARCA.
update comprobante set estado = 'verificando', intento_numero = 77, letra = 'A', tipo_arca = 2
where id = (select id from borrador_rpc);
update comprobante set estado = 'rechazado', intento_numero = null, arca_resultado = 'R',
  arca_errores = '[{"code": 10242, "msg": "Falta la condición IVA"}]'
where id = (select id from borrador_rpc);
select lives_ok(
  $$select guardar_borrador_comprobante(
      (select id from borrador_rpc),
      '{"punto_venta": 9007, "clase": "nota_debito", "fecha": "2026-10-17", "fecha_vencimiento_pago": "2026-10-17",
        "cliente_id": "c0000000-0000-0000-0000-000000000001", "condicion_pago": "contado",
        "neto": 50, "iva": 10.5, "total": 60.5}'::jsonb,
      '[{"descripcion": "Ajuste corregido", "cantidad": 1, "precio_unitario": 50, "descuento_pct": 0,
         "alicuota_iva": 21, "importe": 50, "iva": 10.5}]'::jsonb
    )$$,
  'Un rechazado se puede corregir'
);
select results_eq(
  $$select estado, arca_resultado, arca_errores from comprobante where id = (select id from borrador_rpc)$$,
  $$values ('borrador'::text, null::text, null::jsonb)$$,
  'Al corregir un rechazado vuelve a borrador sin los mensajes de ARCA'
);

select throws_ok(
  $$select guardar_borrador_comprobante(
      'a0000000-0000-0000-0000-000000000007',
      '{"punto_venta": 9007, "clase": "factura", "fecha": "2026-10-16", "fecha_vencimiento_pago": "2026-10-16",
        "cliente_id": "c0000000-0000-0000-0000-000000000001", "condicion_pago": "contado",
        "neto": 0, "iva": 0, "total": 0}'::jsonb,
      '[]'::jsonb
    )$$,
  'CM004', null, 'No se guarda como borrador un comprobante en verificación'
);
select throws_ok(
  $$select guardar_borrador_comprobante(
      'a0000000-0000-0000-0000-0000000000ff',
      '{"punto_venta": 9007, "clase": "factura", "fecha": "2026-10-16", "fecha_vencimiento_pago": "2026-10-16",
        "cliente_id": "c0000000-0000-0000-0000-000000000001", "condicion_pago": "contado",
        "neto": 0, "iva": 0, "total": 0}'::jsonb,
      '[]'::jsonb
    )$$,
  'CM006', null, 'Informa si el comprobante no existe'
);
select is(
  (select ambiente from comprobante where id = guardar_borrador_comprobante(
    null,
    '{"punto_venta": 9099, "clase": "factura", "fecha": "2026-10-16", "fecha_vencimiento_pago": "2026-10-16",
      "cliente_id": "c0000000-0000-0000-0000-000000000002", "condicion_pago": "cuenta_corriente",
      "neto": 0, "iva": 0, "total": 0}'::jsonb,
    '[]'::jsonb
  )),
  null,
  'Un borrador de un punto de venta no electrónico no lleva ambiente'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.guardar_borrador_comprobante(uuid, jsonb, jsonb)', 'execute'),
  'anon no ejecuta guardar_borrador_comprobante'
);
select ok(
  has_function_privilege('authenticated', 'public.guardar_borrador_comprobante(uuid, jsonb, jsonb)', 'execute'),
  'authenticated ejecuta guardar_borrador_comprobante'
);

select * from finish();
rollback;

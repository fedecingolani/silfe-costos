-- =====================================================================
-- Tests de remitos de venta: estructura, permisos, alta en borrador,
-- emitir_remito (numeración por punto de venta), edición de un emitido,
-- anular_remito, inmutabilidad de los anulados, bloqueo de ítems y
-- bultos totales.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(83);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array['remito', 'remito_item']) as t;

select has_column('public', 'remito', c, format('remito tiene %s', c))
from unnest(array[
  'punto_venta', 'numero', 'cliente_id', 'fecha', 'fecha_vencimiento_pago', 'condicion_pago', 'lista_precio_id',
  'observaciones', 'neto', 'no_gravado', 'iva', 'total', 'estado', 'emitido_en', 'anulado_en',
  'transporte_id', 'domicilio_entrega', 'valor_declarado', 'bultos_total'
]) as c;
select has_column('public', 'remito_item', 'bultos', 'remito_item tiene bultos');

select col_default_is('public', 'remito', 'estado', 'borrador', 'Un remito nace en borrador');
select has_trigger('public', 'remito', 'trg_remito_validar', 'remito valida estado e inmutabilidad');
select has_trigger('public', 'remito', 'trg_remito_borrar', 'remito valida el borrado');
select has_trigger('public', 'remito_item', 'trg_remito_item_bloqueo', 'Los ítems se bloquean con el remito');
select has_trigger('public', 'remito_item', 'trg_remito_item_bultos', 'Los ítems recalculan los bultos totales');
select has_function('public', 'emitir_remito', array['uuid'], 'Existe emitir_remito');
select has_function('public', 'anular_remito', array['uuid'], 'Existe anular_remito');

-- ---------------------------------------------------------------------
-- Anónimos
-- ---------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['remito', 'remito_item']) as t;

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array['public.emitir_remito(uuid)', 'public.anular_remito(uuid)']) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into cliente (id, razon_social, cuit, condicion_iva)
values ('c0000000-0000-0000-0000-000000000021', 'Cliente remito', '30712345671', 'Responsable Inscripto'),
       ('c0000000-0000-0000-0000-000000000022', 'Otro cliente remito', '20111111112', 'Consumidor Final');

insert into transporte (id, nombre) values ('70000000-0000-0000-0000-000000000021', 'Expreso de prueba remito');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

insert into punto_venta (numero, nombre, electronico, activo)
values (9101, 'Remitos no electrónico', false, true),
       (9102, 'Remitos electrónico', true, true),
       (9103, 'Remitos inactivo', false, false);

create temp table rem (nombre text primary key, id uuid);

-- Crea un remito en borrador con un ítem de 2 bultos y lo registra.
create function pg_temp.nuevo_remito(p_nombre text, p_pv integer, p_items integer default 1)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into remito (cliente_id, punto_venta, fecha)
  values ('c0000000-0000-0000-0000-000000000021', p_pv, '2026-11-04')
  returning id into v_id;
  insert into remito_item (remito_id, orden, descripcion, cantidad, bultos, alicuota_iva)
  select v_id, g, 'Lona ' || g, 10, 2, 21 from generate_series(1, p_items) g;
  insert into rem values (p_nombre, v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Alta: siempre borrador y sin número
-- ---------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.nuevo_remito('a', 9101)$$,
  'Un usuario autenticado crea un remito en borrador con ítems'
);
select results_eq(
  $$select estado, numero, emitido_en, anulado_en, fecha_vencimiento_pago, condicion_pago, valor_declarado,
           creado_por
    from remito where id = (select id from rem where nombre = 'a')$$,
  $$values ('borrador'::text, null::bigint, null::timestamptz, null::timestamptz, '2026-11-04'::date,
            'cuenta_corriente'::text, 0::numeric, '11111111-1111-1111-1111-111111111111'::uuid)$$,
  'Por defecto: borrador, sin número, vence en la fecha, cuenta corriente, valor declarado 0 y guarda quién lo creó'
);
select throws_ok(
  $$insert into remito (cliente_id, punto_venta, estado) values ('c0000000-0000-0000-0000-000000000021', 9101, 'emitido')$$,
  'RM002', null, 'Un remito se crea en borrador'
);
select throws_ok(
  $$insert into remito (cliente_id, punto_venta, numero) values ('c0000000-0000-0000-0000-000000000021', 9101, 5)$$,
  'RM002', null, 'Un remito se crea sin número'
);
select throws_ok(
  $$insert into remito (cliente_id, punto_venta, estado) values ('c0000000-0000-0000-0000-000000000021', 9101, 'parcial')$$,
  'RM002', null, 'No hay estados derivados en el alta'
);
select throws_ok(
  $$insert into remito (cliente_id, punto_venta) values ('c0000000-0000-0000-0000-000000000021', 99999)$$,
  '23503', null, 'El punto de venta tiene que existir'
);
select throws_ok(
  $$insert into remito (cliente_id) values ('c0000000-0000-0000-0000-000000000021')$$,
  '23502', null, 'El punto de venta es obligatorio'
);
select throws_ok(
  $$insert into remito (cliente_id, punto_venta, valor_declarado) values ('c0000000-0000-0000-0000-000000000021', 9101, -1)$$,
  '23514', null, 'El valor declarado no es negativo'
);
select throws_ok(
  $$insert into remito_item (remito_id, descripcion, cantidad, bultos, alicuota_iva)
    values ((select id from rem where nombre = 'a'), 'Malla', 1, -1, 21)$$,
  '23514', null, 'Los bultos de un ítem no son negativos'
);

-- ---------------------------------------------------------------------
-- Bultos totales
-- ---------------------------------------------------------------------

select is(
  (select bultos_total from remito where id = (select id from rem where nombre = 'a')),
  2, 'Bultos totales = suma de los ítems al insertar'
);
insert into remito_item (remito_id, orden, descripcion, cantidad, bultos, alicuota_iva)
values ((select id from rem where nombre = 'a'), 2, 'Correa', 5, 3, 21);
select is(
  (select bultos_total from remito where id = (select id from rem where nombre = 'a')),
  5, 'Bultos totales se suman al agregar un ítem'
);
update remito_item set bultos = 7 where remito_id = (select id from rem where nombre = 'a') and descripcion = 'Correa';
select is(
  (select bultos_total from remito where id = (select id from rem where nombre = 'a')),
  9, 'Bultos totales se recalculan al cambiar un ítem'
);
delete from remito_item where remito_id = (select id from rem where nombre = 'a') and descripcion = 'Correa';
select is(
  (select bultos_total from remito where id = (select id from rem where nombre = 'a')),
  2, 'Bultos totales se recalculan al borrar un ítem'
);
update remito set bultos_total = 99 where id = (select id from rem where nombre = 'a');
select is(
  (select bultos_total from remito where id = (select id from rem where nombre = 'a')),
  2, 'Bultos totales no se escriben a mano: siguen a la suma de los ítems'
);

-- ---------------------------------------------------------------------
-- Borrador: editable, no se emite a mano
-- ---------------------------------------------------------------------

select lives_ok(
  $$update remito
    set cliente_id = 'c0000000-0000-0000-0000-000000000022',
        punto_venta = 9101,
        transporte_id = '70000000-0000-0000-0000-000000000021',
        domicilio_entrega = 'Ruta 22 km 1000',
        valor_declarado = 1500
    where id = (select id from rem where nombre = 'a')$$,
  'Un borrador se edita'
);
select throws_ok(
  $$update remito set estado = 'emitido', numero = 1, emitido_en = now()
    where id = (select id from rem where nombre = 'a')$$,
  'RM002', null, 'Un borrador no pasa a emitido sin emitir_remito'
);
select throws_ok(
  $$update remito set estado = 'anulado' where id = (select id from rem where nombre = 'a')$$,
  'RM002', null, 'Un borrador no se anula'
);
select throws_ok(
  $$update remito set numero = 1 where id = (select id from rem where nombre = 'a')$$,
  'RM006', null, 'El número de un borrador no se escribe a mano'
);
select throws_ok(
  $$select anular_remito((select id from rem where nombre = 'a'))$$,
  'RM002', null, 'anular_remito pide un remito emitido'
);

-- ---------------------------------------------------------------------
-- Emisión y numeración por punto de venta
-- ---------------------------------------------------------------------

do $$ begin perform pg_temp.nuevo_remito('sin_items', 9101, 0); end $$;
select throws_ok(
  $$select emitir_remito((select id from rem where nombre = 'sin_items'))$$,
  'RM005', null, 'No se emite un remito sin ítems'
);

do $$ begin perform pg_temp.nuevo_remito('inactivo', 9103); end $$;
select throws_ok(
  $$select emitir_remito((select id from rem where nombre = 'inactivo'))$$,
  'RM007', null, 'No se emite en un punto de venta inactivo'
);

select throws_ok(
  $$select emitir_remito('00000000-0000-0000-0000-000000000000')$$,
  'RM004', null, 'emitir_remito avisa si el remito no existe'
);

do $$ begin perform pg_temp.nuevo_remito('b', 9101); end $$;
do $$ begin perform pg_temp.nuevo_remito('c', 9102); end $$;
do $$ begin perform pg_temp.nuevo_remito('d', 9102); end $$;

select results_eq(
  $$select estado, numero, emitido_en is not null
    from emitir_remito((select id from rem where nombre = 'a'))$$,
  $$values ('emitido'::text, 1::bigint, true)$$,
  'El primer remito del punto de venta toma el número 1 y queda emitido'
);
select is(
  (select numero from emitir_remito((select id from rem where nombre = 'b'))),
  2::bigint, 'El siguiente en el mismo punto de venta toma el número 2'
);
select is(
  (select numero from emitir_remito((select id from rem where nombre = 'c'))),
  1::bigint, 'Otro punto de venta (electrónico) tiene su propia serie'
);
select is(
  (select numero from emitir_remito((select id from rem where nombre = 'd'))),
  2::bigint, 'La serie del segundo punto de venta sigue en 2'
);
select throws_ok(
  $$select emitir_remito((select id from rem where nombre = 'a'))$$,
  'RM002', null, 'Un remito emitido no se vuelve a emitir'
);
select is(
  (select indexdef ~ 'UNIQUE.*\(punto_venta, numero\) WHERE \(numero IS NOT NULL\)'
   from pg_indexes where schemaname = 'public' and indexname = 'remito_numero_unico'),
  true, 'Índice único: un número no se repite dentro del punto de venta'
);

-- ---------------------------------------------------------------------
-- Emitido: cabecera editable salvo número, punto de venta, cliente y emisión
-- ---------------------------------------------------------------------

select lives_ok(
  $$update remito
    set observaciones = 'Entregar por la tarde',
        domicilio_entrega = 'Depósito 2',
        valor_declarado = 2000,
        transporte_id = null
    where id = (select id from rem where nombre = 'a')$$,
  'La cabecera de un emitido se edita'
);
select lives_ok(
  $$insert into remito_item (remito_id, orden, descripcion, cantidad, bultos, alicuota_iva)
    values ((select id from rem where nombre = 'a'), 5, 'Lona extra', 1, 4, 21)$$,
  'Los ítems de un emitido se editan'
);
select is(
  (select bultos_total from remito where id = (select id from rem where nombre = 'a')),
  6, 'Bultos totales se recalculan en un emitido'
);
select throws_ok(
  $$update remito set numero = 50 where id = (select id from rem where nombre = 'a')$$,
  'RM006', null, 'El número de un emitido no cambia'
);
select throws_ok(
  $$update remito set punto_venta = 9102 where id = (select id from rem where nombre = 'a')$$,
  'RM006', null, 'El punto de venta de un emitido no cambia'
);
select throws_ok(
  $$update remito set cliente_id = 'c0000000-0000-0000-0000-000000000021' where id = (select id from rem where nombre = 'a')$$,
  'RM006', null, 'El cliente de un emitido no cambia'
);
select throws_ok(
  $$update remito set emitido_en = now() - interval '1 day' where id = (select id from rem where nombre = 'a')$$,
  'RM006', null, 'La fecha de emisión no cambia'
);
select throws_ok(
  $$update remito set estado = 'borrador', numero = null, emitido_en = null where id = (select id from rem where nombre = 'a')$$,
  'RM002', null, 'Un emitido no vuelve a borrador'
);
select throws_ok(
  $$update remito set estado = 'anulado', anulado_en = now() where id = (select id from rem where nombre = 'a')$$,
  'RM002', null, 'Un emitido no se anula sin anular_remito'
);
select throws_ok(
  $$delete from remito where id = (select id from rem where nombre = 'a')$$,
  'RM003', null, 'Un emitido no se borra'
);

-- ---------------------------------------------------------------------
-- Anulación e inmutabilidad
-- ---------------------------------------------------------------------

select results_eq(
  $$select estado, numero, anulado_en is not null
    from anular_remito((select id from rem where nombre = 'b'))$$,
  $$values ('anulado'::text, 2::bigint, true)$$,
  'anular_remito deja el remito anulado y conserva el número'
);
select throws_ok(
  $$select anular_remito((select id from rem where nombre = 'b'))$$,
  'RM002', null, 'Un anulado no se vuelve a anular'
);
select throws_ok(
  $$update remito set observaciones = 'cambio' where id = (select id from rem where nombre = 'b')$$,
  'RM001', null, 'Un anulado no se modifica'
);
select throws_ok(
  $$update remito set estado = 'emitido', anulado_en = null where id = (select id from rem where nombre = 'b')$$,
  'RM001', null, 'Un anulado no vuelve a emitido'
);
select throws_ok(
  $$delete from remito where id = (select id from rem where nombre = 'b')$$,
  'RM003', null, 'Un anulado no se borra'
);
select throws_ok(
  $$insert into remito_item (remito_id, descripcion, cantidad, alicuota_iva) values ((select id from rem where nombre = 'b'), 'Más', 1, 21)$$,
  'RM001', null, 'A un anulado no se le agregan ítems'
);
select throws_ok(
  $$update remito_item set bultos = 9 where remito_id = (select id from rem where nombre = 'b')$$,
  'RM001', null, 'Los ítems de un anulado no se cambian'
);
select throws_ok(
  $$delete from remito_item where remito_id = (select id from rem where nombre = 'b')$$,
  'RM001', null, 'Los ítems de un anulado no se borran'
);
select is(
  (select numero from emitir_remito(pg_temp.nuevo_remito('e', 9101))),
  3::bigint, 'Un anulado conserva su número: el siguiente remito no lo reutiliza'
);

-- ---------------------------------------------------------------------
-- Borrado de un borrador
-- ---------------------------------------------------------------------

select lives_ok(
  $$delete from remito where id = (select id from rem where nombre = 'sin_items')$$,
  'Un borrador se borra'
);
select lives_ok(
  $$delete from remito where id = (select id from rem where nombre = 'inactivo')$$,
  'Un borrador con ítems se borra (los ítems caen en cascada)'
);
select is(
  (select count(*)::int from remito_item where remito_id = (select id from rem where nombre = 'inactivo')),
  0, 'Los ítems del borrador borrado no quedan'
);

select * from finish();
rollback;

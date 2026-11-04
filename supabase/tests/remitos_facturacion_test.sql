-- =====================================================================
-- Tests de la facturación de remitos: vínculo comprobante_item ->
-- remito_item, pendiente por ítem y estado derivado, facturar_remitos,
-- tope de lo pendiente (también con dos borradores y por SQL directo),
-- bloqueo de los remitos facturados y desbloqueo al borrar el borrador,
-- vínculo conservado al volver a guardar el borrador, guardar_remito y
-- las tres advertencias de la revisión de los remitos (transiciones con
-- la marca de la transacción falsificada, candado del remito en los
-- ítems y borrado de una lista de precios).
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(99);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_column('public', 'comprobante_item', 'remito_item_id', 'comprobante_item apunta al ítem de remito');
select fk_ok('public', 'comprobante_item', 'remito_item_id', 'public', 'remito_item', 'id',
  'remito_item_id referencia a remito_item');
select has_index('public', 'comprobante_item', 'comprobante_item_remito_item_idx', 'Índice por ítem de remito');
select has_view('public', 'v_remito_item_pendiente', 'Existe v_remito_item_pendiente');
select has_view('public', 'v_remito_estado', 'Existe v_remito_estado');
select has_function('public', 'facturar_remitos', array['jsonb', 'integer'], 'Existe facturar_remitos');
select has_function('public', 'guardar_remito', array['uuid', 'jsonb', 'jsonb'], 'Existe guardar_remito');
select has_trigger('public', 'comprobante_item', 'trg_comprobante_item_remito', 'Los ítems de factura controlan el remito');
select has_trigger('public', 'comprobante', 'trg_comprobante_remito', 'La cabecera de la factura controla los remitos');

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.facturar_remitos(jsonb, integer)',
  'public.guardar_remito(uuid, jsonb, jsonb)'
]) as f;

select ok(
  not has_table_privilege('anon', 'public.' || v, 'select'),
  format('anon no lee %s', v)
)
from unnest(array['v_remito_item_pendiente', 'v_remito_estado']) as v;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

update arca_emisor set ambiente = 'homologacion' where id;

insert into cliente (id, razon_social, cuit, condicion_iva)
values ('c0000000-0000-0000-0000-000000000031', 'Cliente facturación remito', '30712345671', 'Responsable Inscripto'),
       ('c0000000-0000-0000-0000-000000000032', 'Otro cliente facturación', '20111111112', 'Consumidor Final');

insert into lista_precio (id, nombre)
values ('10000000-0000-0000-0000-000000000031', 'Lista remito anulado'),
       ('10000000-0000-0000-0000-000000000032', 'Lista remito facturado'),
       ('10000000-0000-0000-0000-000000000033', 'Lista que queda');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

insert into punto_venta (numero, nombre, electronico, activo)
values (9201, 'Facturación remitos no electrónico', false, true),
       (9202, 'Facturación remitos electrónico', true, true),
       (9203, 'Facturación remitos inactivo', false, false);

create temp table rem (nombre text primary key, id uuid);
create temp table fac (nombre text primary key, id uuid);

-- Guarda un remito con guardar_remito y lo registra; p_emitir lo emite.
create function pg_temp.remito(
  p_nombre text,
  p_cliente uuid,
  p_items jsonb,
  p_emitir boolean default true,
  p_pv integer default 9201,
  p_lista uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := guardar_remito(
    null,
    jsonb_build_object(
      'punto_venta', p_pv, 'cliente_id', p_cliente, 'fecha', '2026-11-04', 'condicion_pago', 'contado',
      'lista_precio_id', p_lista, 'domicilio_entrega', 'Ruta 22 km 1000', 'valor_declarado', 100
    ),
    p_items
  );
  insert into rem values (p_nombre, v_id);
  if p_emitir then
    perform emitir_remito(v_id);
  end if;
  return v_id;
end;
$$;

create function pg_temp.r(p_nombre text) returns uuid language sql as $$
  select id from rem where nombre = p_nombre
$$;

-- Ítem de un remito por su posición (1, 2, ...).
create function pg_temp.ri(p_nombre text, p_pos integer) returns uuid language sql as $$
  select i.id from remito_item i where i.remito_id = pg_temp.r(p_nombre) order by i.orden, i.id offset p_pos - 1 limit 1
$$;

create function pg_temp.f(p_nombre text) returns uuid language sql as $$
  select id from fac where nombre = p_nombre
$$;

create function pg_temp.pendiente(p_nombre text, p_pos integer) returns numeric language sql as $$
  select pendiente from v_remito_item_pendiente where remito_item_id = pg_temp.ri(p_nombre, p_pos)
$$;

create function pg_temp.estado(p_nombre text) returns text language sql as $$
  select estado from v_remito_estado where remito_id = pg_temp.r(p_nombre)
$$;

-- ---------------------------------------------------------------------
-- guardar_remito
-- ---------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.remito('r1', 'c0000000-0000-0000-0000-000000000031', '[
      {"descripcion": "Lona", "cantidad": 300, "precio_unitario": 10, "alicuota_iva": 21, "bultos": 3, "unidad": "u",
       "importe": 3000, "iva": 630},
      {"descripcion": "Correa", "cantidad": 50, "precio_unitario": 4, "descuento_pct": 10, "gravado": false,
       "bultos": 1, "importe": 180}
    ]', p_lista => '10000000-0000-0000-0000-000000000033')$$,
  'guardar_remito crea un remito con sus ítems'
);
select results_eq(
  $$select estado, numero, condicion_pago, domicilio_entrega, valor_declarado, bultos_total, lista_precio_id
    from remito where id = pg_temp.r('r1')$$,
  $$values ('emitido'::text, 1::bigint, 'contado'::text, 'Ruta 22 km 1000'::text, 100::numeric, 4,
            '10000000-0000-0000-0000-000000000033'::uuid)$$,
  'La cabecera queda como se mandó y los bultos totales salen de los ítems'
);
select results_eq(
  $$select descripcion, cantidad, gravado, alicuota_iva, bultos from remito_item
    where remito_id = pg_temp.r('r1') order by orden$$,
  $$values ('Lona'::text, 300::numeric, true, 21::numeric, 3), ('Correa'::text, 50::numeric, false, null::numeric, 1)$$,
  'Los ítems se guardan en orden'
);

do $$ begin perform pg_temp.remito('borr', 'c0000000-0000-0000-0000-000000000031',
  '[{"descripcion": "Malla", "cantidad": 5, "alicuota_iva": 21}]', false); end $$;
select lives_ok(
  $$select guardar_remito(pg_temp.r('borr'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000032", "observaciones": "cambiado"}',
      '[{"descripcion": "Malla nueva", "cantidad": 7, "alicuota_iva": 21, "bultos": 2}]')$$,
  'guardar_remito actualiza un borrador, cliente incluido'
);
select results_eq(
  $$select r.cliente_id, r.observaciones, r.bultos_total, (select string_agg(descripcion, ',') from remito_item
    where remito_id = r.id) from remito r where r.id = pg_temp.r('borr')$$,
  $$values ('c0000000-0000-0000-0000-000000000032'::uuid, 'cambiado'::text, 2, 'Malla nueva'::text)$$,
  'Los ítems del borrador se reemplazan'
);

do $$ begin perform pg_temp.remito('r2', 'c0000000-0000-0000-0000-000000000031',
  '[{"descripcion": "Gancho", "cantidad": 20, "precio_unitario": 5, "alicuota_iva": 10.5, "importe": 100, "iva": 10.5}]'); end $$;
select lives_ok(
  $$select guardar_remito(pg_temp.r('r2'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000031", "fecha": "2026-11-04",
        "observaciones": "editado", "lista_precio_id": "10000000-0000-0000-0000-000000000032"}',
      '[{"descripcion": "Gancho", "cantidad": 20, "precio_unitario": 5, "alicuota_iva": 10.5, "importe": 100, "iva": 10.5}]')$$,
  'guardar_remito edita un emitido sin nada facturado'
);
select throws_ok(
  $$select guardar_remito(pg_temp.r('r2'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000032", "fecha": "2026-11-04"}',
      '[{"descripcion": "Gancho", "cantidad": 20, "alicuota_iva": 10.5}]')$$,
  'RM006', null, 'guardar_remito no cambia el cliente de un emitido'
);
select throws_ok(
  $$select guardar_remito('f0000000-0000-0000-0000-000000000000', '{"punto_venta": 9201}', '[]')$$,
  'RM004', null, 'guardar_remito avisa si el remito no existe'
);

-- trg_remito_con_items es diferido y el archivo no hace commit: pasar a
-- inmediato evalúa lo pendiente, igual que al cerrar la transacción.
select throws_ok(
  $$select guardar_remito(pg_temp.r('r2'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000031", "fecha": "2026-11-04"}',
      '[]');
    set constraints trg_remito_con_items immediate$$,
  'RM005', null, 'guardar_remito no deja un emitido sin ítems'
);
set constraints trg_remito_con_items deferred;
select lives_ok(
  $$select guardar_remito(pg_temp.r('r2'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000031", "fecha": "2026-11-04"}',
      '[{"descripcion": "Gancho", "cantidad": 20, "precio_unitario": 5, "alicuota_iva": 10.5, "importe": 100, "iva": 10.5}]');
    set constraints trg_remito_con_items immediate$$,
  'guardar_remito reemplaza los ítems de un emitido y al cerrar sigue con ítems'
);
set constraints trg_remito_con_items deferred;
select throws_ok(
  $$update remito_item set remito_id = pg_temp.r('borr') where remito_id = pg_temp.r('r2');
    set constraints trg_remito_con_items immediate$$,
  'RM005', null, 'Mover el único ítem de un emitido a otro remito lo dejaría sin ítems'
);
set constraints trg_remito_con_items deferred;

do $$ begin perform pg_temp.remito('r3', 'c0000000-0000-0000-0000-000000000032',
  '[{"descripcion": "Lona", "cantidad": 10, "precio_unitario": 1, "alicuota_iva": 21}]'); end $$;
do $$ begin
  perform pg_temp.remito('anul', 'c0000000-0000-0000-0000-000000000031',
    '[{"descripcion": "Lona", "cantidad": 10, "alicuota_iva": 21}]', p_lista => '10000000-0000-0000-0000-000000000031');
  perform anular_remito(pg_temp.r('anul'));
end $$;
select throws_ok(
  $$select guardar_remito(pg_temp.r('anul'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000031", "fecha": "2026-11-04"}',
      '[{"descripcion": "Lona", "cantidad": 10, "alicuota_iva": 21}]')$$,
  'RM001', null, 'guardar_remito no toca un anulado'
);

-- ---------------------------------------------------------------------
-- Sin facturar: todo pendiente
-- ---------------------------------------------------------------------

select is(pg_temp.pendiente('r1', 1), 300::numeric, 'Sin facturar, todo el ítem está pendiente');
select is(pg_temp.estado('r1'), 'emitido', 'Sin nada facturado, el remito está emitido');
select is(pg_temp.estado('borr'), 'borrador', 'Un borrador figura como borrador');
select is(pg_temp.estado('anul'), 'anulado', 'Un anulado figura como anulado');

-- ---------------------------------------------------------------------
-- facturar_remitos: validaciones
-- ---------------------------------------------------------------------

select throws_ok($$select facturar_remitos('[]', 9201)$$, 'RM009', null, 'Hay que elegir al menos un ítem');
select throws_ok($$select facturar_remitos(null, 9201)$$, 'RM009', null, 'Sin ítems no se factura');
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 0)), 9201)$$,
  'RM009', null, 'La cantidad a facturar es mayor que cero'
);
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 1),
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 1)), 9201)$$,
  'RM009', null, 'Un ítem de remito va una sola vez'
);
select throws_ok(
  $$select facturar_remitos('[{"remito_item_id": "f0000000-0000-0000-0000-000000000000", "cantidad": 1}]', 9201)$$,
  'RM004', null, 'El ítem de remito tiene que existir'
);
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 1),
      jsonb_build_object('remito_item_id', pg_temp.ri('r3', 1), 'cantidad', 1)), 9201)$$,
  'RM009', null, 'Remitos de clientes distintos no van en una misma factura'
);
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(jsonb_build_object('remito_item_id', pg_temp.ri('borr', 1), 'cantidad', 1)), 9201)$$,
  'RM009', null, 'Un borrador no se factura'
);
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(jsonb_build_object('remito_item_id', pg_temp.ri('anul', 1), 'cantidad', 1)), 9201)$$,
  'RM009', null, 'Un anulado no se factura'
);
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 301)), 9201)$$,
  'RM010', null, 'No se factura más que lo pendiente'
);
select throws_ok(
  $$select facturar_remitos(jsonb_build_array(jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 1)), 9203)$$,
  'RM007', null, 'El punto de venta de la factura tiene que estar activo'
);

-- ---------------------------------------------------------------------
-- facturar_remitos: 100 de 300 y dos remitos del mismo cliente
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into fac select 'f1', (facturar_remitos(jsonb_build_array(
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 100),
      jsonb_build_object('remito_item_id', pg_temp.ri('r2', 1), 'cantidad', 20)), 9201)).id$$,
  'Se facturan ítems de dos remitos del mismo cliente en una factura'
);
select results_eq(
  $$select clase, estado, letra, tipo_arca, cliente_id, condicion_pago, lista_precio_id, fecha, neto, no_gravado, iva, total,
           ambiente
    from comprobante where id = pg_temp.f('f1')$$,
  $$values ('factura'::text, 'borrador'::text, 'X'::text, null::integer, 'c0000000-0000-0000-0000-000000000031'::uuid,
            'contado'::text, '10000000-0000-0000-0000-000000000033'::uuid,
            (now() at time zone 'America/Argentina/Buenos_Aires')::date, 1100::numeric, 0::numeric, 0::numeric,
            1100::numeric, null::text)$$,
  'Borrador de factura X: cliente, condición y lista del primer remito, fecha de hoy y totales de lo facturado'
);
select results_eq(
  $$select descripcion, unidad, cantidad, precio_unitario, alicuota_iva, importe, iva, remito_item_id
    from comprobante_item where comprobante_id = pg_temp.f('f1') order by orden$$,
  $$values ('Lona'::text, 'u'::text, 100::numeric, 10::numeric, 21::numeric, 1000::numeric, 0::numeric, pg_temp.ri('r1', 1)),
           ('Gancho'::text, null::text, 20::numeric, 5::numeric, 10.5::numeric, 100::numeric, 0::numeric, pg_temp.ri('r2', 1))$$,
  'Un ítem por ítem de remito, con su precio y alícuota, la cantidad pedida y el vínculo'
);
select is(pg_temp.pendiente('r1', 1), 200::numeric, 'Facturar 100 de 300 deja 200 pendientes');
select is(pg_temp.estado('r1'), 'parcial', 'Con algo facturado y algo pendiente, el remito está parcial');
select is(pg_temp.estado('r2'), 'facturado', 'Sin nada pendiente, el remito está facturado');
select results_eq(
  $$select cantidad, facturado, pendiente from v_remito_estado where remito_id = pg_temp.r('r1')$$,
  $$values (350::numeric, 100::numeric, 250::numeric)$$,
  'El resumen del remito suma cantidades, facturado y pendiente'
);
select is(
  (select estado from remito where id = pg_temp.r('r1')), 'emitido',
  'El estado guardado sigue emitido: parcial y facturado se derivan'
);

-- ---------------------------------------------------------------------
-- Un remito con algo facturado no se modifica
-- ---------------------------------------------------------------------

select throws_ok(
  $$update remito set observaciones = 'cambio' where id = pg_temp.r('r1')$$,
  'RM008', null, 'La cabecera de un remito facturado no se modifica'
);
select throws_ok(
  $$insert into remito_item (remito_id, descripcion, cantidad, alicuota_iva) values (pg_temp.r('r1'), 'Más', 1, 21)$$,
  'RM008', null, 'A un remito facturado no se le agregan ítems'
);
select throws_ok(
  $$update remito_item set bultos = 9 where id = pg_temp.ri('r1', 2)$$,
  'RM008', null, 'Tampoco se cambia un ítem sin facturar de un remito facturado'
);
select throws_ok(
  $$delete from remito_item where id = pg_temp.ri('r1', 2)$$,
  'RM008', null, 'Los ítems de un remito facturado no se borran'
);
select throws_ok(
  $$select guardar_remito(pg_temp.r('r1'),
      '{"punto_venta": 9201, "cliente_id": "c0000000-0000-0000-0000-000000000031", "fecha": "2026-11-04"}',
      '[{"descripcion": "Lona", "cantidad": 300, "alicuota_iva": 21}]')$$,
  'RM008', null, 'guardar_remito no modifica un remito facturado'
);
select throws_ok(
  $$select anular_remito(pg_temp.r('r1'))$$,
  'RM008', null, 'Un remito con algo facturado no se anula'
);

-- ---------------------------------------------------------------------
-- Tope de lo pendiente con un segundo borrador y por SQL directo
-- ---------------------------------------------------------------------

select throws_ok(
  $$select facturar_remitos(jsonb_build_array(jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 201)), 9201)$$,
  'RM010', null, 'Un segundo borrador no factura más que lo que dejó pendiente el primero'
);
select lives_ok(
  $$insert into fac select 'f2', (facturar_remitos(jsonb_build_array(
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 200)), 9201)).id$$,
  'Un segundo borrador factura lo que queda pendiente'
);
select is(pg_temp.pendiente('r1', 1), 0::numeric, 'Entre los dos borradores el ítem quedó sin pendiente');
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, alicuota_iva, remito_item_id)
    values (pg_temp.f('f2'), 'Lona', 1, 21, pg_temp.ri('r1', 1))$$,
  'RM010', null, 'La base no deja facturar de más ni con SQL directo'
);
select throws_ok(
  $$update comprobante_item set cantidad = 201 where comprobante_id = pg_temp.f('f2')$$,
  'RM010', null, 'Ni subiendo la cantidad de un ítem ya vinculado'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, alicuota_iva, remito_item_id)
    values (pg_temp.f('f2'), 'Lona', 1, 21, pg_temp.ri('r3', 1))$$,
  'RM009', null, 'Un ítem de factura no apunta a un remito de otro cliente'
);
select throws_ok(
  $$insert into comprobante_item (comprobante_id, descripcion, cantidad, alicuota_iva, remito_item_id)
    values (pg_temp.f('f2'), 'Malla', 1, 21, pg_temp.ri('borr', 1))$$,
  'RM009', null, 'Un ítem de factura no apunta a un remito en borrador'
);
select throws_ok(
  $$update comprobante set cliente_id = 'c0000000-0000-0000-0000-000000000032' where id = pg_temp.f('f2')$$,
  'RM009', null, 'No cambia el cliente de una factura con ítems de remito'
);

-- ---------------------------------------------------------------------
-- Volver a guardar el borrador conserva el vínculo
-- ---------------------------------------------------------------------

-- Como lo manda hoy el editor de comprobantes: los ítems sin remito_item_id.
create function pg_temp.items_sin_vinculo(p_comprobante uuid, p_cambios jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_agg(
           jsonb_build_object(
             'producto_id', i.producto_id, 'codigo', i.codigo, 'descripcion', i.descripcion,
             'observaciones', i.observaciones, 'unidad', i.unidad,
             'cantidad', coalesce((p_cambios->>i.descripcion)::numeric, i.cantidad),
             'precio_unitario', i.precio_unitario, 'descuento_pct', i.descuento_pct, 'gravado', i.gravado,
             'alicuota_iva', i.alicuota_iva, 'importe', i.importe, 'iva', i.iva
           ) order by i.orden)
  from comprobante_item i where i.comprobante_id = p_comprobante
$$;

create function pg_temp.cabecera(p_comprobante uuid, p_clase text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'punto_venta', c.punto_venta, 'clase', coalesce(p_clase, c.clase), 'letra', c.letra, 'tipo_arca', c.tipo_arca,
    'fecha', c.fecha, 'fecha_vencimiento_pago', c.fecha_vencimiento_pago, 'cliente_id', c.cliente_id,
    'lista_precio_id', c.lista_precio_id, 'condicion_pago', c.condicion_pago, 'observaciones', c.observaciones,
    'neto', c.neto, 'no_gravado', c.no_gravado, 'iva', c.iva, 'total', c.total
  ) from comprobante c where c.id = p_comprobante
$$;

select lives_ok(
  $$select guardar_borrador_comprobante(pg_temp.f('f1'), pg_temp.cabecera(pg_temp.f('f1')),
      pg_temp.items_sin_vinculo(pg_temp.f('f1'), '{"Lona": 90}'), null)$$,
  'Se vuelve a guardar el borrador desde el editor, bajando una cantidad'
);
select results_eq(
  $$select descripcion, cantidad, remito_item_id from comprobante_item where comprobante_id = pg_temp.f('f1') order by orden$$,
  $$values ('Lona'::text, 90::numeric, pg_temp.ri('r1', 1)), ('Gancho'::text, 20::numeric, pg_temp.ri('r2', 1))$$,
  'Volver a guardar el borrador conserva remito_item_id'
);
select is(pg_temp.pendiente('r1', 1), 10::numeric, 'La cantidad que se bajó vuelve a quedar pendiente');
select throws_ok(
  $$select guardar_borrador_comprobante(pg_temp.f('f1'), pg_temp.cabecera(pg_temp.f('f1')),
      pg_temp.items_sin_vinculo(pg_temp.f('f1'), '{"Lona": 101}'), null)$$,
  'RM010', null, 'Volver a guardar el borrador tampoco factura de más'
);
select lives_ok(
  $$select guardar_borrador_comprobante(pg_temp.f('f1'), pg_temp.cabecera(pg_temp.f('f1')),
      (select jsonb_agg(case when e->>'descripcion' = 'Gancho' then e || '{"remito_item_id": null}'
                             else e || jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1)) end)
       from jsonb_array_elements(pg_temp.items_sin_vinculo(pg_temp.f('f1'))) e), null)$$,
  'El editor puede mandar remito_item_id explícito (null lo desvincula)'
);
select results_eq(
  $$select descripcion, remito_item_id from comprobante_item where comprobante_id = pg_temp.f('f1') order by orden$$,
  $$values ('Lona'::text, pg_temp.ri('r1', 1)), ('Gancho'::text, null::uuid)$$,
  'Manda el remito_item_id explícito de cada ítem'
);
select is(pg_temp.estado('r2'), 'emitido', 'Desvinculado su único ítem, el remito vuelve a emitido');

-- ---------------------------------------------------------------------
-- Notas y copias no llevan el vínculo
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into fac select 'nc', guardar_borrador_comprobante(null, pg_temp.cabecera(pg_temp.f('f1'), 'nota_credito'),
      pg_temp.items_sin_vinculo(pg_temp.f('f1')), null)$$,
  'Una nota de crédito con los ítems de la factura se guarda'
);
select is(
  (select count(*)::int from comprobante_item where comprobante_id = pg_temp.f('nc') and remito_item_id is not null),
  0, 'La nota de crédito no lleva remito_item_id'
);
select throws_ok(
  $$select guardar_borrador_comprobante(null, pg_temp.cabecera(pg_temp.f('f1'), 'nota_credito'),
      jsonb_build_array(jsonb_build_object('descripcion', 'Lona', 'cantidad', 1, 'alicuota_iva', 21,
                                           'remito_item_id', pg_temp.ri('r1', 1))), null)$$,
  'RM009', null, 'Una nota de crédito no puede apuntar a un remito'
);
select lives_ok(
  $$insert into fac select 'copia', guardar_borrador_comprobante(null, pg_temp.cabecera(pg_temp.f('f1')),
      pg_temp.items_sin_vinculo(pg_temp.f('f1')), null)$$,
  'Duplicar la factura (como la app: ítems sin remito_item_id)'
);
select is(
  (select count(*)::int from comprobante_item where comprobante_id = pg_temp.f('copia') and remito_item_id is not null),
  0, 'La copia no lleva remito_item_id'
);

-- ---------------------------------------------------------------------
-- Cuenta corriente: ni el remito ni el borrador
-- ---------------------------------------------------------------------

select is(
  (select count(*)::int from v_cuenta_corriente where cliente_id = 'c0000000-0000-0000-0000-000000000031'),
  0, 'Ni los remitos ni los borradores de factura aparecen en la cuenta corriente'
);

-- ---------------------------------------------------------------------
-- Borrar el borrador devuelve las cantidades y desbloquea
-- ---------------------------------------------------------------------

select lives_ok($$delete from comprobante where id = pg_temp.f('f2')$$, 'Se borra el segundo borrador');
select is(pg_temp.pendiente('r1', 1), 210::numeric, 'Borrar el borrador devuelve sus cantidades a pendiente');
select is(pg_temp.estado('r1'), 'parcial', 'Con el primer borrador todavía vigente, sigue parcial');
select lives_ok($$delete from comprobante where id = pg_temp.f('f1')$$, 'Se borra el primer borrador');
select is(pg_temp.pendiente('r1', 1), 300::numeric, 'Sin borradores, el ítem vuelve a estar todo pendiente');
select is(pg_temp.estado('r1'), 'emitido', 'Sin nada facturado, el remito vuelve a emitido');
select lives_ok(
  $$update remito set observaciones = 'ya se puede' where id = pg_temp.r('r1')$$,
  'Sin nada facturado, el remito se vuelve a editar'
);

-- ---------------------------------------------------------------------
-- Todo facturado y letra por condición de IVA en un punto electrónico
-- ---------------------------------------------------------------------

select lives_ok(
  $$insert into fac select 'total', (facturar_remitos(jsonb_build_array(
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 1), 'cantidad', 300),
      jsonb_build_object('remito_item_id', pg_temp.ri('r1', 2), 'cantidad', 50)), 9202)).id$$,
  'Se factura todo el remito en un punto de venta electrónico'
);
select results_eq(
  $$select letra, tipo_arca, ambiente, neto, no_gravado, iva, total from comprobante where id = pg_temp.f('total')$$,
  $$values ('A'::text, 1, 'homologacion'::text, 3000::numeric, 180::numeric, 630::numeric, 3810::numeric)$$,
  'Cliente responsable inscripto en punto electrónico: factura A con IVA por alícuota'
);
select results_eq(
  $$select gravado, alicuota_iva, importe, iva from comprobante_item where comprobante_id = pg_temp.f('total') order by orden$$,
  $$values (true, 21::numeric, 3000::numeric, 630::numeric), (false, null::numeric, 180::numeric, 0::numeric)$$,
  'Los ítems conservan gravado, alícuota y descuento del remito'
);
select is(pg_temp.estado('r1'), 'facturado', 'Todo facturado: el remito está facturado');
select throws_ok(
  $$select anular_remito(pg_temp.r('r1'))$$,
  'RM008', null, 'Un remito facturado no se anula'
);

-- ---------------------------------------------------------------------
-- Advertencia 1: la marca de la transacción no alcanza para emitir o anular
-- ---------------------------------------------------------------------

do $$ begin
  perform pg_temp.remito('falso', 'c0000000-0000-0000-0000-000000000031',
    '[{"descripcion": "Lona", "cantidad": 1, "alicuota_iva": 21}]', false);
  perform pg_temp.remito('falso_vacio', 'c0000000-0000-0000-0000-000000000031', '[]', false);
  perform pg_temp.remito('falso_inactivo', 'c0000000-0000-0000-0000-000000000031',
    '[{"descripcion": "Lona", "cantidad": 1, "alicuota_iva": 21}]', false, 9203);
end $$;

select throws_ok(
  $$select set_config('remito.emitiendo', pg_temp.r('falso')::text, true);
    update remito set estado = 'emitido', numero = 999, emitido_en = now() where id = pg_temp.r('falso')$$,
  'RM002', null, 'Con la marca falsificada, el número tiene que ser el siguiente del punto de venta'
);
select throws_ok(
  $$select set_config('remito.emitiendo', pg_temp.r('falso_vacio')::text, true);
    update remito set estado = 'emitido', numero = (select max(numero) + 1 from remito where punto_venta = 9201),
      emitido_en = now() where id = pg_temp.r('falso_vacio')$$,
  'RM005', null, 'Con la marca falsificada, un remito sin ítems no se emite'
);
select throws_ok(
  $$select set_config('remito.emitiendo', pg_temp.r('falso_inactivo')::text, true);
    update remito set estado = 'emitido', numero = 1, emitido_en = now() where id = pg_temp.r('falso_inactivo')$$,
  'RM007', null, 'Con la marca falsificada, no se emite en un punto de venta inactivo'
);
select throws_ok(
  $$select set_config('remito.anulando', pg_temp.r('r1')::text, true);
    update remito set estado = 'anulado', anulado_en = now() where id = pg_temp.r('r1')$$,
  'RM008', null, 'Con la marca falsificada, un remito facturado no se anula'
);
select lives_ok(
  $$select set_config('remito.emitiendo', pg_temp.r('falso')::text, true);
    update remito set estado = 'emitido', numero = (select max(numero) + 1 from remito where punto_venta = 9201),
      emitido_en = '2020-01-01' where id = pg_temp.r('falso');
    select set_config('remito.emitiendo', '', true)$$,
  'Con la marca y todo lo que pide emitir_remito, la emisión pasa'
);
select ok(
  (select emitido_en > now() - interval '1 minute' from remito where id = pg_temp.r('falso')),
  'La fecha de emisión la pone el trigger, no la del UPDATE'
);
select is(
  (select current_setting('remito.emitiendo', true) || current_setting('remito.anulando', true)), '',
  'Las marcas quedan limpias'
);

-- ---------------------------------------------------------------------
-- Advertencia 2: los ítems bloquean la fila del remito
-- ---------------------------------------------------------------------

-- La clave foránea del ítem ya toma "For Key Share" sobre el remito, que
-- no frena una lectura del estado en paralelo; el trigger tiene que tomar
-- "For Update", el mismo bloqueo que anular_remito y facturar_remitos.
do $$ begin perform pg_temp.remito('candado', 'c0000000-0000-0000-0000-000000000031', '[]', false); end $$;
insert into remito_item (remito_id, descripcion, cantidad, alicuota_iva) values (pg_temp.r('candado'), 'Lona', 1, 21);
reset role;
create extension if not exists pgrowlocks with schema extensions;
select is(
  (select modes from extensions.pgrowlocks('public.remito')
   where locked_row = (select ctid from remito where id = pg_temp.r('candado'))),
  array['For Update'],
  'Agregar un ítem bloquea la fila del remito for update (así no se cruza con anular_remito)'
);
set local role authenticated;

-- ---------------------------------------------------------------------
-- Advertencia 3: borrar una lista de precios usada por un remito
-- anulado o facturado
-- ---------------------------------------------------------------------

select throws_ok(
  $$update remito set lista_precio_id = null where id = pg_temp.r('anul')$$,
  'RM001', null, 'A mano, un anulado sigue sin cambiar su lista'
);

do $$ begin
  perform pg_temp.remito('con_lista', 'c0000000-0000-0000-0000-000000000031',
    '[{"descripcion": "Lona", "cantidad": 4, "alicuota_iva": 21}]', p_lista => '10000000-0000-0000-0000-000000000032');
  insert into fac select 'con_lista', (facturar_remitos(jsonb_build_array(
    jsonb_build_object('remito_item_id', pg_temp.ri('con_lista', 1), 'cantidad', 1)), 9201)).id;
end $$;
select throws_ok(
  $$update remito set lista_precio_id = null where id = pg_temp.r('con_lista')$$,
  'RM008', null, 'A mano, un facturado sigue sin cambiar su lista'
);

reset role;
select lives_ok(
  $$delete from lista_precio where id in ('10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000032')$$,
  'Se borran listas de precios usadas por un remito anulado y por uno facturado'
);
set local role authenticated;
select results_eq(
  $$select estado, lista_precio_id from remito where id in (pg_temp.r('anul'), pg_temp.r('con_lista')) order by numero$$,
  $$values ('anulado'::text, null::uuid), ('emitido'::text, null::uuid)$$,
  'Los remitos quedan sin lista y en su estado'
);
select is(pg_temp.estado('con_lista'), 'parcial', 'El remito con algo facturado sigue parcial');

select * from finish();
rollback;

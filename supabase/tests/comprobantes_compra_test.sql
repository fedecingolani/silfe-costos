-- =====================================================================
-- Tests de los comprobantes de compra: estructura, permisos, totales por
-- letra (A/M discriminan IVA, B/C no), alta y reutilización de artículos
-- del proveedor, materia prima tomada del artículo, confirmación,
-- anulación, número único por proveedor, inmutabilidad y borrado.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(78);

-- ---------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------

select has_table('public', t, format('Existe %s', t))
from unnest(array['comprobante_compra', 'comprobante_compra_item', 'comprobante_compra_percepcion']) as t;

select has_function('public', 'guardar_comprobante_compra', array['uuid', 'jsonb', 'jsonb', 'jsonb'],
  'Existe guardar_comprobante_compra');
select has_function('public', 'confirmar_comprobante_compra', array['uuid'], 'Existe confirmar_comprobante_compra');
select has_function('public', 'anular_comprobante_compra', array['uuid'], 'Existe anular_comprobante_compra');
select has_index('public', 'comprobante_compra', 'comprobante_compra_numero_unico',
  'Índice único del número del proveedor');
select col_default_is('public', 'comprobante_compra', 'estado', 'borrador', 'Un comprobante nace en borrador');
select has_trigger('public', 'comprobante_compra_item', 'trg_comprobante_compra_con_items',
  'Un confirmado o anulado no se queda sin renglones');

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
  format('%s tiene RLS habilitada', t)
)
from unnest(array['comprobante_compra', 'comprobante_compra_item', 'comprobante_compra_percepcion']) as t;

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['comprobante_compra', 'comprobante_compra_item', 'comprobante_compra_percepcion']) as t;

select ok(
  not has_function_privilege('anon', f, 'execute'),
  format('anon no ejecuta %s', f)
)
from unnest(array[
  'public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb)',
  'public.confirmar_comprobante_compra(uuid)',
  'public.anular_comprobante_compra(uuid)'
]) as f;

-- ---------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------

insert into unidad_medida (id, codigo, nombre, magnitud) values
  ('00000000-0000-4000-8000-0000000001a1', 'test-cc-kg', 'Kilo de prueba compras', 'MASA');

insert into materia_prima (id, codigo, nombre, unidad_compra_id, unidad_uso_id) values
  ('00000000-0000-4000-8000-0000000001b1', 'TEST-CC-MP-1', 'Soga 8mm de prueba',
   '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a1'),
  ('00000000-0000-4000-8000-0000000001b2', 'TEST-CC-MP-2', 'Soga 10mm de prueba',
   '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a1');

insert into proveedor (id, nombre) values
  ('00000000-0000-4000-8000-0000000001c1', 'Proveedor compras 1'),
  ('00000000-0000-4000-8000-0000000001c2', 'Proveedor compras 2');

insert into proveedor_articulo (id, proveedor_id, codigo, descripcion, unidad, materia_prima_id) values
  ('00000000-0000-4000-8000-0000000001d1', '00000000-0000-4000-8000-0000000001c1',
   'SG-8', 'SOGA PP diam 8MM', 'rollo', '00000000-0000-4000-8000-0000000001b1'),
  ('00000000-0000-4000-8000-0000000001d2', '00000000-0000-4000-8000-0000000001c2',
   'SG-8', 'SOGA PP diam 8MM', 'rollo', '00000000-0000-4000-8000-0000000001b1');
insert into proveedor_articulo (id, proveedor_id, descripcion) values
  ('00000000-0000-4000-8000-0000000001d3', '00000000-0000-4000-8000-0000000001c1', 'Flete'),
  ('00000000-0000-4000-8000-0000000001d4', '00000000-0000-4000-8000-0000000001c1', 'Hilo');

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

create temp table cc (nombre text primary key, id uuid);

-- Cabecera de un comprobante del proveedor 1 con la letra y el número dados.
create function pg_temp.cabecera(p_letra text, p_numero bigint, p_tipo text default 'factura',
  p_proveedor uuid default '00000000-0000-4000-8000-0000000001c1')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'proveedor_id', p_proveedor, 'tipo', p_tipo, 'letra', p_letra,
    'punto_venta', 3, 'numero', p_numero, 'fecha', '2026-11-01',
    'fecha_vencimiento', '2026-12-01', 'total', 1, 'iva', 1
  );
$$;

-- ---------------------------------------------------------------------
-- Letra A: totales, alta del artículo y materia prima del artículo
-- ---------------------------------------------------------------------

insert into cc values ('A', guardar_comprobante_compra(
  null,
  pg_temp.cabecera('A', 101),
  jsonb_build_array(
    jsonb_build_object('proveedor_articulo_id', '00000000-0000-4000-8000-0000000001d1',
      'descripcion', 'Soga 8 mm (como la factura)', 'materia_prima_id', '00000000-0000-4000-8000-0000000001b2',
      'cantidad', 10, 'precio_unitario', 100, 'descuento_pct', 10, 'alicuota_iva', 21,
      'importe', 1, 'iva', 1),
    jsonb_build_object('articulo_nuevo', jsonb_build_object(
        'codigo', 'SG-10', 'descripcion', 'SOGA PP diam 10MM', 'unidad', 'rollo',
        'materia_prima_id', '00000000-0000-4000-8000-0000000001b2'),
      'cantidad', 3, 'precio_unitario', 33.3333, 'alicuota_iva', 10.5),
    jsonb_build_object('descripcion', 'Servicio exento', 'materia_prima_id', '00000000-0000-4000-8000-0000000001b1',
      'cantidad', 1, 'precio_unitario', 50, 'exento', true),
    jsonb_build_object('descripcion', 'Flete no gravado', 'cantidad', 1, 'precio_unitario', 25)
  ),
  '[{"tipo": "iva", "importe": 12.34},
    {"tipo": "iibb", "jurisdiccion": "Buenos Aires", "importe": 5.66},
    {"tipo": "otro", "descripcion": "Impuesto municipal", "importe": 2}]'::jsonb
));

select is(
  (select array[neto_gravado, no_gravado, exento, iva, percepcion_iva, percepcion_iibb, otros_impuestos, total]
   from comprobante_compra where id = (select id from cc where nombre = 'A')),
  array[1000, 25, 50, 199.50, 12.34, 5.66, 2, 1294.50]::numeric[],
  'Letra A: neto, no gravado, exento, IVA, percepciones y total calculados en la base'
);
select is(
  (select array_agg(importe order by orden) from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'A')),
  array[900, 100, 50, 25]::numeric[],
  'Importe del renglón: cantidad × precio × (1 − descuento), a 2 decimales'
);
select is(
  (select array_agg(iva order by orden) from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'A')),
  array[189, 10.50, 0, 0]::numeric[],
  'IVA del renglón por alícuota; exento y no gravado sin IVA'
);
select is(
  (select materia_prima_id from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'A') and orden = 0),
  '00000000-0000-4000-8000-0000000001b1'::uuid,
  'La materia prima sale del artículo, no de lo que manda la app'
);
select is(
  (select array[codigo_proveedor, descripcion] from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'A') and orden = 0),
  array['SG-8', 'Soga 8 mm (como la factura)'],
  'La descripción queda tal cual; el código, si no viene, es el del artículo'
);
select is(
  (select count(*)::int from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'A') and orden in (2, 3)
     and materia_prima_id is null and proveedor_articulo_id is null),
  2,
  'Los renglones libres no tienen materia prima'
);
select is(
  (select array[a.materia_prima_id::text, a.unidad, a.factor_conversion::text]
   from proveedor_articulo a
   where a.proveedor_id = '00000000-0000-4000-8000-0000000001c1' and a.codigo = 'SG-10'),
  array['00000000-0000-4000-8000-0000000001b2', 'rollo', '1.00000000'],
  'Un artículo nuevo se crea en el catálogo del proveedor con su materia prima'
);
select is(
  (select i.proveedor_articulo_id from comprobante_compra_item i
   where i.comprobante_compra_id = (select id from cc where nombre = 'A') and i.orden = 1),
  (select a.id from proveedor_articulo a
   where a.proveedor_id = '00000000-0000-4000-8000-0000000001c1' and a.codigo = 'SG-10'),
  'El renglón apunta al artículo creado'
);
select is(
  (select array[estado, creado_por::text] from comprobante_compra where id = (select id from cc where nombre = 'A')),
  array['borrador', '11111111-1111-1111-1111-111111111111'],
  'Se guarda en borrador con el usuario que lo cargó'
);

-- Volver a guardar reemplaza renglones y percepciones y recalcula.
select lives_ok(
  format($$select guardar_comprobante_compra(%L, %L::jsonb,
    '[{"proveedor_articulo_id": "00000000-0000-4000-8000-0000000001d1", "cantidad": 1, "precio_unitario": 100, "alicuota_iva": 21}]',
    '[]')$$, (select id from cc where nombre = 'A'), pg_temp.cabecera('A', 101)),
  'Un borrador se vuelve a guardar'
);
select is(
  (select array[neto_gravado, iva, percepcion_iva, total] from comprobante_compra where id = (select id from cc where nombre = 'A')),
  array[100, 21, 0, 121]::numeric[],
  'Al volver a guardar se recalculan los totales'
);

-- ---------------------------------------------------------------------
-- Reutilización de artículos
-- ---------------------------------------------------------------------

insert into cc values ('B', guardar_comprobante_compra(
  null,
  pg_temp.cabecera('B', 201),
  jsonb_build_array(
    jsonb_build_object('articulo_nuevo', jsonb_build_object('codigo', ' sg-10 ', 'descripcion', 'Otra descripción'),
      'cantidad', 2, 'precio_unitario', 121),
    jsonb_build_object('articulo_nuevo', jsonb_build_object('descripcion', '  flete  '),
      'cantidad', 1, 'precio_unitario', 10, 'exento', true),
    jsonb_build_object('articulo_nuevo', jsonb_build_object('descripcion', 'HILO',
        'materia_prima_id', '00000000-0000-4000-8000-0000000001b2'),
      'cantidad', 1, 'precio_unitario', 0)
  ),
  '[{"tipo": "iibb", "jurisdiccion": "Córdoba", "importe": 5}]'::jsonb
));

select is(
  (select count(*)::int from proveedor_articulo where proveedor_id = '00000000-0000-4000-8000-0000000001c1'),
  4,
  'Por código o por descripción se reutiliza el artículo existente (no se duplica)'
);
select is(
  (select array_agg(proveedor_articulo_id::text order by orden) from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'B')),
  array[
    (select id::text from proveedor_articulo where proveedor_id = '00000000-0000-4000-8000-0000000001c1' and codigo = 'SG-10'),
    '00000000-0000-4000-8000-0000000001d3',
    '00000000-0000-4000-8000-0000000001d4'
  ],
  'Los renglones apuntan a los artículos encontrados por código y por descripción'
);
select is(
  (select materia_prima_id from proveedor_articulo where id = '00000000-0000-4000-8000-0000000001d4'),
  '00000000-0000-4000-8000-0000000001b2'::uuid,
  'Un artículo sin materia prima la toma de la carga'
);
select is(
  (select array[descripcion, codigo_proveedor] from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'B') and orden = 1),
  array['Flete', null],
  'Sin descripción en el renglón, queda la del artículo'
);

-- ---------------------------------------------------------------------
-- Letras B y C: no discriminan IVA
-- ---------------------------------------------------------------------

select is(
  (select array[neto_gravado, no_gravado, exento, iva, percepcion_iibb, total]
   from comprobante_compra where id = (select id from cc where nombre = 'B')),
  array[0, 242, 10, 0, 5, 257]::numeric[],
  'Letra B: todo va a no gravado (salvo exento), sin IVA'
);
select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Con IVA", "cantidad": 1, "precio_unitario": 10, "alicuota_iva": 21}]', '[]')$$,
    pg_temp.cabecera('B', 202)),
  'CP009', null, 'Letra B: un renglón con alícuota se rechaza'
);
select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Con IVA", "cantidad": 1, "precio_unitario": 10, "alicuota_iva": 10.5}]', '[]')$$,
    pg_temp.cabecera('C', 301)),
  'CP009', null, 'Letra C: un renglón con alícuota se rechaza'
);
select lives_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Sin IVA", "cantidad": 1, "precio_unitario": 10}]', '[]')$$,
    pg_temp.cabecera('C', 302)),
  'Letra C sin alícuotas se guarda'
);
select throws_ok(
  format($$update comprobante_compra set letra = 'B' where id = %L$$, (select id from cc where nombre = 'A')),
  'CP009', null, 'No se pasa a letra B un borrador con renglones con alícuota'
);

-- ---------------------------------------------------------------------
-- Validaciones de renglones y percepciones
-- ---------------------------------------------------------------------

select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"proveedor_articulo_id": "00000000-0000-4000-8000-0000000001d2", "cantidad": 1, "precio_unitario": 10, "alicuota_iva": 21}]',
    '[]')$$, pg_temp.cabecera('A', 102)),
  'CP008', null, 'Un artículo de otro proveedor se rechaza'
);
insert into comprobante_compra_item (comprobante_compra_id, orden, descripcion, cantidad, precio_unitario, materia_prima_id)
values ((select id from cc where nombre = 'B'), 9, 'Libre con materia prima', 1, 1, '00000000-0000-4000-8000-0000000001b1');
select is(
  (select materia_prima_id from comprobante_compra_item
   where comprobante_compra_id = (select id from cc where nombre = 'B') and orden = 9),
  null,
  'Un renglón sin artículo no tiene materia prima, aunque se escriba a mano'
);
delete from comprobante_compra_item where comprobante_compra_id = (select id from cc where nombre = 'B') and orden = 9;
select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Algo", "cantidad": 1, "precio_unitario": 10, "alicuota_iva": 21}]',
    '[{"tipo": "iibb", "importe": 3}]')$$, pg_temp.cabecera('A', 103)),
  '23514', null, 'Una percepción de IIBB lleva jurisdicción'
);
select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Algo", "cantidad": 1, "precio_unitario": 10, "alicuota_iva": 22}]', '[]')$$,
    pg_temp.cabecera('A', 104)),
  '23514', null, 'La alícuota tiene que ser una de las de ARCA'
);
select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Algo", "cantidad": 0, "precio_unitario": 10}]', '[]')$$,
    pg_temp.cabecera('A', 105)),
  '23514', null, 'La cantidad es mayor que cero'
);
select throws_ok(
  $$insert into comprobante_compra (proveedor_id, tipo, letra, punto_venta, numero, fecha, estado)
    values ('00000000-0000-4000-8000-0000000001c1', 'factura', 'A', 1, 1, '2026-11-01', 'confirmado')$$,
  'CP002', null, 'Un comprobante se crea en borrador'
);

-- ---------------------------------------------------------------------
-- Confirmación
-- ---------------------------------------------------------------------

insert into cc values ('vacio', guardar_comprobante_compra(null, pg_temp.cabecera('A', 111), '[]', '[]'));
select throws_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'vacio')),
  'CP005', null, 'No se confirma un comprobante sin renglones'
);

insert into cc values ('cero', guardar_comprobante_compra(null, pg_temp.cabecera('A', 112),
  '[{"descripcion": "Bonificado", "cantidad": 1, "precio_unitario": 0}]', '[]'));
select throws_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'cero')),
  'CP006', null, 'No se confirma un comprobante con total cero'
);

insert into cc values ('sin_mp', guardar_comprobante_compra(null, pg_temp.cabecera('A', 113),
  jsonb_build_array(jsonb_build_object('articulo_nuevo', jsonb_build_object('codigo', 'SRV-1', 'descripcion', 'Servicio'),
    'cantidad', 1, 'precio_unitario', 10, 'alicuota_iva', 21)), '[]'));
select is(
  (select count(*)::int from comprobante_compra where id = (select id from cc where nombre = 'sin_mp')),
  1,
  'Un borrador con un artículo sin materia prima se guarda'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'sin_mp')),
  'CP007', null, 'No se confirma con un artículo sin materia prima'
);
-- La marca de la transacción sola no saltea las reglas: las controla el trigger.
select throws_ok(
  format($$select set_config('compras.confirmando', %L, true);
    update comprobante_compra set estado = 'confirmado' where id = %L$$,
    (select id from cc where nombre = 'cero'), (select id from cc where nombre = 'cero')),
  'CP006', null, 'Con SQL directo tampoco se confirma un comprobante con total cero'
);
select throws_ok(
  format($$select set_config('compras.confirmando', %L, true);
    update comprobante_compra set estado = 'confirmado' where id = %L$$,
    (select id from cc where nombre = 'sin_mp'), (select id from cc where nombre = 'sin_mp')),
  'CP007', null, 'Con SQL directo tampoco se confirma con un artículo sin materia prima'
);
-- Asociar la materia prima en el catálogo destraba la confirmación.
update proveedor_articulo set materia_prima_id = '00000000-0000-4000-8000-0000000001b1'
where proveedor_id = '00000000-0000-4000-8000-0000000001c1' and codigo = 'SRV-1';
select lives_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'sin_mp')),
  'Con la materia prima asociada en el catálogo, se confirma'
);
select is(
  (select materia_prima_id from comprobante_compra_item where comprobante_compra_id = (select id from cc where nombre = 'sin_mp')),
  '00000000-0000-4000-8000-0000000001b1'::uuid,
  'Al confirmar, el renglón toma la materia prima vigente del artículo'
);

select lives_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'A')),
  'Se confirma un borrador válido'
);
select is(
  (select array[estado, (confirmado_en is not null)::text] from comprobante_compra where id = (select id from cc where nombre = 'A')),
  array['confirmado', 'true'],
  'Queda confirmado con su fecha'
);
select throws_ok(
  format('select confirmar_comprobante_compra(%L)', (select id from cc where nombre = 'A')),
  'CP002', null, 'Un confirmado no se vuelve a confirmar'
);
select throws_ok(
  $$select confirmar_comprobante_compra('00000000-0000-4000-8000-00000000ffff')$$,
  'CP004', null, 'Confirmar uno inexistente avisa'
);

-- ---------------------------------------------------------------------
-- Número único por proveedor
-- ---------------------------------------------------------------------

select throws_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb, '[]', '[]')$$, pg_temp.cabecera('A', 101)),
  '23505', null, 'El mismo comprobante del mismo proveedor no se carga dos veces'
);
select lives_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb, '[]', '[]')$$, pg_temp.cabecera('A', 101, 'nota_credito')),
  'Una nota de crédito puede tener el mismo número que una factura'
);
select lives_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb, '[]', '[]')$$,
    pg_temp.cabecera('A', 101, 'factura', '00000000-0000-4000-8000-0000000001c2')),
  'Otro proveedor puede tener el mismo número'
);

-- ---------------------------------------------------------------------
-- Inmutabilidad del confirmado
-- ---------------------------------------------------------------------

select throws_ok(
  format($$select guardar_comprobante_compra(%L, %L::jsonb, '[]', '[]')$$,
    (select id from cc where nombre = 'A'), pg_temp.cabecera('A', 101)),
  'CP001', null, 'Un confirmado no se vuelve a guardar'
);
select throws_ok(
  format($$update comprobante_compra set observaciones = 'cambio' where id = %L$$, (select id from cc where nombre = 'A')),
  'CP001', null, 'La cabecera de un confirmado no cambia'
);
select throws_ok(
  format($$update comprobante_compra set total = 1 where id = %L$$, (select id from cc where nombre = 'A')),
  'CP001', null, 'Los totales de un confirmado no cambian'
);
select throws_ok(
  format($$insert into comprobante_compra_item (comprobante_compra_id, descripcion, cantidad, precio_unitario)
    values (%L, 'Otro', 1, 1)$$, (select id from cc where nombre = 'A')),
  'CP001', null, 'A un confirmado no se le agregan renglones'
);
select throws_ok(
  format($$delete from comprobante_compra_item where comprobante_compra_id = %L$$, (select id from cc where nombre = 'A')),
  'CP001', null, 'A un confirmado no se le borran renglones'
);
select throws_ok(
  format($$update comprobante_compra_item set cantidad = 5 where comprobante_compra_id = %L$$, (select id from cc where nombre = 'A')),
  'CP001', null, 'Los renglones de un confirmado no cambian'
);
select throws_ok(
  format($$insert into comprobante_compra_percepcion (comprobante_compra_id, tipo, importe) values (%L, 'iva', 1)$$,
    (select id from cc where nombre = 'A')),
  'CP001', null, 'A un confirmado no se le agregan percepciones'
);
select throws_ok(
  format($$delete from comprobante_compra where id = %L$$, (select id from cc where nombre = 'A')),
  'CP003', null, 'Un confirmado no se borra'
);
select throws_ok(
  format($$update comprobante_compra set estado = 'anulado', anulado_en = now() where id = %L$$, (select id from cc where nombre = 'A')),
  'CP002', null, 'Un confirmado se anula sólo con anular_comprobante_compra'
);

-- ---------------------------------------------------------------------
-- Anulación
-- ---------------------------------------------------------------------

select throws_ok(
  format('select anular_comprobante_compra(%L)', (select id from cc where nombre = 'B')),
  'CP002', null, 'Un borrador no se anula (se borra)'
);
select throws_ok(
  $$select anular_comprobante_compra('00000000-0000-4000-8000-00000000ffff')$$,
  'CP004', null, 'Anular uno inexistente avisa'
);
select lives_ok(
  format('select anular_comprobante_compra(%L)', (select id from cc where nombre = 'A')),
  'Se anula un confirmado'
);
select is(
  (select array[estado, (anulado_en is not null)::text, total::text] from comprobante_compra where id = (select id from cc where nombre = 'A')),
  array['anulado', 'true', '121.00'],
  'Queda anulado y conserva sus datos'
);
select throws_ok(
  format($$update comprobante_compra set observaciones = 'cambio' where id = %L$$, (select id from cc where nombre = 'A')),
  'CP001', null, 'Un anulado no cambia'
);
select throws_ok(
  format($$delete from comprobante_compra where id = %L$$, (select id from cc where nombre = 'A')),
  'CP003', null, 'Un anulado no se borra'
);
select lives_ok(
  format($$select guardar_comprobante_compra(null, %L::jsonb,
    '[{"descripcion": "Recarga", "cantidad": 1, "precio_unitario": 10, "alicuota_iva": 21}]', '[]')$$,
    pg_temp.cabecera('A', 101)),
  'Anulado, el mismo número se vuelve a cargar'
);

-- ---------------------------------------------------------------------
-- Borrado
-- ---------------------------------------------------------------------

select lives_ok(
  format($$delete from comprobante_compra where id = %L$$, (select id from cc where nombre = 'B')),
  'Un borrador se borra'
);
select is(
  (select count(*)::int from comprobante_compra_item where comprobante_compra_id = (select id from cc where nombre = 'B'))
  + (select count(*)::int from comprobante_compra_percepcion where comprobante_compra_id = (select id from cc where nombre = 'B')),
  0,
  'Al borrar un borrador se borran sus renglones y percepciones'
);
select throws_ok(
  $$delete from proveedor where id = '00000000-0000-4000-8000-0000000001c1'$$,
  '23503', null, 'No se borra un proveedor con comprobantes'
);

select * from finish();
rollback;

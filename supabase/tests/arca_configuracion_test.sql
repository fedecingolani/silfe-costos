-- =====================================================================
-- Tests de la configuración de ARCA: datos del emisor (fila única) y
-- credenciales por ambiente con la clave privada y el ticket cifrados.
-- Corre con `supabase test db`. Todo se deshace al final.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ----- Estructura --------------------------------------------------------

select has_table('public', 'arca_emisor', 'Existe arca_emisor');
select has_table('public', 'arca_credencial', 'Existe arca_credencial');

select columns_are('public', 'arca_emisor', array[
  'id', 'cuit', 'razon_social', 'condicion_iva', 'punto_venta', 'ambiente', 'actualizado_en'
], 'arca_emisor tiene las columnas esperadas');

select columns_are('public', 'arca_credencial', array[
  'ambiente', 'certificado_pem', 'certificado_titular', 'certificado_cuit', 'certificado_vence',
  'clave_cifrada', 'ta_cifrado', 'ta_expira', 'ta_bloqueado_hasta', 'creado_en', 'actualizado_en'
], 'arca_credencial tiene las columnas esperadas');

select col_is_pk('public', 'arca_credencial', 'ambiente', 'arca_credencial tiene una fila por ambiente');
select col_is_null('public', 'arca_emisor', 'cuit', 'La CUIT del emisor es opcional hasta configurarla');
select col_default_is('public', 'arca_emisor', 'ambiente', 'homologacion', 'El ambiente arranca en homologación');

select is(
  (select count(*)::int from arca_emisor),
  1,
  'arca_emisor viene con su única fila'
);

select has_trigger('public', 'arca_emisor', 'trg_arca_emisor_actualizado', 'arca_emisor actualiza actualizado_en');
select has_trigger('public', 'arca_credencial', 'trg_arca_credencial_actualizado', 'arca_credencial actualiza actualizado_en');

-- ----- Restricciones del emisor -----------------------------------------

select throws_ok(
  $$update arca_emisor set cuit = '2333477122' where id$$,
  '23514', null, 'La CUIT del emisor debe tener 11 dígitos'
);
select throws_ok(
  $$update arca_emisor set cuit = '23-33477122-9' where id$$,
  '23514', null, 'La CUIT del emisor se guarda sin guiones'
);
select throws_ok(
  $$update arca_emisor set condicion_iva = 'Consumidor Final' where id$$,
  '23514', null, 'La condición frente al IVA es una de las previstas'
);
select throws_ok(
  $$update arca_emisor set punto_venta = 0 where id$$,
  '23514', null, 'El punto de venta empieza en 1'
);
select throws_ok(
  $$update arca_emisor set punto_venta = 100000 where id$$,
  '23514', null, 'El punto de venta tiene como mucho 5 dígitos'
);
select throws_ok(
  $$update arca_emisor set ambiente = 'testing' where id$$,
  '23514', null, 'El ambiente es homologación o producción'
);

-- ----- Restricciones de la credencial -----------------------------------

select throws_ok(
  $$insert into arca_credencial (ambiente, certificado_pem, certificado_cuit, certificado_vence, clave_cifrada)
    values ('testing', 'cert', '23334771229', now() + interval '1 year', 'v1.aaa.bbb')$$,
  '23514', null, 'La credencial es de homologación o producción'
);
select throws_ok(
  $$insert into arca_credencial (ambiente, certificado_pem, certificado_cuit, certificado_vence, clave_cifrada)
    values ('homologacion', 'cert', '23334771229', now() + interval '1 year',
            E'-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----')$$,
  '23514', null, 'Una clave privada en claro se rechaza'
);
select throws_ok(
  $$insert into arca_credencial (ambiente, certificado_pem, certificado_cuit, certificado_vence, clave_cifrada)
    values ('homologacion', 'cert', '23334771229', now() + interval '1 year',
            E'v1.-----BEGIN RSA PRIVATE KEY-----')$$,
  '23514', null, 'Una clave con prefijo v1. pero en claro se rechaza'
);
select throws_ok(
  $$insert into arca_credencial (ambiente, certificado_pem, certificado_cuit, certificado_vence, clave_cifrada, ta_cifrado)
    values ('homologacion', 'cert', '23334771229', now() + interval '1 year', 'v1.aaa.bbb', '<token>abc</token>')$$,
  '23514', null, 'Un ticket de acceso sin cifrar se rechaza'
);
select throws_ok(
  $$insert into arca_credencial (ambiente, certificado_pem, certificado_cuit, certificado_vence, clave_cifrada)
    values ('homologacion', 'cert', '2333477122', now() + interval '1 year', 'v1.aaa.bbb')$$,
  '23514', null, 'La CUIT del certificado tiene 11 dígitos'
);

-- ----- Permisos de un usuario autenticado --------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$update arca_emisor
    set cuit = '23334771229', razon_social = 'Silfe S.A.', condicion_iva = 'Responsable Inscripto',
        punto_venta = 3, ambiente = 'homologacion'
    where id$$,
  'Un usuario autenticado edita los datos del emisor'
);
select is(
  (select punto_venta from arca_emisor),
  3,
  'El emisor guarda el punto de venta'
);

select throws_ok(
  $$insert into arca_emisor (id) values (true)$$,
  '42501', null, 'Un usuario autenticado no agrega otra fila de emisor'
);

-- El borrado sin política no falla: simplemente no borra nada.
delete from arca_emisor;
select is(
  (select count(*)::int from arca_emisor),
  1,
  'Un usuario autenticado no borra la fila del emisor'
);

select lives_ok(
  $$insert into arca_credencial (ambiente, certificado_pem, certificado_titular, certificado_cuit,
                                 certificado_vence, clave_cifrada)
    values ('homologacion', E'-----BEGIN CERTIFICATE-----\nMIID\n-----END CERTIFICATE-----',
            'silfeerphomo', '23334771229', now() + interval '2 years', 'v1.aaaa.bbbb')$$,
  'Un usuario autenticado carga una credencial cifrada'
);
select lives_ok(
  $$update arca_credencial
    set ta_cifrado = 'v1.cccc.dddd', ta_expira = now() + interval '12 hours'
    where ambiente = 'homologacion'$$,
  'Un usuario autenticado guarda el ticket cifrado'
);
select is(
  (select ta_cifrado from arca_credencial where ambiente = 'homologacion'),
  'v1.cccc.dddd',
  'Un usuario autenticado lee la credencial'
);

reset role;

-- ----- Anónimos ---------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.' || t,
    'select, insert, update, delete, truncate, references, trigger'),
  format('anon no tiene privilegios sobre %s', t)
)
from unnest(array['arca_emisor', 'arca_credencial']) as t;

set local role anon;
select throws_ok(
  $$select clave_cifrada from arca_credencial$$,
  '42501', null, 'Un anónimo no lee las credenciales'
);
reset role;

select * from finish();
rollback;

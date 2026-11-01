-- =====================================================================
-- Charoli Gestión - Identidad de la empresa
-- empresa guarda la identidad no fiscal de la empresa que usa esta
-- instancia (fila única, como arca_emisor y parametro_costeo): nombre de
-- fantasía, color de marca, datos de contacto y logo. Los datos fiscales
-- siguen en arca_emisor. Una instancia nueva arranca con la fila vacía.
-- El logo se guarda en base64 con su tipo, sin Storage.
-- =====================================================================

create table empresa (
  id               boolean primary key default true check (id),
  nombre_fantasia  text,
  color_marca      text,
  telefono         text,
  email            text,
  web              text,
  logo_base64      text,
  logo_tipo        text,
  actualizado_en   timestamptz not null default now(),
  constraint empresa_nombre_fantasia_check check (
    nombre_fantasia = btrim(nombre_fantasia)
    and nombre_fantasia <> ''
    and char_length(nombre_fantasia) <= 80
  ),
  constraint empresa_color_marca_check check (color_marca ~ '^#[0-9a-fA-F]{6}$'),
  constraint empresa_telefono_check check (char_length(telefono) <= 40),
  constraint empresa_email_check check (
    email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254
  ),
  constraint empresa_web_check check (char_length(web) <= 200),
  constraint empresa_logo_tipo_check check (logo_tipo in ('image/png', 'image/jpeg')),
  constraint empresa_logo_completo_check check ((logo_base64 is null) = (logo_tipo is null)),
  -- base64 ocupa 4 caracteres por cada 3 bytes: 700000 caracteres son
  -- 525000 bytes de imagen, unos 500 KB.
  constraint empresa_logo_base64_check check (char_length(logo_base64) <= 700000)
);

insert into empresa (id) values (true);

comment on table empresa is
  'Identidad de la empresa que usa la instancia (fila única). Los datos fiscales están en arca_emisor';
comment on column empresa.nombre_fantasia is
  'Nombre de fantasía que se muestra en la app y en los PDF, hasta 80 caracteres. Vacío hasta configurarlo';
comment on column empresa.color_marca is
  'Color de marca en hex (#rrggbb); la app deriva de él la escala de tonos';
comment on column empresa.telefono is
  'Teléfono de contacto de la empresa';
comment on column empresa.email is
  'Email de contacto de la empresa';
comment on column empresa.web is
  'Sitio web de la empresa';
comment on column empresa.logo_base64 is
  'Logo en base64, sin el prefijo data:. Hasta 700000 caracteres (unos 500 KB de imagen)';
comment on column empresa.logo_tipo is
  'Tipo del logo: image/png o image/jpeg. Va junto con logo_base64';

create trigger trg_empresa_actualizado before update on empresa
  for each row execute function fn_set_actualizado_en();

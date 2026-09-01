-- =====================================================================
-- Silfe Costos - Esquema base
-- Sistema de costeo de productos para fabricación de elementos
-- de cosecha de fruta.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Unidades de medida y conversiones
-- ---------------------------------------------------------------------

create table unidad_medida (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nombre      text not null,
  magnitud    text not null check (magnitud in ('MASA','LONGITUD','SUPERFICIE','VOLUMEN','UNIDAD')),
  creado_en   timestamptz not null default now()
);

comment on table unidad_medida is 'Catálogo de unidades (kg, m, m2, u, ...)';

-- Conversiones genéricas dentro de una misma magnitud (1 kg = 1000 g).
-- Las conversiones que dependen del material (1 kg de soga = 20 m)
-- se definen en materia_prima.factor_conversion.
create table conversion_unidad (
  id                 uuid primary key default gen_random_uuid(),
  unidad_origen_id   uuid not null references unidad_medida(id) on delete cascade,
  unidad_destino_id  uuid not null references unidad_medida(id) on delete cascade,
  factor             numeric(20,8) not null check (factor > 0),
  constraint conversion_unidad_distinta check (unidad_origen_id <> unidad_destino_id),
  unique (unidad_origen_id, unidad_destino_id)
);

comment on column conversion_unidad.factor is '1 unidad_origen = factor unidades_destino';

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------

create table proveedor (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  cuit       text,
  contacto   text,
  email      text,
  telefono   text,
  notas      text,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create unique index proveedor_nombre_uq on proveedor (lower(nombre));

-- ---------------------------------------------------------------------
-- Materia prima
-- ---------------------------------------------------------------------

create table materia_prima (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique,
  nombre            text not null,
  categoria         text,
  -- unidad en la que se compra (ej: kg de soga)
  unidad_compra_id  uuid not null references unidad_medida(id),
  -- unidad en la que se consume en producción (ej: m de soga)
  unidad_uso_id     uuid not null references unidad_medida(id),
  -- 1 unidad_compra rinde `factor_conversion` unidades_uso (1 kg = 20 m)
  factor_conversion numeric(20,8) not null default 1 check (factor_conversion > 0),
  -- desperdicio propio del material (recortes, puntas)
  merma_pct         numeric(6,3) not null default 0 check (merma_pct >= 0 and merma_pct < 100),
  activo            boolean not null default true,
  notas             text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

comment on column materia_prima.factor_conversion is
  'Cuántas unidades de uso rinde una unidad de compra. Ej: soga comprada por kg y usada por metro -> 20';

create table precio_materia_prima (
  id                uuid primary key default gen_random_uuid(),
  materia_prima_id  uuid not null references materia_prima(id) on delete cascade,
  proveedor_id      uuid references proveedor(id) on delete set null,
  -- precio por unidad de compra
  precio            numeric(18,4) not null check (precio >= 0),
  moneda            text not null default 'ARS',
  incluye_iva       boolean not null default false,
  vigente_desde     date not null default current_date,
  es_preferido      boolean not null default false,
  observaciones     text,
  creado_en         timestamptz not null default now()
);

create index precio_mp_idx on precio_materia_prima (materia_prima_id, vigente_desde desc);

-- Un solo precio preferido por materia prima
create unique index precio_mp_preferido_uq
  on precio_materia_prima (materia_prima_id)
  where es_preferido;

-- ---------------------------------------------------------------------
-- Mano de obra
-- ---------------------------------------------------------------------

create table categoria_mano_obra (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null unique,
  costo_hora           numeric(18,4) not null check (costo_hora >= 0),
  cargas_sociales_pct  numeric(6,3) not null default 0 check (cargas_sociales_pct >= 0),
  activo               boolean not null default true,
  creado_en            timestamptz not null default now()
);

comment on table categoria_mano_obra is 'Categorías de operario con su costo horario bruto y cargas sociales';

create table proceso (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  nombre       text not null,
  descripcion  text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);

comment on table proceso is 'Catálogo de procesos productivos (corte, costura, remachado, armado...)';

-- ---------------------------------------------------------------------
-- Productos y estructura (2 niveles)
-- ---------------------------------------------------------------------

create type tipo_producto as enum ('TERMINADO','SUBGRUPO');
create type tipo_componente as enum ('MATERIA_PRIMA','SUBGRUPO');
create type modo_costeo_proceso as enum ('TIEMPO','FIJO');

create table producto (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  nombre          text not null,
  tipo            tipo_producto not null default 'TERMINADO',
  descripcion     text,
  unidad_id       uuid references unidad_medida(id),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

comment on column producto.tipo is
  'TERMINADO: producto que se vende. SUBGRUPO: conjunto intermedio reutilizable (Lona, Correa...)';

-- Estructura de producto. Un TERMINADO puede llevar materias primas y
-- subgrupos; un SUBGRUPO sólo puede llevar materias primas (2 niveles).
create table producto_componente (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid not null references producto(id) on delete cascade,
  tipo              tipo_componente not null,
  materia_prima_id  uuid references materia_prima(id) on delete restrict,
  subgrupo_id       uuid references producto(id) on delete restrict,
  -- cantidad en unidad de uso de la MP, o cantidad de subgrupos
  cantidad          numeric(18,6) not null check (cantidad > 0),
  -- merma específica de este uso, se suma a la del material
  merma_pct         numeric(6,3) not null default 0 check (merma_pct >= 0 and merma_pct < 100),
  orden             int not null default 0,
  notas             text,
  creado_en         timestamptz not null default now(),
  constraint componente_referencia_valida check (
    (tipo = 'MATERIA_PRIMA' and materia_prima_id is not null and subgrupo_id is null) or
    (tipo = 'SUBGRUPO'      and subgrupo_id is not null and materia_prima_id is null)
  ),
  constraint componente_no_autoreferencia check (subgrupo_id is null or subgrupo_id <> producto_id)
);

create index producto_componente_padre_idx on producto_componente (producto_id, orden);
create index producto_componente_sub_idx on producto_componente (subgrupo_id);

create or replace function fn_validar_estructura_dos_niveles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tipo_padre tipo_producto;
  tipo_hijo  tipo_producto;
begin
  if new.tipo = 'SUBGRUPO' then
    select tipo into tipo_padre from producto where id = new.producto_id;
    if tipo_padre = 'SUBGRUPO' then
      raise exception 'La estructura soporta 2 niveles: un subgrupo no puede contener otros subgrupos';
    end if;

    select tipo into tipo_hijo from producto where id = new.subgrupo_id;
    if tipo_hijo <> 'SUBGRUPO' then
      raise exception 'Sólo se pueden agregar productos de tipo SUBGRUPO como componente de estructura';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validar_estructura_dos_niveles
  before insert or update on producto_componente
  for each row execute function fn_validar_estructura_dos_niveles();

-- Procesos de mano de obra aplicados a un producto o subgrupo
create table producto_proceso (
  id                      uuid primary key default gen_random_uuid(),
  producto_id             uuid not null references producto(id) on delete cascade,
  proceso_id              uuid not null references proceso(id) on delete restrict,
  orden                   int not null default 0,
  modo                    modo_costeo_proceso not null default 'TIEMPO',
  -- modo TIEMPO
  minutos                 numeric(12,4),
  categoria_mano_obra_id  uuid references categoria_mano_obra(id) on delete restrict,
  -- modo FIJO (destajo / tercerizado)
  costo_fijo              numeric(18,4),
  -- unidades producidas por cada ciclo del proceso (para procesos en lote)
  cantidad_por_ciclo      numeric(12,4) not null default 1 check (cantidad_por_ciclo > 0),
  notas                   text,
  creado_en               timestamptz not null default now(),
  constraint proceso_costeo_valido check (
    (modo = 'TIEMPO' and minutos is not null and minutos >= 0 and categoria_mano_obra_id is not null) or
    (modo = 'FIJO'   and costo_fijo is not null and costo_fijo >= 0)
  )
);

create index producto_proceso_idx on producto_proceso (producto_id, orden);

-- ---------------------------------------------------------------------
-- Parámetros generales de costeo (fila única)
-- ---------------------------------------------------------------------

create table parametro_costeo (
  id                    boolean primary key default true check (id),
  moneda                text not null default 'ARS',
  gastos_generales_pct  numeric(6,3) not null default 0 check (gastos_generales_pct >= 0),
  margen_pct            numeric(6,3) not null default 0 check (margen_pct >= 0),
  actualizado_en        timestamptz not null default now()
);

insert into parametro_costeo (id) values (true);

-- ---------------------------------------------------------------------
-- actualizado_en automático
-- ---------------------------------------------------------------------

create or replace function fn_set_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

create trigger trg_mp_actualizado before update on materia_prima
  for each row execute function fn_set_actualizado_en();
create trigger trg_producto_actualizado before update on producto
  for each row execute function fn_set_actualizado_en();
create trigger trg_parametro_actualizado before update on parametro_costeo
  for each row execute function fn_set_actualizado_en();

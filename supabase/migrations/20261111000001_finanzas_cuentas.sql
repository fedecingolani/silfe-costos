-- =====================================================================
-- Charoli Gestión - Finanzas: cuentas de fondos (bancos y caja) y ajustes
-- manuales
--
-- Cuenta de fondos (cuenta_fondos): una cuenta bancaria o una caja, sólo en
-- pesos. Las de banco tienen además banco, número de cuenta, CBU (22
-- dígitos) y alias; las cajas no. El nombre es único entre todas, sin
-- distinguir mayúsculas. El tipo no cambia una vez creada. No se borran
-- con movimientos: se desactivan (activa = false) y una cuenta inactiva no
-- admite movimientos nuevos.
--
-- Ajuste manual (ajuste_fondos): un ingreso o un egreso con fecha,
-- importe, concepto obligatorio y observación. El saldo inicial de cada
-- cuenta se carga como un ajuste. No se edita ni se borra: se anula con
-- motivo (update estado = 'anulado', motivo_anulacion = ...), para dejar
-- rastro; el trigger pone anulado_en. Un ajuste anulado no cambia más (no
-- se "desanula"). Las reglas viven en triggers, así que valen también para
-- SQL directo.
--
-- Vistas (security invoker):
--   - v_movimiento_fondos: todos los movimientos por cuenta con saldo
--     acumulado (positivo = ingreso), ordenados por fecha, creado_en y
--     origen_id. Por ahora sólo los ajustes vigentes; las tareas
--     siguientes suman recibos, órdenes de pago, cheques y transferencias
--     con otra rama del union (columna origen).
--   - v_cuenta_fondos_saldo: por cuenta, saldo actual (movimientos hasta
--     hoy, en Argentina), suma de los movimientos con fecha futura y fecha
--     del último movimiento hasta hoy.
--
-- Errores (SQLSTATE propio, estable; el HINT repite el motivo como clave):
--   FN001 ajuste_inmutable        (cambiar un ajuste, salvo anularlo; o
--                                  cambiar uno anulado)
--   FN002 transicion_invalida     (crear un ajuste ya anulado)
--   FN003 ajuste_no_se_borra
--   FN004 cuenta_inactiva         (ajuste nuevo en una cuenta inactiva)
--   FN005 motivo_requerido        (anular sin motivo)
--   FN006 cuenta_tipo_inmutable   (cambiar banco por caja o al revés)
-- =====================================================================

-- ----- Cuenta de fondos -----------------------------------------------------

create table cuenta_fondos (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null,
  nombre          text not null,
  banco           text,
  numero_cuenta   text,
  cbu             text,
  alias           text,
  activa          boolean not null default true,
  observacion     text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint cuenta_fondos_tipo_check check (tipo in ('banco', 'caja')),
  constraint cuenta_fondos_nombre_check check (btrim(nombre) <> ''),
  constraint cuenta_fondos_cbu_check check (cbu ~ '^[0-9]{22}$'),
  constraint cuenta_fondos_caja_sin_banco_check check (
    tipo = 'banco' or (banco is null and numero_cuenta is null and cbu is null and alias is null)
  )
);

comment on table cuenta_fondos is
  'Cuentas bancarias y cajas de la empresa (sólo pesos). Las cajas no tienen datos bancarios';

create unique index cuenta_fondos_nombre_uq on cuenta_fondos (lower(btrim(nombre)));

create trigger trg_cuenta_fondos_actualizado before update on cuenta_fondos
  for each row execute function fn_set_actualizado_en();

create or replace function public.fn_cuenta_fondos_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tipo is distinct from old.tipo then
    raise exception 'No se puede cambiar el tipo de la cuenta (banco o caja).'
      using errcode = 'FN006', hint = 'cuenta_tipo_inmutable';
  end if;
  return new;
end;
$$;

create trigger trg_cuenta_fondos_validar before update on cuenta_fondos
  for each row execute function public.fn_cuenta_fondos_validar();

-- ----- Ajuste manual ----------------------------------------------------------

create table ajuste_fondos (
  id                uuid primary key default gen_random_uuid(),
  cuenta_id         uuid not null references cuenta_fondos(id) on delete restrict,
  fecha             date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  tipo              text not null,
  importe           numeric(14,2) not null,
  concepto          text not null,
  observacion       text,
  estado            text not null default 'vigente',
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  constraint ajuste_fondos_tipo_check check (tipo in ('ingreso', 'egreso')),
  constraint ajuste_fondos_importe_check check (importe > 0),
  constraint ajuste_fondos_concepto_check check (btrim(concepto) <> ''),
  constraint ajuste_fondos_estado_check check (estado in ('vigente', 'anulado')),
  constraint ajuste_fondos_anulado_check check (
    (estado = 'anulado') = (anulado_en is not null)
    and (estado = 'vigente' or btrim(coalesce(motivo_anulacion, '')) <> '')
  )
);

comment on table ajuste_fondos is
  'Ajustes manuales de una cuenta de fondos (ingreso o egreso, incluido el saldo inicial). No se editan ni se borran: se anulan con motivo';

create index ajuste_fondos_cuenta_idx on ajuste_fondos (cuenta_id, fecha);

create or replace function public.fn_ajuste_fondos_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_activa boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Los ajustes no se borran: se anulan con un motivo.'
      using errcode = 'FN003', hint = 'ajuste_no_se_borra';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'vigente' or new.anulado_en is not null or new.motivo_anulacion is not null then
      raise exception 'Un ajuste nuevo no puede nacer anulado.'
        using errcode = 'FN002', hint = 'transicion_invalida';
    end if;
    -- for share: no se desactiva la cuenta mientras se registra el ajuste.
    select c.activa into v_activa from public.cuenta_fondos c where c.id = new.cuenta_id for share;
    if found and not v_activa then
      raise exception 'La cuenta está inactiva: no admite ajustes nuevos.'
        using errcode = 'FN004', hint = 'cuenta_inactiva';
    end if;
    return new;
  end if;

  -- UPDATE: sólo se anula un ajuste vigente; nada más cambia.
  if old.estado = 'anulado'
     or new.estado <> 'anulado'
     or new.cuenta_id is distinct from old.cuenta_id
     or new.fecha is distinct from old.fecha
     or new.tipo is distinct from old.tipo
     or new.importe is distinct from old.importe
     or new.concepto is distinct from old.concepto
     or new.observacion is distinct from old.observacion
     or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en then
    raise exception 'El ajuste no se modifica: sólo se anula, y uno anulado ya no cambia.'
      using errcode = 'FN001', hint = 'ajuste_inmutable';
  end if;
  if btrim(coalesce(new.motivo_anulacion, '')) = '' then
    raise exception 'El motivo de la anulación es obligatorio.'
      using errcode = 'FN005', hint = 'motivo_requerido';
  end if;
  new.motivo_anulacion := btrim(new.motivo_anulacion);
  new.anulado_en := now();
  return new;
end;
$$;

create trigger trg_ajuste_fondos_validar before insert or update or delete on ajuste_fondos
  for each row execute function public.fn_ajuste_fondos_validar();

revoke execute on function public.fn_cuenta_fondos_validar(), public.fn_ajuste_fondos_validar()
  from public, anon, authenticated;

-- ----- Movimientos ------------------------------------------------------------

-- Cada fuente aporta una rama al union con la misma forma: importe con
-- signo (positivo = ingreso). Lo anulado y los borradores no aparecen.
create view v_movimiento_fondos
with (security_invoker = true) as
with movimientos as (
  select a.cuenta_id, a.fecha, a.creado_en, 'ajuste'::text as origen, a.id as origen_id,
         a.concepto as descripcion, a.observacion,
         case when a.tipo = 'ingreso' then a.importe else -a.importe end as importe
  from ajuste_fondos a
  where a.estado = 'vigente'
)
select cuenta_id, fecha, origen, origen_id, descripcion, observacion,
       greatest(importe, 0) as ingreso,
       greatest(-importe, 0) as egreso,
       importe,
       sum(importe) over (
         partition by cuenta_id order by fecha, creado_en, origen_id
         rows between unbounded preceding and current row
       ) as saldo,
       creado_en
from movimientos
order by cuenta_id, fecha, creado_en, origen_id;

comment on view v_movimiento_fondos is
  'Movimientos de cada cuenta de fondos con saldo acumulado (positivo = ingreso). Por ahora, los ajustes manuales vigentes';

-- ----- Saldo por cuenta -------------------------------------------------------

create view v_cuenta_fondos_saldo
with (security_invoker = true) as
with hoy as (
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as fecha
)
select
  c.id as cuenta_id,
  coalesce(sum(m.importe) filter (where m.fecha <= hoy.fecha), 0) as saldo_actual,
  coalesce(sum(m.importe) filter (where m.fecha > hoy.fecha), 0) as movimientos_futuros,
  max(m.fecha) filter (where m.fecha <= hoy.fecha) as ultimo_movimiento
from cuenta_fondos c
cross join hoy
left join v_movimiento_fondos m on m.cuenta_id = c.id
group by c.id;

comment on view v_cuenta_fondos_saldo is
  'Por cuenta de fondos: saldo actual (movimientos hasta hoy en Argentina), suma de los movimientos futuros y fecha del último movimiento hasta hoy';

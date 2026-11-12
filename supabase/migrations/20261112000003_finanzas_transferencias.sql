-- =====================================================================
-- Charoli Gestión - Finanzas: transferencias entre cuentas propias
--
-- Transferencia (transferencia_fondos): plata que pasa de una cuenta de
-- fondos a otra de la empresa: depositar efectivo de una caja en un banco,
-- extraer de un banco a una caja, pasar de un banco a otro o de una caja a
-- otra. Cualquier combinación de tipos vale; origen y destino son cuentas
-- distintas. Fecha, importe (> 0), concepto opcional y observación.
--
-- Mismas reglas que el ajuste manual (20261111000001_finanzas_cuentas.sql):
-- no se edita ni se borra, se anula con motivo (update estado = 'anulado',
-- motivo_anulacion = ...); el trigger pone anulado_en. No nace anulada y
-- una anulada no cambia más. Las dos cuentas tienen que estar activas al
-- registrarla; anularla no lo exige. Las cuentas no se borran mientras
-- tengan transferencias (aunque estén anuladas), como con los ajustes.
--
-- Movimientos (v_movimiento_fondos): una rama nueva, 'transferencia', con
-- dos patas por transferencia vigente: egreso en la cuenta origen e
-- ingreso en la destino, las dos en la fecha de la transferencia.
-- origen_id = id de la transferencia (las patas están en cuentas
-- distintas, así que no se pisan dentro de una cuenta). Descripción
-- "Transferencia a <destino>" y "Transferencia desde <origen>", más
-- " · <concepto>" si tiene; observación: la de la transferencia.
-- La vista se reemplaza con las mismas columnas, el mismo orden (con origen
-- como último desempate) y el mismo saldo acumulado; v_cuenta_fondos_saldo
-- la lee y no cambia. Sigue siendo security invoker y conserva sus
-- permisos.
--
-- Errores: los códigos del ajuste con el mismo significado y el mismo
-- HINT, ahora también para las transferencias, y uno nuevo:
--   FN001 ajuste_inmutable        (cambiar una transferencia, salvo
--                                  anularla; o cambiar una anulada)
--   FN002 transicion_invalida     (crear una transferencia ya anulada)
--   FN003 ajuste_no_se_borra      (borrar una transferencia)
--   FN004 cuenta_inactiva         (cuenta origen o destino inactiva)
--   FN005 motivo_requerido        (anular sin motivo)
--   FN010 cuenta_misma            (origen y destino son la misma cuenta)
-- =====================================================================

create table transferencia_fondos (
  id                 uuid primary key default gen_random_uuid(),
  fecha              date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  cuenta_origen_id   uuid not null references cuenta_fondos(id) on delete restrict,
  cuenta_destino_id  uuid not null references cuenta_fondos(id) on delete restrict,
  importe            numeric(14,2) not null,
  concepto           text,
  observacion        text,
  estado             text not null default 'vigente',
  anulado_en         timestamptz,
  motivo_anulacion   text,
  creado_por         uuid default auth.uid(),
  creado_en          timestamptz not null default now(),
  constraint transferencia_fondos_importe_check check (importe > 0),
  constraint transferencia_fondos_estado_check check (estado in ('vigente', 'anulado')),
  constraint transferencia_fondos_anulado_check check (
    (estado = 'anulado') = (anulado_en is not null)
    and (estado = 'vigente' or btrim(coalesce(motivo_anulacion, '')) <> '')
  )
);

comment on table transferencia_fondos is
  'Transferencias entre cuentas de fondos propias (bancos y cajas). No se editan ni se borran: se anulan con motivo';

create index transferencia_fondos_origen_idx on transferencia_fondos (cuenta_origen_id, fecha);
create index transferencia_fondos_destino_idx on transferencia_fondos (cuenta_destino_id, fecha);

create or replace function public.fn_transferencia_fondos_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cuenta record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Las transferencias no se borran: se anulan con un motivo.'
      using errcode = 'FN003', hint = 'ajuste_no_se_borra';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'vigente' or new.anulado_en is not null or new.motivo_anulacion is not null then
      raise exception 'Una transferencia nueva no puede nacer anulada.'
        using errcode = 'FN002', hint = 'transicion_invalida';
    end if;
    if new.cuenta_origen_id = new.cuenta_destino_id then
      raise exception 'La cuenta de origen y la de destino tienen que ser distintas.'
        using errcode = 'FN010', hint = 'cuenta_misma';
    end if;
    -- for share: no se desactiva ninguna de las dos mientras se registra.
    for v_cuenta in
      select c.nombre, c.activa from public.cuenta_fondos c
      where c.id in (new.cuenta_origen_id, new.cuenta_destino_id)
      order by c.id
      for share
    loop
      if not v_cuenta.activa then
        raise exception 'La cuenta "%" está inactiva: no admite transferencias nuevas.', v_cuenta.nombre
          using errcode = 'FN004', hint = 'cuenta_inactiva';
      end if;
    end loop;
    new.concepto := nullif(btrim(new.concepto), '');
    new.observacion := nullif(btrim(new.observacion), '');
    return new;
  end if;

  -- UPDATE: sólo se anula una transferencia vigente; nada más cambia.
  if old.estado = 'anulado'
     or new.estado <> 'anulado'
     or new.cuenta_origen_id is distinct from old.cuenta_origen_id
     or new.cuenta_destino_id is distinct from old.cuenta_destino_id
     or new.fecha is distinct from old.fecha
     or new.importe is distinct from old.importe
     or new.concepto is distinct from old.concepto
     or new.observacion is distinct from old.observacion
     or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en then
    raise exception 'La transferencia no se modifica: sólo se anula, y una anulada ya no cambia.'
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

create trigger trg_transferencia_fondos_validar before insert or update or delete on transferencia_fondos
  for each row execute function public.fn_transferencia_fondos_validar();

revoke execute on function public.fn_transferencia_fondos_validar() from public, anon, authenticated;

-- ----- Movimientos: rama de las transferencias ---------------------------------

create or replace view v_movimiento_fondos
with (security_invoker = true) as
with movimientos as (
  select a.cuenta_id, a.fecha, a.creado_en, 'ajuste'::text as origen, a.id as origen_id,
         a.concepto as descripcion, a.observacion,
         case when a.tipo = 'ingreso' then a.importe else -a.importe end as importe
  from ajuste_fondos a
  where a.estado = 'vigente'
  union all
  -- Un movimiento por recibo emitido y cuenta (los medios a la misma cuenta suman).
  select m.cuenta_id, r.fecha, r.emitido_en as creado_en, 'recibo'::text as origen, r.id as origen_id,
         'Recibo ' || r.numero_texto || ' · ' || cl.razon_social as descripcion, r.observaciones as observacion,
         sum(m.importe) as importe
  from recibo_medio m
  join recibo r on r.id = m.recibo_id
  join cliente cl on cl.id = r.cliente_id
  where r.estado = 'emitido'
    and m.cuenta_id is not null
  group by m.cuenta_id, r.id, cl.id
  union all
  -- Un egreso por orden de pago confirmada, cuenta y fecha: el efectivo y la
  -- transferencia en la fecha de la orden, el cheque propio en su fecha de pago.
  select m.cuenta_id,
         case when m.tipo = 'cheque_propio' then m.fecha_pago else o.fecha end as fecha,
         o.confirmado_en as creado_en, 'orden_pago'::text as origen, o.id as origen_id,
         'Orden de pago ' || o.numero_texto || ' · ' || p.nombre
           || coalesce(
                case when count(*) filter (where m.tipo = 'cheque_propio') = 1 then ' · cheque N° ' else ' · cheques N° ' end
                  || string_agg(m.numero, ', ' order by m.orden) filter (where m.tipo = 'cheque_propio'),
                '') as descripcion,
         o.observaciones as observacion,
         -sum(m.importe) as importe
  from orden_pago_medio m
  join orden_pago o on o.id = m.orden_pago_id
  join proveedor p on p.id = o.proveedor_id
  where o.estado = 'confirmado'
    and m.cuenta_id is not null
  group by m.cuenta_id, case when m.tipo = 'cheque_propio' then m.fecha_pago else o.fecha end, o.id, p.id
  union all
  -- Depósito de un cheque de terceros (depositado o rechazado después): ingreso
  -- en su cuenta, en la fecha del depósito según el historial.
  select ch.deposito_cuenta_id as cuenta_id, h.fecha, h.creado_en, 'cheque_deposito'::text as origen, ch.id as origen_id,
         'Depósito cheque N° ' || ch.numero || ' · ' || ch.banco || coalesce(' · ' || nullif(btrim(ch.librador), ''), '')
           as descripcion,
         h.observacion,
         ch.importe
  from cheque ch
  join lateral (
    select e.fecha, e.creado_en, e.observacion
    from cheque_estado e
    where e.cheque_id = ch.id and e.estado = 'depositado'
    order by e.id desc
    limit 1
  ) h on true
  where ch.deposito_cuenta_id is not null
    and ch.estado in ('depositado', 'rechazado')
  union all
  -- Rechazo de un cheque depositado: egreso en la misma cuenta, en la fecha del rechazo.
  select ch.deposito_cuenta_id as cuenta_id, h.fecha, h.creado_en, 'cheque_rechazo'::text as origen, ch.id as origen_id,
         'Rechazo cheque N° ' || ch.numero || ' · ' || ch.banco || coalesce(' · ' || nullif(btrim(ch.librador), ''), '')
           as descripcion,
         h.observacion,
         -ch.importe
  from cheque ch
  join lateral (
    select e.fecha, e.creado_en, e.observacion
    from cheque_estado e
    where e.cheque_id = ch.id and e.estado = 'rechazado'
    order by e.id desc
    limit 1
  ) h on true
  where ch.deposito_cuenta_id is not null
    and ch.estado = 'rechazado'
  union all
  -- Transferencia entre cuentas propias: egreso en la cuenta origen.
  select t.cuenta_origen_id as cuenta_id, t.fecha, t.creado_en, 'transferencia'::text as origen, t.id as origen_id,
         'Transferencia a ' || d.nombre || coalesce(' · ' || t.concepto, '') as descripcion,
         t.observacion,
         -t.importe
  from transferencia_fondos t
  join cuenta_fondos d on d.id = t.cuenta_destino_id
  where t.estado = 'vigente'
  union all
  -- ... e ingreso en la cuenta destino.
  select t.cuenta_destino_id as cuenta_id, t.fecha, t.creado_en, 'transferencia'::text as origen, t.id as origen_id,
         'Transferencia desde ' || o.nombre || coalesce(' · ' || t.concepto, '') as descripcion,
         t.observacion,
         t.importe
  from transferencia_fondos t
  join cuenta_fondos o on o.id = t.cuenta_origen_id
  where t.estado = 'vigente'
)
select cuenta_id, fecha, origen, origen_id, descripcion, observacion,
       greatest(importe, 0) as ingreso,
       greatest(-importe, 0) as egreso,
       importe,
       sum(importe) over (
         partition by cuenta_id order by fecha, creado_en, origen_id, origen
         rows between unbounded preceding and current row
       ) as saldo,
       creado_en
from movimientos
order by cuenta_id, fecha, creado_en, origen_id, origen;

comment on view v_movimiento_fondos is
  'Movimientos de cada cuenta de fondos con saldo acumulado (positivo = ingreso): ajustes manuales vigentes, recibos emitidos (efectivo y transferencias), órdenes de pago confirmadas (efectivo, transferencias y cheques propios en su fecha de pago), cheques de terceros depositados (y su débito si se rechazan) y transferencias entre cuentas propias (egreso en el origen, ingreso en el destino)';

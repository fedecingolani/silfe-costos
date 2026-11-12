-- =====================================================================
-- Charoli Gestión - Finanzas: los cheques de terceros depositados mueven
-- los bancos
--
-- Cuenta de depósito (cheque.deposito_cuenta_id, opcional, sin borrar una
-- cuenta que la tenga): la cuenta bancaria donde se depositó el cheque.
--   - Depositar (en_cartera -> depositado) la exige, y tiene que ser una
--     cuenta bancaria activa.
--   - Sólo se carga al depositar y después no cambia: un cheque en
--     cartera, entregado, anulado o de un recibo en borrador no la tiene,
--     y un rechazado conserva la de su depósito.
--   Las transiciones son las de fn_cheque_validar
--   (20261106000001_pagos_compra.sql): de depositado sólo se sale a
--   rechazado (no hay vuelta a la cartera), así que el único movimiento
--   que sigue al depósito es el rechazo. Un anulado nunca estuvo
--   depositado (sólo se anula desde la cartera) y no mueve fondos.
--   rechazar_cheque (20261030000003_comprobante_x.sql) no cambia: ya
--   rechaza un depositado. El rechazo no exige que la cuenta siga activa
--   (lo decide el banco, no la empresa): se debita igual.
--
-- Lo histórico no se reasigna: los cheques depositados antes de esta
-- migración no tienen cuenta, siguen valiendo (se rechazan como antes) y
-- no aparecen en los movimientos. La regla corre sólo al depositar.
--
-- Fechas: del historial (cheque_estado), no de cheque.estado_fecha, que
-- el rechazo pisa. El depósito sale de la fila 'depositado' del historial
-- (su fecha es la que eligió el usuario al depositar) y el rechazo de la
-- fila 'rechazado' (la fecha de rechazar_cheque). El historial no se
-- modifica ni se borra (fn_cheque_estado_inmutable) y cada estado entra
-- una sola vez, porque no hay vuelta atrás.
--
-- Movimientos (v_movimiento_fondos): dos ramas nuevas.
--   - 'cheque_deposito': ingreso en la cuenta de depósito en la fecha del
--     depósito, para los depositados y los rechazados que tienen cuenta
--     (el depósito sigue a la vista después del rechazo: el banco muestra
--     +X y después -X).
--   - 'cheque_rechazo': egreso en la misma cuenta en la fecha del rechazo,
--     para los rechazados que tienen cuenta.
--   origen_id = id del cheque (la pantalla enlaza a /cheques/<id>);
--   descripción "Depósito cheque N° 0001 · <banco> · <librador>" y
--   "Rechazo cheque N° 0001 · <banco> · <librador>" (sin librador, sin la
--   última parte); observación: la del cambio de estado.
--   La vista se reemplaza con las mismas columnas, el mismo orden y el
--   mismo saldo acumulado, más origen como último desempate: un depósito
--   y su rechazo comparten origen_id y, en la misma fecha y transacción,
--   'cheque_deposito' va antes que 'cheque_rechazo'. v_cuenta_fondos_saldo
--   la lee y no cambia. Sigue siendo security invoker y conserva sus
--   permisos.
--
-- Errores: los mismos códigos que los recibos y los pagos
-- (20261111000003_finanzas_recibos.sql, 20261112000001_finanzas_pagos.sql),
-- con el mismo significado y el mismo HINT; los mensajes hablan del
-- depósito:
--   FN004 cuenta_inactiva          (depositar en una cuenta inactiva)
--   FN007 cuenta_requerida         (depositar sin cuenta)
--   FN008 cuenta_tipo_distinto     (depositar en una caja)
--   FN009 cuenta_no_corresponde    (cargar o cambiar la cuenta de depósito
--                                   fuera del depósito)
-- =====================================================================

-- ----- Cuenta de depósito ------------------------------------------------------

alter table cheque
  add column deposito_cuenta_id uuid references cuenta_fondos(id) on delete restrict;

comment on column cheque.deposito_cuenta_id is
  'Cuenta bancaria donde se depositó. Obligatoria al depositar; no cambia después. Vacía en los demás estados y en los depositados históricos';

create index cheque_deposito_cuenta_idx on cheque (deposito_cuenta_id) where deposito_cuenta_id is not null;

create or replace function public.fn_cheque_validar_deposito()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cuenta record;
begin
  if tg_op = 'INSERT' then
    if new.deposito_cuenta_id is not null then
      raise exception 'Un cheque entra a la cartera sin cuenta de depósito: se elige al depositarlo.'
        using errcode = 'FN009', hint = 'cuenta_no_corresponde';
    end if;
    return new;
  end if;

  if not (new.estado = 'depositado' and old.estado is distinct from 'depositado') then
    if new.deposito_cuenta_id is distinct from old.deposito_cuenta_id then
      raise exception 'La cuenta de depósito se elige al depositar el cheque y después no cambia.'
        using errcode = 'FN009', hint = 'cuenta_no_corresponde';
    end if;
    return new;
  end if;

  -- Depósito
  if new.deposito_cuenta_id is null then
    raise exception 'Elegí la cuenta bancaria donde se deposita el cheque.'
      using errcode = 'FN007', hint = 'cuenta_requerida';
  end if;
  -- for share: no se desactiva la cuenta mientras se deposita.
  select c.tipo, c.activa, c.nombre into v_cuenta from public.cuenta_fondos c where c.id = new.deposito_cuenta_id for share;
  if not found then
    return new; -- la clave foránea lo rechaza
  end if;
  if v_cuenta.tipo <> 'banco' then
    raise exception 'Un cheque se deposita en una cuenta bancaria, no en una caja.'
      using errcode = 'FN008', hint = 'cuenta_tipo_distinto';
  end if;
  if not v_cuenta.activa then
    raise exception 'La cuenta "%" está inactiva: elegí otra para depositar el cheque.', v_cuenta.nombre
      using errcode = 'FN004', hint = 'cuenta_inactiva';
  end if;
  return new;
end;
$$;

-- Corre después de trg_cheque_validar (orden alfabético): una transición
-- inválida sigue dando CB009 y un cambio de datos, CB017.
create trigger trg_cheque_validar_deposito before insert or update on cheque
  for each row execute function public.fn_cheque_validar_deposito();

revoke execute on function public.fn_cheque_validar_deposito() from public, anon, authenticated;

-- ----- Movimientos: ramas de los cheques depositados ------------------------------

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
  'Movimientos de cada cuenta de fondos con saldo acumulado (positivo = ingreso): ajustes manuales vigentes, recibos emitidos (efectivo y transferencias), órdenes de pago confirmadas (efectivo, transferencias y cheques propios en su fecha de pago) y cheques de terceros depositados (y su débito si se rechazan)';

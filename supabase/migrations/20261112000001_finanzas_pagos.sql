-- =====================================================================
-- Charoli Gestión - Finanzas: las órdenes de pago mueven las cajas y los
-- bancos
--
-- Cuenta del medio de pago (orden_pago_medio.cuenta_id, opcional, sin
-- borrar una cuenta que la tenga):
--   - efectivo: una caja;
--   - transferencia y cheque propio: una cuenta bancaria;
--   - cheque de terceros: ninguna. Sale de la cartera, no de una cuenta.
--   Un borrador puede no tenerla todavía; al confirmar es obligatoria para
--   el efectivo, la transferencia y el cheque propio, y la cuenta tiene
--   que estar activa. Un medio nuevo tampoco sale de una cuenta inactiva.
--   El tipo de la cuenta no cambia (FN006, de
--   20261111000001_finanzas_cuentas.sql), así que un medio no queda nunca
--   en una cuenta del tipo equivocado.
--   La columna banco (texto libre del cheque propio) se conserva. Desde la
--   pantalla, guardar_orden_pago la completa con el banco de la cuenta (o
--   su nombre, si no tiene banco): el detalle de la orden sigue leyendo
--   banco y la orden conserva el banco que tenía la cuenta al pagar.
--
-- Lo histórico no se reasigna: las órdenes confirmadas antes de esta
-- migración no tienen cuenta, siguen valiendo (se ven, se anulan) y no
-- aparecen en los movimientos. La regla de la cuenta sólo corre al
-- confirmar. confirmar_orden_pago no cambia: la regla es un trigger más
-- sobre la confirmación.
--
-- Movimientos (v_movimiento_fondos): se suma la rama de las órdenes de
-- pago confirmadas, como egresos. El efectivo y la transferencia salen en
-- la fecha de la orden; el cheque propio, en su fecha de pago (si es
-- futura, queda en los movimientos futuros de la cuenta). Un movimiento
-- por orden, cuenta y fecha: lo que sale de la misma cuenta el mismo día
-- suma, y los cheques propios con otra fecha de pago son otro movimiento
-- (mismo origen_id, otra fecha). Origen 'orden_pago', origen_id = id de
-- la orden (la pantalla enlaza a /compras/pagos/<id>) y descripción
-- "Orden de pago OP-00000001 · <proveedor>", más "· cheque N° 0001" (o
-- "cheques N° 0001, 0002") si incluye cheques propios. Los borradores y
-- las anuladas no aparecen. La vista se reemplaza con las mismas
-- columnas, el mismo orden y el mismo saldo acumulado (cuenta, fecha y
-- origen_id siguen identificando cada fila); v_cuenta_fondos_saldo la lee
-- y no cambia. Sigue siendo security invoker y conserva sus permisos.
--
-- Errores: los mismos códigos que los recibos
-- (20261111000003_finanzas_recibos.sql), con el mismo significado y el
-- mismo HINT; los mensajes hablan de pagos:
--   FN004 cuenta_inactiva          (medio nuevo, o confirmar, con una
--                                   cuenta inactiva)
--   FN007 cuenta_requerida         (confirmar con efectivo, transferencia
--                                   o cheque propio sin cuenta)
--   FN008 cuenta_tipo_distinto     (efectivo desde un banco, o
--                                   transferencia o cheque propio desde
--                                   una caja)
--   FN009 cuenta_no_corresponde    (cheque de terceros con cuenta)
-- =====================================================================

-- ----- Cuenta del medio de pago ---------------------------------------------

alter table orden_pago_medio
  add column cuenta_id uuid references cuenta_fondos(id) on delete restrict;

comment on column orden_pago_medio.cuenta_id is
  'Efectivo: la caja; transferencia y cheque propio: la cuenta bancaria. Obligatoria al confirmar. Vacía en cheques de terceros y órdenes históricas';
comment on column orden_pago_medio.banco is
  'Cheque propio: banco. Desde Finanzas, el banco (o el nombre) de la cuenta elegida';

create index orden_pago_medio_cuenta_idx on orden_pago_medio (cuenta_id) where cuenta_id is not null;

-- Tipo de cuenta que corresponde a un medio de pago de orden de pago (null: ninguna).
create or replace function public.fn_orden_pago_medio_tipo_cuenta(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tipo when 'efectivo' then 'caja' when 'transferencia' then 'banco' when 'cheque_propio' then 'banco' end;
$$;

create or replace function public.fn_orden_pago_medio_validar_cuenta()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_esperado text := public.fn_orden_pago_medio_tipo_cuenta(new.tipo);
  v_cuenta record;
begin
  if new.cuenta_id is null then
    return new;
  end if;
  if v_esperado is null then
    raise exception 'Un cheque de terceros no lleva cuenta: sale de la cartera, no de una caja o un banco.'
      using errcode = 'FN009', hint = 'cuenta_no_corresponde';
  end if;

  -- for share: no se desactiva la cuenta mientras se carga el medio.
  select c.tipo, c.activa into v_cuenta from public.cuenta_fondos c where c.id = new.cuenta_id for share;
  if not found then
    return new; -- la clave foránea lo rechaza
  end if;
  if v_cuenta.tipo <> v_esperado then
    raise exception '%',
      case new.tipo when 'efectivo' then 'El efectivo sale de una caja, no de una cuenta bancaria.'
        when 'transferencia' then 'La transferencia sale de una cuenta bancaria, no de una caja.'
        else 'El cheque propio sale de una cuenta bancaria, no de una caja.' end
      using errcode = 'FN008', hint = 'cuenta_tipo_distinto';
  end if;
  if not v_cuenta.activa and (tg_op = 'INSERT' or new.cuenta_id is distinct from old.cuenta_id) then
    raise exception 'La cuenta está inactiva: no admite pagos nuevos.'
      using errcode = 'FN004', hint = 'cuenta_inactiva';
  end if;
  return new;
end;
$$;

-- Corre después de trg_orden_pago_medio_validar (orden alfabético): un
-- medio de una orden confirmada sigue dando OP001 y un cheque fuera de la
-- cartera, OP009.
create trigger trg_orden_pago_medio_validar_cuenta before insert or update on orden_pago_medio
  for each row execute function public.fn_orden_pago_medio_validar_cuenta();

-- Al confirmar: el efectivo, la transferencia y el cheque propio con su cuenta, activa.
create or replace function public.fn_orden_pago_validar_cuentas()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_medio record;
begin
  -- for share: no se desactiva una cuenta mientras se confirma. Ordenadas
  -- por id, para bloquearlas siempre en el mismo orden.
  perform 1
  from public.cuenta_fondos c
  where c.id in (select m.cuenta_id from public.orden_pago_medio m where m.orden_pago_id = new.id)
  order by c.id
  for share;

  for v_medio in
    select row_number() over (order by m.orden, m.id) as numero, m.tipo, m.cuenta_id,
           public.fn_orden_pago_medio_tipo_cuenta(m.tipo) as esperado, c.tipo as cuenta_tipo, c.activa, c.nombre
    from public.orden_pago_medio m
    left join public.cuenta_fondos c on c.id = m.cuenta_id
    where m.orden_pago_id = new.id
    order by m.orden, m.id
  loop
    if v_medio.esperado is not null and v_medio.cuenta_id is null then
      raise exception 'El medio % (%) no tiene %: elegila antes de confirmar.', v_medio.numero,
        replace(v_medio.tipo, '_', ' '),
        case v_medio.esperado when 'caja' then 'caja' else 'cuenta bancaria' end
        using errcode = 'FN007', hint = 'cuenta_requerida';
    end if;
    if v_medio.cuenta_id is not null and v_medio.esperado is null then
      raise exception 'Un cheque de terceros no lleva cuenta: sale de la cartera, no de una caja o un banco.'
        using errcode = 'FN009', hint = 'cuenta_no_corresponde';
    end if;
    if v_medio.cuenta_id is not null and v_medio.cuenta_tipo <> v_medio.esperado then
      raise exception 'El medio % (%) está en una cuenta de otro tipo.', v_medio.numero, replace(v_medio.tipo, '_', ' ')
        using errcode = 'FN008', hint = 'cuenta_tipo_distinto';
    end if;
    if v_medio.cuenta_id is not null and not v_medio.activa then
      raise exception 'La cuenta "%" está inactiva: elegí otra para el medio %.', v_medio.nombre, v_medio.numero
        using errcode = 'FN004', hint = 'cuenta_inactiva';
    end if;
  end loop;
  return new;
end;
$$;

-- Corre después de trg_orden_pago_validar (orden alfabético): primero las
-- reglas de la orden (medios, total, cheques, imputaciones), después las
-- cuentas.
create trigger trg_orden_pago_validar_cuentas before update on orden_pago
  for each row when (old.estado = 'borrador' and new.estado = 'confirmado')
  execute function public.fn_orden_pago_validar_cuentas();

revoke execute on function public.fn_orden_pago_medio_validar_cuenta(), public.fn_orden_pago_validar_cuentas()
  from public, anon, authenticated;
revoke execute on function public.fn_orden_pago_medio_tipo_cuenta(text) from public, anon;
grant execute on function public.fn_orden_pago_medio_tipo_cuenta(text) to authenticated;

-- ----- Guardado del borrador con la cuenta -----------------------------------

-- Igual que en 20261106000001_pagos_compra.sql, más la cuenta:
-- p_medios: [{ tipo, importe, cuenta_id,
--              referencia,                         -- transferencia
--              cheque_id,                          -- cheque_tercero (importe: el del cheque)
--              banco, numero, fecha_pago }]        -- cheque_propio
-- cuenta_id se guarda sólo en efectivo, transferencia y cheque propio. En
-- el cheque propio con cuenta, banco es el banco de la cuenta (o su
-- nombre); sin cuenta (un borrador viejo), el texto que llegue.
create or replace function public.guardar_orden_pago(
  p_id uuid,
  p_orden jsonb,
  p_medios jsonb,
  p_imputaciones jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_estado text;
  v_fecha date := coalesce(
    (p_orden->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
begin
  if p_medios is null or jsonb_typeof(p_medios) <> 'array'
    or p_imputaciones is null or jsonb_typeof(p_imputaciones) <> 'array'
  then
    raise exception 'Los medios de pago o las imputaciones no son válidos.'
      using errcode = 'OP011', hint = 'medio_invalido';
  end if;

  if v_id is null then
    insert into public.orden_pago (proveedor_id, fecha, observaciones)
    values ((p_orden->>'proveedor_id')::uuid, v_fecha, nullif(btrim(p_orden->>'observaciones'), ''))
    returning id into v_id;
  else
    select o.estado into v_estado
    from public.orden_pago o
    where o.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró la orden de pago.'
        using errcode = 'OP012', hint = 'orden_pago_inexistente';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'La orden de pago está %: ya no es un borrador.', v_estado
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;

    -- Se reemplaza todo.
    delete from public.imputacion_compra where orden_pago_id = v_id;
    delete from public.orden_pago_medio where orden_pago_id = v_id;

    update public.orden_pago
    set proveedor_id = (p_orden->>'proveedor_id')::uuid,
        fecha = v_fecha,
        observaciones = nullif(btrim(p_orden->>'observaciones'), ''),
        total = 0
    where id = v_id;
  end if;

  insert into public.orden_pago_medio (
    orden_pago_id, orden, tipo, importe, cuenta_id, referencia, cheque_id, banco, numero, fecha_pago
  )
  select
    v_id,
    m.orden::integer,
    m.dato->>'tipo',
    case when m.dato->>'tipo' = 'cheque_tercero'
      then coalesce(
        (select ch.importe from public.cheque ch where ch.id = (m.dato->>'cheque_id')::uuid),
        (m.dato->>'importe')::numeric)
      else (m.dato->>'importe')::numeric
    end,
    m.cuenta_id,
    case when m.dato->>'tipo' = 'transferencia' then nullif(btrim(m.dato->>'referencia'), '') end,
    (m.dato->>'cheque_id')::uuid,
    case when m.dato->>'tipo' = 'cheque_propio' and c.id is not null
      then coalesce(nullif(btrim(c.banco), ''), c.nombre)
      else nullif(btrim(m.dato->>'banco'), '')
    end,
    nullif(btrim(m.dato->>'numero'), ''),
    nullif(m.dato->>'fecha_pago', '')::date
  from (
    select e.dato, e.orden,
           case when public.fn_orden_pago_medio_tipo_cuenta(e.dato->>'tipo') is not null
             then nullif(e.dato->>'cuenta_id', '')::uuid end as cuenta_id
    from jsonb_array_elements(p_medios) with ordinality as e(dato, orden)
  ) m
  left join public.cuenta_fondos c on c.id = m.cuenta_id
  order by m.orden;

  update public.orden_pago
  set total = (select coalesce(sum(m.importe), 0) from public.orden_pago_medio m where m.orden_pago_id = v_id)
  where id = v_id;

  -- Ordenadas por comprobante: los débitos se bloquean siempre en el mismo orden.
  insert into public.imputacion_compra (orden_pago_id, comprobante_compra_id, importe)
  select v_id, (x->>'comprobante_compra_id')::uuid, (x->>'importe')::numeric
  from jsonb_array_elements(p_imputaciones) x
  where (x->>'importe')::numeric > 0
  order by (x->>'comprobante_compra_id')::uuid;

  return v_id;
end;
$$;

comment on function public.guardar_orden_pago(uuid, jsonb, jsonb, jsonb) is
  'Crea (p_id null) o reemplaza una orden de pago en borrador con sus medios (y la cuenta de fondos del efectivo, la transferencia y el cheque propio) e imputaciones en una transacción. Devuelve el id';

-- ----- Movimientos: rama de las órdenes de pago ---------------------------------

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
  'Movimientos de cada cuenta de fondos con saldo acumulado (positivo = ingreso): ajustes manuales vigentes, recibos emitidos (efectivo y transferencias) y órdenes de pago confirmadas (efectivo, transferencias y cheques propios en su fecha de pago)';

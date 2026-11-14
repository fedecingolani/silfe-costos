-- =====================================================================
-- Charoli Gestión - Finanzas: los recibos mueven las cajas y los bancos
--
-- Cuenta del medio de pago (recibo_medio.cuenta_id, opcional, sin borrar
-- una cuenta que la tenga):
--   - efectivo: una caja;
--   - transferencia: una cuenta bancaria;
--   - cheque, e-cheq y retención: ninguna. No mueven fondos al cobrarlos
--     (el cheque los mueve al depositarlo).
--   Un borrador puede no tenerla todavía; al emitir es obligatoria para el
--   efectivo y la transferencia, y la cuenta tiene que estar activa. Un
--   medio nuevo tampoco se carga en una cuenta inactiva. El tipo de la
--   cuenta no cambia (FN006, de 20261111000001_finanzas_cuentas.sql), así
--   que un medio no queda nunca en una cuenta del tipo equivocado.
--   La columna banco (texto libre) queda para la historia. Desde la
--   pantalla, guardar_borrador_recibo la completa con el nombre de la
--   cuenta en la transferencia: el detalle y el PDF del recibo siguen
--   leyendo banco y muestran la cuenta sin cambios, y el recibo emitido
--   conserva el nombre que tenía la cuenta al cobrarlo.
--
-- Lo histórico no se reasigna: los recibos emitidos antes de esta
-- migración no tienen cuenta, siguen valiendo (se ven, se anulan) y no
-- aparecen en los movimientos. La regla de la cuenta sólo corre al
-- emitir.
--
-- Movimientos (v_movimiento_fondos): se suma la rama de los recibos
-- emitidos, un movimiento por recibo y cuenta (si dos medios van a la
-- misma caja, suman), con la fecha del recibo, origen 'recibo', origen_id
-- = id del recibo (la pantalla enlaza a /cobranzas/<id>) y descripción
-- "Recibo R-00001-00000001 · <cliente>". Los borradores y los anulados no
-- aparecen, igual que en las cuentas corrientes. La vista se reemplaza
-- con las mismas columnas, el mismo orden y el mismo saldo acumulado;
-- v_cuenta_fondos_saldo la lee y no cambia. Sigue siendo security
-- invoker y conserva sus permisos.
--
-- Errores (SQLSTATE propio, sigue la numeración de Finanzas; el HINT
-- repite el motivo como clave):
--   FN004 cuenta_inactiva          (ya existía para los ajustes: ahora
--                                   también un medio de recibo nuevo o un
--                                   recibo que se emite con una cuenta
--                                   inactiva)
--   FN007 cuenta_requerida         (emitir con efectivo o transferencia
--                                   sin cuenta)
--   FN008 cuenta_tipo_distinto     (efectivo en un banco o transferencia
--                                   en una caja)
--   FN009 cuenta_no_corresponde    (cheque, e-cheq o retención con
--                                   cuenta)
-- =====================================================================

-- ----- Cuenta del medio de pago ---------------------------------------------

alter table recibo_medio
  add column cuenta_id uuid references cuenta_fondos(id) on delete restrict;

comment on column recibo_medio.cuenta_id is
  'Efectivo: la caja; transferencia: la cuenta bancaria. Obligatoria al emitir. Vacía en cheques, e-cheq, retenciones y recibos históricos';
comment on column recibo_medio.banco is
  'Transferencia: banco o cuenta destino (texto). Desde Finanzas, el nombre de la cuenta elegida';

create index recibo_medio_cuenta_idx on recibo_medio (cuenta_id) where cuenta_id is not null;

-- Tipo de cuenta que corresponde a un medio de pago de recibo (null: ninguna).
create or replace function public.fn_recibo_medio_tipo_cuenta(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tipo when 'efectivo' then 'caja' when 'transferencia' then 'banco' end;
$$;

create or replace function public.fn_recibo_medio_validar_cuenta()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_esperado text := public.fn_recibo_medio_tipo_cuenta(new.tipo);
  v_cuenta record;
begin
  if new.cuenta_id is null then
    return new;
  end if;
  if v_esperado is null then
    raise exception 'Un medio de pago %: no lleva cuenta (no mueve fondos al cobrarlo).', new.tipo
      using errcode = 'FN009', hint = 'cuenta_no_corresponde';
  end if;

  -- for share: no se desactiva la cuenta mientras se carga el medio.
  select c.tipo, c.activa into v_cuenta from public.cuenta_fondos c where c.id = new.cuenta_id for share;
  if not found then
    return new; -- la clave foránea lo rechaza
  end if;
  if v_cuenta.tipo <> v_esperado then
    raise exception '%',
      case new.tipo when 'efectivo' then 'El efectivo va a una caja, no a una cuenta bancaria.'
        else 'La transferencia va a una cuenta bancaria, no a una caja.' end
      using errcode = 'FN008', hint = 'cuenta_tipo_distinto';
  end if;
  if not v_cuenta.activa and (tg_op = 'INSERT' or new.cuenta_id is distinct from old.cuenta_id) then
    raise exception 'La cuenta está inactiva: no admite cobros nuevos.'
      using errcode = 'FN004', hint = 'cuenta_inactiva';
  end if;
  return new;
end;
$$;

-- Corre después de trg_recibo_medio_validar (orden alfabético): un medio de
-- un recibo emitido sigue dando CB001.
create trigger trg_recibo_medio_validar_cuenta before insert or update on recibo_medio
  for each row execute function public.fn_recibo_medio_validar_cuenta();

-- Al emitir: el efectivo y la transferencia con su cuenta, activa.
create or replace function public.fn_recibo_validar_cuentas()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_medio record;
begin
  -- for share: no se desactiva una cuenta mientras se emite. Ordenadas por
  -- id, para bloquearlas siempre en el mismo orden.
  perform 1
  from public.cuenta_fondos c
  where c.id in (select m.cuenta_id from public.recibo_medio m where m.recibo_id = new.id)
  order by c.id
  for share;

  for v_medio in
    select row_number() over (order by m.orden, m.id) as numero, m.tipo, m.cuenta_id,
           public.fn_recibo_medio_tipo_cuenta(m.tipo) as esperado, c.tipo as cuenta_tipo, c.activa, c.nombre
    from public.recibo_medio m
    left join public.cuenta_fondos c on c.id = m.cuenta_id
    where m.recibo_id = new.id
    order by m.orden, m.id
  loop
    if v_medio.esperado is not null and v_medio.cuenta_id is null then
      raise exception 'El medio % (%) no tiene %: elegila antes de emitir.', v_medio.numero, v_medio.tipo,
        case v_medio.esperado when 'caja' then 'caja' else 'cuenta bancaria' end
        using errcode = 'FN007', hint = 'cuenta_requerida';
    end if;
    if v_medio.cuenta_id is not null and v_medio.esperado is null then
      raise exception 'Un medio de pago %: no lleva cuenta (no mueve fondos al cobrarlo).', v_medio.tipo
        using errcode = 'FN009', hint = 'cuenta_no_corresponde';
    end if;
    if v_medio.cuenta_id is not null and v_medio.cuenta_tipo <> v_medio.esperado then
      raise exception 'El medio % (%) está en una cuenta de otro tipo.', v_medio.numero, v_medio.tipo
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

-- Corre después de trg_recibo_validar (orden alfabético): primero las
-- reglas del recibo (medios, total, número), después las cuentas.
create trigger trg_recibo_validar_cuentas before update on recibo
  for each row when (old.estado = 'borrador' and new.estado = 'emitido')
  execute function public.fn_recibo_validar_cuentas();

revoke execute on function public.fn_recibo_medio_validar_cuenta(), public.fn_recibo_validar_cuentas()
  from public, anon, authenticated;
revoke execute on function public.fn_recibo_medio_tipo_cuenta(text) from public, anon;
grant execute on function public.fn_recibo_medio_tipo_cuenta(text) to authenticated;

-- ----- Guardado del borrador con la cuenta -----------------------------------

-- Igual que en 20261027000001_cobranzas_saldo_a_favor.sql, más la cuenta:
-- p_medios: [{ tipo, importe, cuenta_id, banco, referencia, cheque: {...},
--              retencion_tipo, retencion_jurisdiccion, certificado, fecha_retencion }]
-- cuenta_id se guarda sólo en efectivo y transferencia. En la
-- transferencia con cuenta, banco es el nombre de la cuenta; sin cuenta
-- (un borrador viejo), el texto que llegue.
create or replace function public.guardar_borrador_recibo(
  p_id uuid,
  p_recibo jsonb,
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
  v_cliente uuid := (p_recibo->>'cliente_id')::uuid;
  v_total numeric;
  v_medio record;
  v_cheque_id uuid;
  v_cheque jsonb;
  v_cuenta_id uuid;
  v_banco text;
begin
  if p_medios is null or jsonb_typeof(p_medios) <> 'array'
    or p_imputaciones is null or jsonb_typeof(p_imputaciones) <> 'array'
  then
    raise exception 'Los medios de pago o las imputaciones no son válidos.'
      using errcode = 'CB012', hint = 'medio_invalido';
  end if;

  select coalesce(sum((m->>'importe')::numeric), 0) into v_total
  from jsonb_array_elements(p_medios) m;

  if v_id is null then
    insert into public.recibo (cliente_id, fecha, observaciones, comprobante_contado_id, total)
    values (
      v_cliente,
      (p_recibo->>'fecha')::date,
      nullif(btrim(p_recibo->>'observaciones'), ''),
      (p_recibo->>'comprobante_contado_id')::uuid,
      v_total
    )
    returning id into v_id;
  else
    select r.estado into v_estado
    from public.recibo r
    where r.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el recibo.'
        using errcode = 'CB013', hint = 'recibo_inexistente';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'El recibo está %: ya no es un borrador.', v_estado
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;

    -- Se reemplaza todo: imputaciones, medios y, después, sus cheques.
    delete from public.imputacion where recibo_id = v_id;
    delete from public.recibo_medio where recibo_id = v_id;
    delete from public.cheque where recibo_id = v_id;

    update public.recibo
    set cliente_id = v_cliente,
        fecha = (p_recibo->>'fecha')::date,
        observaciones = nullif(btrim(p_recibo->>'observaciones'), ''),
        comprobante_contado_id = (p_recibo->>'comprobante_contado_id')::uuid,
        total = v_total
    where id = v_id;
  end if;

  for v_medio in
    select m.value as dato, m.ordinality::integer as orden
    from jsonb_array_elements(p_medios) with ordinality m
  loop
    v_cheque_id := null;
    if v_medio.dato->>'tipo' in ('cheque', 'echeq') then
      v_cheque := coalesce(v_medio.dato->'cheque', '{}'::jsonb);
      insert into public.cheque (
        recibo_id, cliente_id, tipo, banco, numero, fecha_emision, fecha_pago, librador, librador_cuit, importe
      )
      values (
        v_id,
        v_cliente,
        case when v_medio.dato->>'tipo' = 'echeq' then 'echeq' else 'fisico' end,
        btrim(coalesce(v_cheque->>'banco', '')),
        btrim(coalesce(v_cheque->>'numero', '')),
        nullif(v_cheque->>'fecha_emision', '')::date,
        nullif(v_cheque->>'fecha_pago', '')::date,
        nullif(btrim(v_cheque->>'librador'), ''),
        nullif(regexp_replace(coalesce(v_cheque->>'librador_cuit', ''), '\D', '', 'g'), ''),
        (v_medio.dato->>'importe')::numeric
      )
      returning id into v_cheque_id;
    end if;

    v_cuenta_id := case when v_medio.dato->>'tipo' in ('efectivo', 'transferencia')
      then nullif(v_medio.dato->>'cuenta_id', '')::uuid end;
    v_banco := null;
    if v_medio.dato->>'tipo' = 'transferencia' then
      select c.nombre into v_banco from public.cuenta_fondos c where c.id = v_cuenta_id;
      v_banco := coalesce(v_banco, nullif(btrim(v_medio.dato->>'banco'), ''));
    end if;

    insert into public.recibo_medio (
      recibo_id, orden, tipo, importe, cuenta_id, banco, referencia, cheque_id,
      retencion_tipo, retencion_jurisdiccion, certificado, fecha_retencion
    )
    values (
      v_id,
      v_medio.orden,
      v_medio.dato->>'tipo',
      (v_medio.dato->>'importe')::numeric,
      v_cuenta_id,
      v_banco,
      case when v_medio.dato->>'tipo' = 'transferencia' then nullif(btrim(v_medio.dato->>'referencia'), '') end,
      v_cheque_id,
      case when v_medio.dato->>'tipo' = 'retencion' then v_medio.dato->>'retencion_tipo' end,
      case when v_medio.dato->>'tipo' = 'retencion' and v_medio.dato->>'retencion_tipo' = 'iibb'
        then nullif(btrim(v_medio.dato->>'retencion_jurisdiccion'), '') end,
      case when v_medio.dato->>'tipo' = 'retencion' then nullif(btrim(v_medio.dato->>'certificado'), '') end,
      case when v_medio.dato->>'tipo' = 'retencion' then nullif(v_medio.dato->>'fecha_retencion', '')::date end
    );
  end loop;

  -- Ordenadas por comprobante: los débitos se bloquean siempre en el mismo orden.
  insert into public.imputacion (recibo_id, comprobante_id, importe)
  select v_id, (x->>'comprobante_id')::uuid, (x->>'importe')::numeric
  from jsonb_array_elements(p_imputaciones) x
  where (x->>'importe')::numeric > 0
  order by (x->>'comprobante_id')::uuid;

  return v_id;
end;
$$;

comment on function public.guardar_borrador_recibo(uuid, jsonb, jsonb, jsonb) is
  'Crea (p_id null) o reemplaza un recibo en borrador con sus medios (y la cuenta de fondos del efectivo y la transferencia), cheques e imputaciones en una transacción. Devuelve el id';

-- ----- Movimientos: rama de los recibos ---------------------------------------

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
  'Movimientos de cada cuenta de fondos con saldo acumulado (positivo = ingreso): ajustes manuales vigentes y recibos emitidos (efectivo y transferencias)';

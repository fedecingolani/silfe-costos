-- =====================================================================
-- Silfe Costos - Cobranzas: guardado de borradores y saldo a favor
-- automático (Fase 8, Ventas)
--
-- 1. guardar_borrador_recibo(p_id, p_recibo, p_medios, p_imputaciones):
--    crea o reemplaza un recibo en borrador con sus medios, sus cheques
--    y sus imputaciones en una sola transacción (como
--    guardar_borrador_comprobante). Al reemplazar, borra los medios,
--    cheques e imputaciones anteriores y los vuelve a crear: un borrador
--    no tiene historia que conservar. Los cheques de un borrador no son
--    cartera todavía (la cartera filtra por recibo emitido) y se van con
--    el borrador: cheque.recibo_id es on delete cascade, y su historial
--    (cheque_estado) cae en cascada con el cheque.
--
-- =====================================================================

-- ----- Guardado atómico de un borrador -----------------------------------------

-- p_recibo: { cliente_id, fecha, observaciones, comprobante_contado_id }
-- p_medios: [{ tipo, importe, banco, referencia,
--              cheque: { banco, numero, fecha_emision, fecha_pago, librador, librador_cuit },
--              retencion_tipo, retencion_jurisdiccion, certificado, fecha_retencion }]
-- p_imputaciones: [{ comprobante_id, importe }] (los importes en cero se ignoran)
-- El total del recibo es la suma de los medios.
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

    insert into public.recibo_medio (
      recibo_id, orden, tipo, importe, banco, referencia, cheque_id,
      retencion_tipo, retencion_jurisdiccion, certificado, fecha_retencion
    )
    values (
      v_id,
      v_medio.orden,
      v_medio.dato->>'tipo',
      (v_medio.dato->>'importe')::numeric,
      case when v_medio.dato->>'tipo' = 'transferencia' then nullif(btrim(v_medio.dato->>'banco'), '') end,
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
  'Crea (p_id null) o reemplaza un recibo en borrador con sus medios, cheques e imputaciones en una transacción. Devuelve el id';

revoke execute on function public.guardar_borrador_recibo(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_borrador_recibo(uuid, jsonb, jsonb, jsonb) to authenticated;

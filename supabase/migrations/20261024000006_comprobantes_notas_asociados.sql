-- =====================================================================
-- Silfe Costos - Comprobantes: reglas de los asociados guardados
--
-- guardar_borrador_comprobante (20261024000005) validaba sólo los asociados
-- del pedido. Con p_asociados null (se conservan los guardados) no volvía a
-- validarlos contra la cabecera nueva: una nota de crédito asociada a una
-- nota de débito podía pasar a nota de débito y quedar asociada a otra nota
-- de débito. Ahora las reglas corren siempre sobre los asociados que quedan
-- (los del pedido o, si no vienen, los guardados), antes de escribir; como
-- todo es una transacción, un error no deja nada a medias.
--
-- Reglas, con el mismo error CM007 asociado_invalido:
--   - una factura no lleva asociados;
--   - un asociado de la base está autorizado; una nota de crédito se asocia
--     a una factura o a una nota de débito, una nota de débito sólo a una
--     factura;
--   - una nota lleva la letra de sus asociados de la base (ARCA exige la
--     misma letra; la app ya la hereda, acá para cualquier cliente);
--   - los asociados de la base son de un mismo ambiente, y la nota toma ese
--     ambiente.
-- El resto, como antes.
-- =====================================================================

create or replace function public.guardar_borrador_comprobante(
  p_id uuid,
  p_comprobante jsonb,
  p_items jsonb,
  p_asociados jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_estado text;
  v_ambiente text;
  v_electronico boolean;
  v_punto_venta integer := (p_comprobante->>'punto_venta')::integer;
  v_clase text := p_comprobante->>'clase';
  v_ambientes text[];
  v_letra text := p_comprobante->>'letra';
  v_efectivos jsonb;
  v_asociado record;
begin
  select pv.electronico into v_electronico
  from public.punto_venta pv
  where pv.numero = v_punto_venta;
  if v_electronico is null then
    raise exception 'El punto de venta % no existe.', v_punto_venta
      using errcode = 'CM005', hint = 'punto_venta_inconsistente';
  end if;

  if p_asociados is not null and jsonb_typeof(p_asociados) <> 'array' then
    raise exception 'Los comprobantes asociados no son válidos.'
      using errcode = 'CM007', hint = 'asociado_invalido';
  end if;

  if v_id is not null then
    select c.estado, c.ambiente into v_estado, v_ambiente
    from public.comprobante c
    where c.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el comprobante.'
        using errcode = 'CM006', hint = 'comprobante_inexistente';
    end if;
    if v_estado not in ('borrador', 'rechazado') then
      raise exception 'El comprobante está %: ya no es un borrador.', v_estado
        using errcode = 'CM004', hint = 'comprobante_bloqueado';
    end if;
  end if;

  -- Asociados que quedan: los del pedido o, si no vienen, los guardados.
  if p_asociados is not null then
    v_efectivos := p_asociados;
  elsif v_id is not null then
    select coalesce(jsonb_agg(
             case when a.asociado_id is not null then jsonb_build_object('asociado_id', a.asociado_id)
                  else jsonb_build_object('tipo_arca', a.tipo_arca) end
           ), '[]'::jsonb)
      into v_efectivos
    from public.comprobante_asociado a
    where a.comprobante_id = v_id;
  else
    v_efectivos := '[]'::jsonb;
  end if;

  if v_clase = 'factura' and jsonb_array_length(v_efectivos) > 0 then
    raise exception 'Una factura no lleva comprobante asociado.'
      using errcode = 'CM007', hint = 'asociado_invalido';
  end if;

  -- Asociados de la base: autorizados, de una clase admitida, de la letra
  -- de la nota y de un mismo ambiente.
  for v_asociado in
    select a.value->>'asociado_id' as pedido, c.id, c.estado, c.clase, c.letra, c.punto_venta, c.numero, c.ambiente
    from jsonb_array_elements(v_efectivos) a
    left join public.comprobante c on c.id = (a.value->>'asociado_id')::uuid
    where a.value ? 'asociado_id'
  loop
    if v_asociado.id is null or v_asociado.estado <> 'autorizado' then
      raise exception 'El comprobante asociado no está autorizado: sólo se asocian comprobantes con número.'
        using errcode = 'CM007', hint = 'asociado_invalido';
    end if;
    if not (
      (v_clase = 'nota_credito' and v_asociado.clase in ('factura', 'nota_debito'))
      or (v_clase = 'nota_debito' and v_asociado.clase = 'factura')
    ) then
      raise exception 'Una % no puede asociarse a una % (%-%-%).',
        case v_clase when 'nota_credito' then 'nota de crédito' when 'nota_debito' then 'nota de débito' else 'factura' end,
        case v_asociado.clase when 'nota_credito' then 'nota de crédito' when 'nota_debito' then 'nota de débito'
          else 'factura' end,
        v_asociado.letra, lpad(v_asociado.punto_venta::text, 5, '0'), lpad(v_asociado.numero::text, 8, '0')
        using errcode = 'CM007', hint = 'asociado_invalido';
    end if;
    if v_letra is not null and v_asociado.letra is not null and v_letra <> v_asociado.letra then
      raise exception 'La nota lleva la letra de su comprobante asociado (%-%-%), no la %.',
        v_asociado.letra, lpad(v_asociado.punto_venta::text, 5, '0'), lpad(v_asociado.numero::text, 8, '0'), v_letra
        using errcode = 'CM007', hint = 'asociado_invalido';
    end if;
    v_ambientes := array_append(v_ambientes, v_asociado.ambiente);
  end loop;

  if v_ambientes is not null then
    if (select count(distinct x) from unnest(v_ambientes) x) > 1
      or (select bool_or(x is null) from unnest(v_ambientes) x) and (select bool_or(x is not null) from unnest(v_ambientes) x)
    then
      raise exception 'Los comprobantes asociados son de ambientes distintos de ARCA.'
        using errcode = 'CM007', hint = 'asociado_invalido';
    end if;
  end if;

  if not v_electronico then
    v_ambiente := null;
  elsif v_ambientes is not null and v_ambientes[1] is not null then
    v_ambiente := v_ambientes[1];
  elsif v_ambiente is null then
    select e.ambiente into v_ambiente from public.arca_emisor e where e.id;
  end if;

  if v_id is null then
    insert into public.comprobante (
      punto_venta, ambiente, clase, letra, tipo_arca, fecha, fecha_vencimiento_pago, cliente_id,
      lista_precio_id, condicion_pago, observaciones, neto, iva, total
    )
    values (
      v_punto_venta,
      v_ambiente,
      v_clase,
      p_comprobante->>'letra',
      (p_comprobante->>'tipo_arca')::integer,
      (p_comprobante->>'fecha')::date,
      (p_comprobante->>'fecha_vencimiento_pago')::date,
      (p_comprobante->>'cliente_id')::uuid,
      (p_comprobante->>'lista_precio_id')::uuid,
      p_comprobante->>'condicion_pago',
      p_comprobante->>'observaciones',
      coalesce((p_comprobante->>'neto')::numeric, 0),
      coalesce((p_comprobante->>'iva')::numeric, 0),
      coalesce((p_comprobante->>'total')::numeric, 0)
    )
    returning id into v_id;
  else
    update public.comprobante
    set estado = 'borrador',
        punto_venta = v_punto_venta,
        ambiente = v_ambiente,
        clase = v_clase,
        letra = p_comprobante->>'letra',
        tipo_arca = (p_comprobante->>'tipo_arca')::integer,
        fecha = (p_comprobante->>'fecha')::date,
        fecha_vencimiento_pago = (p_comprobante->>'fecha_vencimiento_pago')::date,
        cliente_id = (p_comprobante->>'cliente_id')::uuid,
        lista_precio_id = (p_comprobante->>'lista_precio_id')::uuid,
        condicion_pago = p_comprobante->>'condicion_pago',
        observaciones = p_comprobante->>'observaciones',
        neto = coalesce((p_comprobante->>'neto')::numeric, 0),
        iva = coalesce((p_comprobante->>'iva')::numeric, 0),
        total = coalesce((p_comprobante->>'total')::numeric, 0),
        iva_detalle = null,
        arca_resultado = null,
        arca_observaciones = null,
        arca_errores = null
    where id = v_id;

    delete from public.comprobante_item where comprobante_id = v_id;
  end if;

  insert into public.comprobante_item (
    comprobante_id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad,
    precio_unitario, descuento_pct, alicuota_iva, importe, iva
  )
  select
    v_id,
    (e.orden - 1)::integer,
    (e.item->>'producto_id')::uuid,
    e.item->>'codigo',
    e.item->>'descripcion',
    e.item->>'observaciones',
    e.item->>'unidad',
    (e.item->>'cantidad')::numeric,
    coalesce((e.item->>'precio_unitario')::numeric, 0),
    coalesce((e.item->>'descuento_pct')::numeric, 0),
    (e.item->>'alicuota_iva')::numeric,
    coalesce((e.item->>'importe')::numeric, 0),
    coalesce((e.item->>'iva')::numeric, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, orden);

  if p_asociados is not null then
    delete from public.comprobante_asociado where comprobante_id = v_id;
    insert into public.comprobante_asociado (comprobante_id, asociado_id, tipo_arca, punto_venta, numero, fecha, cuit)
    select
      v_id,
      (a->>'asociado_id')::uuid,
      (a->>'tipo_arca')::integer,
      (a->>'punto_venta')::integer,
      (a->>'numero')::bigint,
      (a->>'fecha')::date,
      a->>'cuit'
    from jsonb_array_elements(p_asociados) a;
  end if;

  return v_id;
end;
$$;

comment on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) is
  'Crea o actualiza un borrador (o corrige un rechazado) y reemplaza sus ítems y, si se mandan, sus asociados, en una sola transacción';

revoke execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) to authenticated;

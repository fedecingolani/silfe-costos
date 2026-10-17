-- =====================================================================
-- Silfe Costos - Comprobantes: ítems no gravados
--
-- Un ítem puede ser "no gravado" en lugar de llevar una alícuota de IVA
-- (por ejemplo, el capital de un cheque rechazado en una nota de débito).
-- Se modela explícito con comprobante_item.gravado:
--   - gravado:    alicuota_iva es una de las de ARCA (0 incluida: gravado
--                 al 0% es otra cosa, va en el array Iva con el código 3);
--   - no gravado: alicuota_iva vacía e iva 0.
-- Lo no gravado se suma en comprobante.no_gravado, que va a ARCA en
-- ImpTotConc; neto sigue siendo sólo lo gravado (ImpNeto) y
-- total = neto + no_gravado + iva. El array Iva (iva_detalle) sigue
-- teniendo sólo las alícuotas gravadas.
--
-- no_gravado queda fijo en verificación como el resto de lo enviado a ARCA
-- (CM004) y en un autorizado no cambia nada (CM001). Reemplaza
-- fn_comprobante_validar (20261024000005) con las mismas reglas más ésta.
--
-- guardar_borrador_comprobante (20261024000006) guarda además
-- p_comprobante.no_gravado y, por ítem, gravado (si no viene, gravado).
-- =====================================================================

-- ----- Ítems no gravados -------------------------------------------------

alter table comprobante_item
  add column gravado boolean not null default true,
  alter column alicuota_iva drop not null,
  drop constraint comprobante_item_alicuota_check,
  add constraint comprobante_item_alicuota_check check (
    (gravado and alicuota_iva is not null and alicuota_iva in (0, 2.5, 5, 10.5, 21, 27))
    or (not gravado and alicuota_iva is null)
  ),
  add constraint comprobante_item_no_gravado_iva_check check (gravado or iva = 0);

comment on column comprobante_item.gravado is
  'false: ítem no gravado (va en ImpTotConc), sin alícuota ni IVA. true: gravado con alicuota_iva';
comment on column comprobante_item.alicuota_iva is
  'Alícuota de IVA en %: 0, 2.5, 5, 10.5, 21 o 27. Vacía en un ítem no gravado';

alter table comprobante
  add column no_gravado numeric(14,2) not null default 0,
  add constraint comprobante_no_gravado_check check (no_gravado >= 0);

comment on column comprobante.no_gravado is
  'Importe no gravado (suma de los ítems no gravados). Va a ARCA en ImpTotConc';
comment on column comprobante.neto is 'Importe neto gravado (suma de los importes de los ítems gravados)';
comment on column comprobante.total is 'neto + no_gravado + iva';

-- ----- Validación del comprobante ----------------------------------------

create or replace function public.fn_comprobante_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_electronico boolean;
begin
  if tg_op = 'UPDATE' and old.estado = 'autorizado' then
    raise exception 'El comprobante está autorizado: no se puede modificar. Para corregirlo, emití una nota de crédito.'
      using errcode = 'CM001', hint = 'comprobante_autorizado_inmutable';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Un comprobante se crea en borrador (se recibió "%").', new.estado
        using errcode = 'CM002', hint = 'transicion_invalida';
    end if;
    new.fecha_vencimiento_pago := coalesce(new.fecha_vencimiento_pago, new.fecha);
  end if;

  if tg_op = 'UPDATE' and old.estado = 'verificando' and (
    new.punto_venta is distinct from old.punto_venta
    or new.ambiente is distinct from old.ambiente
    or new.clase is distinct from old.clase
    or new.letra is distinct from old.letra
    or new.tipo_arca is distinct from old.tipo_arca
    or new.cliente_id is distinct from old.cliente_id
    or new.fecha is distinct from old.fecha
    or new.neto is distinct from old.neto
    or new.no_gravado is distinct from old.no_gravado
    or new.iva is distinct from old.iva
    or new.total is distinct from old.total
    or new.receptor_razon_social is distinct from old.receptor_razon_social
    or new.receptor_doc_tipo is distinct from old.receptor_doc_tipo
    or new.receptor_doc_nro is distinct from old.receptor_doc_nro
    or new.receptor_condicion_iva is distinct from old.receptor_condicion_iva
    or new.receptor_domicilio is distinct from old.receptor_domicilio
    or new.receptor_provincia is distinct from old.receptor_provincia
    or new.iva_detalle is distinct from old.iva_detalle
  ) then
    raise exception 'El comprobante se está verificando con ARCA: sus datos no se pueden cambiar.'
      using errcode = 'CM004', hint = 'comprobante_bloqueado';
  end if;

  if tg_op = 'UPDATE'
    and new.intento_numero is distinct from old.intento_numero
    and old.estado <> 'verificando'
    and new.estado <> 'verificando'
  then
    raise exception 'El número enviado a ARCA sólo cambia mientras el comprobante se verifica.'
      using errcode = 'CM002', hint = 'transicion_invalida';
  end if;

  select pv.electronico into v_electronico
  from public.punto_venta pv
  where pv.numero = new.punto_venta;

  -- Sin fila, la clave foránea informa que el punto de venta no existe.
  if v_electronico is not null then
    if v_electronico and new.ambiente is null then
      raise exception 'El punto de venta % es electrónico: el comprobante necesita el ambiente de ARCA.', new.punto_venta
        using errcode = 'CM005', hint = 'punto_venta_inconsistente';
    end if;
    if not v_electronico and new.ambiente is not null then
      raise exception 'El punto de venta % no es electrónico: el comprobante no lleva ambiente de ARCA.', new.punto_venta
        using errcode = 'CM005', hint = 'punto_venta_inconsistente';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador' and new.estado = 'verificando' and v_electronico)
      or (old.estado = 'verificando' and new.estado in ('autorizado', 'rechazado', 'borrador'))
      or (old.estado = 'rechazado' and new.estado = 'borrador')
      or (old.estado = 'borrador' and new.estado = 'autorizado' and not v_electronico)
    ) then
      raise exception 'Un comprobante no puede pasar de % a %.', old.estado, new.estado
        using errcode = 'CM002', hint = 'transicion_invalida';
    end if;

    if old.estado = 'verificando' and new.estado = 'autorizado'
      and new.numero is distinct from old.intento_numero
    then
      raise exception 'El comprobante se autoriza con el número enviado a ARCA (%), no con %.', old.intento_numero, new.numero
        using errcode = 'CM002', hint = 'transicion_invalida';
    end if;
  end if;

  if new.estado = 'autorizado' and v_electronico and (new.cae is null or new.cae_vencimiento is null) then
    raise exception 'Un comprobante electrónico autorizado necesita el CAE y su vencimiento.'
      using errcode = 'CM005', hint = 'punto_venta_inconsistente';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_comprobante_validar() from anon, authenticated, public;

-- ----- Guardar un borrador -------------------------------------------------

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
      lista_precio_id, condicion_pago, observaciones, neto, no_gravado, iva, total
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
      coalesce((p_comprobante->>'no_gravado')::numeric, 0),
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
        no_gravado = coalesce((p_comprobante->>'no_gravado')::numeric, 0),
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
    precio_unitario, descuento_pct, gravado, alicuota_iva, importe, iva
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
    coalesce((e.item->>'gravado')::boolean, true),
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

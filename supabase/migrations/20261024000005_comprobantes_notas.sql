-- =====================================================================
-- Silfe Costos - Comprobantes: IVA por alícuota autorizado
--
-- comprobante.iva_detalle guarda el array Iva tal como se envió a ARCA en
-- FECAESolicitar: [{id, alicuota, base, importe}] (id es el código de
-- alícuota de ARCA). Se escribe en el mismo update que pasa el comprobante
-- a "verificando", junto con el número enviado, así que el PDF imprime lo
-- que ARCA autorizó en lugar de recalcularlo de los ítems. Vacío en los
-- comprobantes anteriores a esta migración (el PDF lo recalcula).
--
-- Mientras se verifica no cambia (CM004, como el resto de los datos
-- enviados) y en un autorizado no cambia nada (CM001). Reemplaza
-- fn_comprobante_validar (20261024000003) con las mismas reglas más ésta.
-- Mismos códigos de error:
--   CM001 comprobante_autorizado_inmutable
--   CM002 transicion_invalida
--   CM004 comprobante_bloqueado
--   CM005 punto_venta_inconsistente
-- =====================================================================

alter table comprobante
  add column iva_detalle jsonb,
  add constraint comprobante_iva_detalle_check check (iva_detalle is null or jsonb_typeof(iva_detalle) = 'array');

comment on column comprobante.iva_detalle is
  'IVA por alícuota enviado a ARCA: [{id, alicuota, base, importe}]. Se fija al pasar a verificando; vacío en los anteriores';

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

-- ----- Notas de crédito y débito: comprobantes asociados -------------------

-- guardar_borrador_comprobante (20261024000004) suma p_asociados para
-- guardar en la misma transacción los comprobantes asociados de una nota:
--
--   p_asociados  null: no se tocan los guardados (la pantalla de una nota
--                generada desde una factura no los manda).
--                [{asociado_id}] o [{tipo_arca, punto_venta, numero, fecha,
--                cuit}]: reemplazan a los guardados ([] los borra).
--
-- Reglas (las mismas que valida la app, acá para cualquier cliente):
--   - una factura no lleva asociados;
--   - un asociado de la base está autorizado; una nota de crédito se asocia
--     a una factura o a una nota de débito, una nota de débito sólo a una
--     factura;
--   - los asociados de la base son de un mismo ambiente, y la nota toma ese
--     ambiente (no el activo del emisor): una nota sobre una factura de
--     homologación es de homologación.
-- También limpia iva_detalle (era de un intento anterior a ARCA).
-- Errores nuevos: CM007 asociado_invalido (mensaje legible para la
-- pantalla). Los demás, como antes.

drop function public.guardar_borrador_comprobante(uuid, jsonb, jsonb);

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

  -- Asociados de la base pedidos: autorizados, de una clase admitida y de
  -- un mismo ambiente.
  for v_asociado in
    select a.value->>'asociado_id' as pedido, c.id, c.estado, c.clase, c.letra, c.punto_venta, c.numero, c.ambiente
    from jsonb_array_elements(coalesce(p_asociados, '[]'::jsonb)) a
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

  if v_clase = 'factura' and exists (select 1 from public.comprobante_asociado where comprobante_id = v_id) then
    raise exception 'Una factura no lleva comprobante asociado.'
      using errcode = 'CM007', hint = 'asociado_invalido';
  end if;

  return v_id;
end;
$$;

comment on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) is
  'Crea o actualiza un borrador (o corrige un rechazado) y reemplaza sus ítems y, si se mandan, sus asociados, en una sola transacción';

revoke execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) to authenticated;

-- =====================================================================
-- Silfe Costos - Comprobantes X (puntos de venta no electrónicos)
--
-- Facturas, notas de crédito y notas de débito con letra X, emitidas desde
-- un punto de venta no conectado a ARCA (punto_venta.electronico = false).
-- Reglas:
--   - punto de venta no electrónico => letra X (o vacía mientras es un
--     borrador); punto de venta electrónico => sólo A o B. Se exige en
--     fn_comprobante_validar (CM008) y no con una restricción de la tabla,
--     para no invalidar filas anteriores;
--   - un comprobante X no tiene código de ARCA (tipo_arca vacío), ni
--     ambiente, ni CAE, ni IVA: iva = 0, iva_detalle vacío y
--     total = neto + no_gravado. Sus ítems llevan IVA 0 (la alícuota se
--     conserva pero no se aplica). Lo exigen la restricción
--     comprobante_x_check, fn_comprobante_validar y
--     guardar_borrador_comprobante (ítems) con CM009;
--   - numeración propia: una secuencia por punto de venta y clase
--     (factura X 9999-1, nota de crédito X 9999-1, ...). La asigna
--     autorizar_comprobante_interno al pasar el borrador directo a
--     autorizado (máximo + 1, con bloqueo). Índice único propio
--     (comprobante_numero_x_unico); el de A y B (comprobante_numero_unico)
--     deja de incluir a los X;
--   - una nota X sólo se asocia a comprobantes X de la base (no a uno
--     cargado a mano) y una nota A o B nunca a un X (CM007);
--   - cheque rechazado (rechazar_cheque): si las facturas que canceló el
--     recibo son todas X, la nota de débito sale X en el punto de venta no
--     electrónico activo más bajo; si mezcla X con A o B, no se genera
--     (CB018);
--   - convertir_presupuesto en un punto de venta no electrónico: factura X.
--
-- Reemplaza fn_comprobante_validar y guardar_borrador_comprobante
-- (20261025000001), rechazar_cheque (20261028000001) y
-- convertir_presupuesto (20261030000001) con las mismas reglas de antes
-- más éstas. Errores nuevos:
--   CM008 letra_inconsistente     (letra según el punto de venta)
--   CM009 comprobante_x_invalido  (X con código de ARCA, CAE o IVA)
-- =====================================================================

-- ----- Letra X en la tabla ---------------------------------------------------

alter table comprobante
  drop constraint comprobante_letra_check,
  add constraint comprobante_letra_check check (letra in ('A', 'B', 'X')),
  -- Un X autorizado tiene número y letra, pero no código de ARCA.
  drop constraint comprobante_autorizado_check,
  add constraint comprobante_autorizado_check check (
    estado <> 'autorizado'
    or (numero is not null and letra is not null and (tipo_arca is not null or letra = 'X'))
  ),
  add constraint comprobante_x_check check (
    letra is distinct from 'X'
    or (
      tipo_arca is null and ambiente is null and cae is null and cae_vencimiento is null
      and iva = 0 and iva_detalle is null and total = neto + no_gravado
    )
  );

comment on column comprobante.letra is
  'A o B según la condición IVA del receptor (emisor Responsable Inscripto) en puntos de venta electrónicos; X en los no electrónicos';
comment on column comprobante.tipo_arca is
  'Código de comprobante de ARCA: 1/2/3 (A: factura/débito/crédito) y 6/7/8 (B). Vacío en un X';
comment on column comprobante.numero is
  'Número del comprobante. Vacío hasta que se autoriza. En un X, correlativo propio por punto de venta y clase';
comment on column comprobante.iva is
  'IVA total: suma por alícuota, cada una redondeada a 2 decimales. 0 en un X';
comment on column comprobante.total is 'neto + no_gravado + iva (en un X, neto + no_gravado)';

-- ----- Numeración ------------------------------------------------------------

-- A y B: por ambiente, punto de venta y tipo de ARCA, como antes. Los X
-- quedan afuera: con tipo_arca vacío, NULLS NOT DISTINCT juntaría las tres
-- clases en una sola secuencia.
drop index comprobante_numero_unico;
create unique index comprobante_numero_unico
  on comprobante (ambiente, punto_venta, tipo_arca, numero) nulls not distinct
  where numero is not null and letra is distinct from 'X';

-- X: una secuencia por punto de venta y clase.
create unique index comprobante_numero_x_unico
  on comprobante (punto_venta, clase, numero)
  where numero is not null and letra = 'X';

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
    or new.periodo_asoc_desde is distinct from old.periodo_asoc_desde
    or new.periodo_asoc_hasta is distinct from old.periodo_asoc_hasta
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
    if v_electronico and new.letra = 'X' then
      raise exception 'El punto de venta % es electrónico: el comprobante lleva letra A o B, no X.', new.punto_venta
        using errcode = 'CM008', hint = 'letra_inconsistente';
    end if;
    if not v_electronico and new.letra is not null and new.letra <> 'X' then
      raise exception 'El punto de venta % no es electrónico: el comprobante lleva letra X, no %.', new.punto_venta, new.letra
        using errcode = 'CM008', hint = 'letra_inconsistente';
    end if;
  end if;

  if new.letra = 'X' and (
    new.tipo_arca is not null
    or new.cae is not null
    or new.cae_vencimiento is not null
    or new.iva <> 0
    or new.iva_detalle is not null
    or new.total <> new.neto + new.no_gravado
  ) then
    raise exception 'Un comprobante X no lleva código ni CAE de ARCA ni IVA: tipo vacío, IVA 0 y total = neto + no gravado.'
      using errcode = 'CM009', hint = 'comprobante_x_invalido';
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

-- Igual que en 20261025000001, más:
--   - una nota de un punto de venta no electrónico (X) sólo se asocia a
--     comprobantes X de la base, y una de un punto electrónico nunca a un
--     X (CM007);
--   - los ítems de un X llevan IVA 0 (CM009).
-- La letra según el punto de venta y la cabecera del X los valida
-- fn_comprobante_validar (CM008 y CM009).
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
  v_periodo_desde date := (p_comprobante->>'periodo_asoc_desde')::date;
  v_periodo_hasta date := (p_comprobante->>'periodo_asoc_hasta')::date;
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

  if v_letra = 'X' and exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where coalesce((e->>'iva')::numeric, 0) <> 0
  ) then
    raise exception 'Un comprobante X no lleva IVA: el IVA de cada ítem tiene que ser 0.'
      using errcode = 'CM009', hint = 'comprobante_x_invalido';
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
  if v_clase = 'factura' and (v_periodo_desde is not null or v_periodo_hasta is not null) then
    raise exception 'Una factura no lleva período asociado.'
      using errcode = 'CM007', hint = 'asociado_invalido';
  end if;
  if (v_periodo_desde is not null or v_periodo_hasta is not null) and jsonb_array_length(v_efectivos) > 0 then
    raise exception 'Una nota se asocia a comprobantes o a un período, no a los dos.'
      using errcode = 'CM007', hint = 'asociado_invalido';
  end if;

  -- Una nota X no se asocia a un comprobante cargado a mano: esos llevan
  -- un código de ARCA (A o B).
  if not v_electronico and exists (
    select 1 from jsonb_array_elements(v_efectivos) a where not (a ? 'asociado_id')
  ) then
    raise exception 'Una nota X sólo se asocia a comprobantes X emitidos con el sistema, no a uno cargado a mano.'
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
    if v_electronico and v_asociado.letra = 'X' then
      raise exception 'El comprobante X-%-% sólo se asocia a una nota X, de un punto de venta no electrónico.',
        lpad(v_asociado.punto_venta::text, 5, '0'), lpad(v_asociado.numero::text, 8, '0')
        using errcode = 'CM007', hint = 'asociado_invalido';
    end if;
    if not v_electronico and v_asociado.letra is distinct from 'X' then
      raise exception 'Una nota X sólo se asocia a comprobantes X (no a %-%-%).',
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
      lista_precio_id, condicion_pago, observaciones, periodo_asoc_desde, periodo_asoc_hasta, neto, no_gravado, iva, total
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
      v_periodo_desde,
      v_periodo_hasta,
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
        periodo_asoc_desde = v_periodo_desde,
        periodo_asoc_hasta = v_periodo_hasta,
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
  'Crea o actualiza un borrador (o corrige un rechazado) y reemplaza sus ítems y, si se mandan, sus asociados (o su período asociado), en una sola transacción';

revoke execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ----- Autorizar un comprobante X ------------------------------------------

-- Pasa un borrador X de un punto de venta no electrónico directo a
-- autorizado, con el siguiente número de su punto de venta y clase
-- (máximo autorizado + 1). Dos autorizaciones simultáneas del mismo punto
-- de venta y clase se serializan con un bloqueo de la transacción; el
-- índice comprobante_numero_x_unico es la red de seguridad. La copia de
-- los datos del receptor la hace la app antes, como en los electrónicos.
-- Una nota tiene que estar asociada a comprobantes o a un período.
-- Devuelve el número asignado.
create or replace function public.autorizar_comprobante_interno(p_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c record;
  v_electronico boolean;
  v_numero bigint;
begin
  select c.id, c.estado, c.punto_venta, c.clase, c.letra, c.periodo_asoc_desde into v_c
  from public.comprobante c
  where c.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el comprobante.'
      using errcode = 'CM006', hint = 'comprobante_inexistente';
  end if;
  if v_c.estado <> 'borrador' then
    raise exception 'Sólo se autoriza un borrador (el comprobante está %).', v_c.estado
      using errcode = 'CM002', hint = 'transicion_invalida';
  end if;

  select pv.electronico into v_electronico
  from public.punto_venta pv
  where pv.numero = v_c.punto_venta;
  if v_electronico then
    raise exception 'El punto de venta % es electrónico: el comprobante se autoriza con ARCA.', v_c.punto_venta
      using errcode = 'CM008', hint = 'letra_inconsistente';
  end if;
  if v_c.letra is distinct from 'X' then
    raise exception 'En un punto de venta no electrónico sólo se emiten comprobantes X.'
      using errcode = 'CM008', hint = 'letra_inconsistente';
  end if;

  if v_c.clase <> 'factura' and v_c.periodo_asoc_desde is null
    and not exists (select 1 from public.comprobante_asociado a where a.comprobante_id = v_c.id)
  then
    raise exception 'Asociá la nota a uno o más comprobantes X antes de emitirla.'
      using errcode = 'CM007', hint = 'asociado_invalido';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('comprobante_x:' || v_c.punto_venta::text || ':' || v_c.clase, 0)
  );

  select coalesce(max(c.numero), 0) + 1 into v_numero
  from public.comprobante c
  where c.punto_venta = v_c.punto_venta
    and c.clase = v_c.clase
    and c.letra = 'X'
    and c.numero is not null;

  update public.comprobante
  set estado = 'autorizado',
      numero = v_numero,
      autorizado_en = now()
  where id = v_c.id;

  return v_numero;
end;
$$;

comment on function public.autorizar_comprobante_interno(uuid) is
  'Autoriza un borrador X de un punto de venta no electrónico: le asigna el siguiente número de su punto de venta y clase, sin ARCA. Devuelve el número';

revoke execute on function public.autorizar_comprobante_interno(uuid) from public, anon;
grant execute on function public.autorizar_comprobante_interno(uuid) to authenticated;

-- ----- Cheque rechazado ------------------------------------------------------

-- Igual que en 20261028000001, más: si las facturas que canceló el recibo
-- son todas X, la ND sale X (sin código de ARCA ni IVA: los gastos van
-- gravados al 21% como alícuota informativa, con IVA 0) en el punto de
-- venta no electrónico activo más bajo. Si mezclan X con A o B, error.
-- Si el recibo fue a cuenta, la letra sigue saliendo del cliente (A o B).
create or replace function public.rechazar_cheque(
  p_cheque_id uuid,
  p_fecha date,
  p_observacion text,
  p_gastos jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_cheque record;
  v_recibo record;
  v_condicion text;
  v_gasto numeric := 0;
  v_gasto_descripcion text;
  v_iva numeric := 0;
  v_facturas integer;
  v_letras text[];
  v_letra text;
  v_asociados jsonb;
  v_desde date;
  v_hasta date;
  v_pv integer;
  v_items jsonb;
  v_nd uuid;
begin
  select ch.id, ch.recibo_id, ch.cliente_id, ch.numero, ch.banco, ch.importe, ch.estado into v_cheque
  from public.cheque ch
  where ch.id = p_cheque_id
  for update;
  if not found then
    raise exception 'No se encontró el cheque.'
      using errcode = 'CB021', hint = 'cheque_inexistente';
  end if;
  select r.estado, r.fecha into v_recibo from public.recibo r where r.id = v_cheque.recibo_id;
  if v_recibo.estado <> 'emitido' or v_cheque.estado not in ('en_cartera', 'depositado', 'entregado') then
    raise exception 'Un cheque % (recibo %) no se puede rechazar.', v_cheque.estado, v_recibo.estado
      using errcode = 'CB009', hint = 'cheque_transicion_invalida';
  end if;

  -- Gastos bancarios
  if p_gastos is not null and jsonb_typeof(p_gastos) <> 'null' then
    if jsonb_typeof(p_gastos) <> 'object' or jsonb_typeof(coalesce(p_gastos->'importe', 'null'::jsonb)) not in ('number', 'null') then
      raise exception 'Los gastos bancarios no son válidos.'
        using errcode = 'CB022', hint = 'gastos_invalidos';
    end if;
    v_gasto := coalesce((p_gastos->>'importe')::numeric, 0);
    v_gasto_descripcion := nullif(btrim(p_gastos->>'descripcion'), '');
    if v_gasto < 0 or v_gasto <> round(v_gasto, 2) then
      raise exception 'El importe de los gastos bancarios tiene que ser positivo, con hasta 2 decimales.'
        using errcode = 'CB022', hint = 'gastos_invalidos';
    end if;
    if v_gasto > 0 and v_gasto_descripcion is null then
      raise exception 'Completá la descripción de los gastos bancarios.'
        using errcode = 'CB022', hint = 'gastos_invalidos';
    end if;
  end if;

  -- Asociación: las facturas que canceló el recibo, o el período del recibo.
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object('asociado_id', f.id) order by f.fecha, f.numero, f.id), '[]'::jsonb),
         array_agg(distinct f.letra order by f.letra) filter (where f.letra is not null)
    into v_facturas, v_asociados, v_letras
  from (
    select distinct c.id, c.fecha, c.numero, c.letra
    from public.imputacion i
    join public.comprobante c on c.id = i.comprobante_id
    where i.recibo_id = v_cheque.recibo_id and c.clase = 'factura'
  ) f;

  if v_facturas > 0 then
    if v_letras is null then
      raise exception 'Las facturas que canceló el recibo del cheque no tienen letra: no se puede armar la nota de débito.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    if array_length(v_letras, 1) > 1 and 'X' = any (v_letras) then
      raise exception 'El recibo del cheque canceló facturas X y %: la nota de débito no se genera sola. Cargá las notas de débito a mano.',
        array_to_string(array_remove(v_letras, 'X'), ' y ')
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    if array_length(v_letras, 1) > 1 then
      raise exception 'El recibo del cheque canceló facturas %: la nota de débito lleva una sola letra.',
        array_to_string(v_letras, ' y ')
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    v_letra := v_letras[1];
  else
    select cl.condicion_iva into v_condicion from public.cliente cl where cl.id = v_cheque.cliente_id;
    v_letra := case v_condicion
      when 'Responsable Inscripto' then 'A'
      when 'Monotributista' then 'A'
      when 'Exento' then 'B'
      when 'Consumidor Final' then 'B'
    end;
    if v_letra is null then
      raise exception 'Completá la condición frente al IVA del cliente.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    v_desde := date_trunc('month', v_recibo.fecha)::date;
    v_hasta := v_recibo.fecha;
    if v_hasta > v_hoy then
      raise exception 'Período asociado: el hasta no puede ser posterior a la fecha de la nota.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
  end if;

  if v_letra = 'X' then
    select min(pv.numero) into v_pv from public.punto_venta pv where pv.activo and not pv.electronico;
    if v_pv is null then
      raise exception 'No hay ningún punto de venta no electrónico activo para la nota de débito X.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
  else
    select min(pv.numero) into v_pv from public.punto_venta pv where pv.activo and pv.electronico;
    if v_pv is null then
      raise exception 'No hay ningún punto de venta electrónico activo.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
  end if;

  -- Ítems: el capital no gravado y, si hay, los gastos al 21% (en un X,
  -- con IVA 0).
  v_iva := case when v_letra = 'X' then 0 else round(v_gasto * 0.21, 2) end;
  v_items := jsonb_build_array(jsonb_build_object(
    'producto_id', null, 'codigo', null, 'observaciones', null, 'unidad', null,
    'descripcion', format('Cheque rechazado N° %s – %s', v_cheque.numero, v_cheque.banco),
    'cantidad', 1, 'precio_unitario', v_cheque.importe, 'descuento_pct', 0,
    'gravado', false, 'alicuota_iva', null, 'importe', v_cheque.importe, 'iva', 0
  ));
  if v_gasto > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'producto_id', null, 'codigo', null, 'observaciones', null, 'unidad', null,
      'descripcion', v_gasto_descripcion,
      'cantidad', 1, 'precio_unitario', v_gasto, 'descuento_pct', 0,
      'gravado', true, 'alicuota_iva', 21, 'importe', v_gasto, 'iva', v_iva
    ));
  end if;

  v_nd := public.guardar_borrador_comprobante(
    null,
    jsonb_build_object(
      'punto_venta', v_pv,
      'clase', 'nota_debito',
      'letra', v_letra,
      'tipo_arca', case v_letra when 'A' then 2 when 'B' then 7 end,
      'fecha', v_hoy,
      'fecha_vencimiento_pago', v_hoy,
      'cliente_id', v_cheque.cliente_id,
      'lista_precio_id', null,
      'condicion_pago', 'cuenta_corriente',
      'observaciones', null,
      'periodo_asoc_desde', v_desde,
      'periodo_asoc_hasta', v_hasta,
      'neto', v_gasto,
      'no_gravado', v_cheque.importe,
      'iva', v_iva,
      'total', v_gasto + v_cheque.importe + v_iva
    ),
    v_items,
    v_asociados
  );

  -- El cambio de estado (y su historial, por trigger) en la misma transacción.
  update public.cheque
  set estado = 'rechazado',
      nd_comprobante_id = v_nd,
      estado_fecha = coalesce(p_fecha, v_hoy),
      estado_observacion = nullif(btrim(p_observacion), '')
  where id = v_cheque.id;

  return v_nd;
end;
$$;

comment on function public.rechazar_cheque(uuid, date, text, jsonb) is
  'Rechaza un cheque de la cartera: crea el borrador de la nota de débito al cliente (X si las facturas canceladas son X) y deja el cheque rechazado con ella, en una transacción. Devuelve el id de la ND';

revoke execute on function public.rechazar_cheque(uuid, date, text, jsonb) from public, anon;
grant execute on function public.rechazar_cheque(uuid, date, text, jsonb) to authenticated;

-- ----- Convertir un presupuesto ----------------------------------------------

-- Igual que en 20261030000001, más: en un punto de venta no electrónico
-- la factura sale X, sin código de ARCA ni IVA (total = neto + no
-- gravado; los ítems conservan su alícuota con IVA 0). p_punto_venta
-- vacío sigue siendo el primer punto de venta electrónico activo.
create or replace function public.convertir_presupuesto(
  p_id uuid,
  p_punto_venta integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_p public.presupuesto;
  v_pv integer := p_punto_venta;
  v_electronico boolean;
  v_letra text;
  v_items jsonb;
  v_comprobante uuid;
begin
  select * into v_p
  from public.presupuesto p
  where p.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el presupuesto.'
      using errcode = 'PR004', hint = 'presupuesto_inexistente';
  end if;
  if v_p.estado <> 'abierto' then
    raise exception 'El presupuesto ya se convirtió en factura.'
      using errcode = 'PR005', hint = 'presupuesto_ya_convertido';
  end if;

  if v_pv is null then
    select min(pv.numero) into v_pv from public.punto_venta pv where pv.activo and pv.electronico;
    if v_pv is null then
      raise exception 'No hay ningún punto de venta electrónico activo.'
        using errcode = 'PR007', hint = 'punto_venta_invalido';
    end if;
    v_electronico := true;
  else
    select pv.electronico into v_electronico
    from public.punto_venta pv
    where pv.numero = v_pv and pv.activo;
    if v_electronico is null then
      raise exception 'El punto de venta % no existe o no está activo.', v_pv
        using errcode = 'PR007', hint = 'punto_venta_invalido';
    end if;
  end if;

  if v_electronico then
    select case cl.condicion_iva
             when 'Responsable Inscripto' then 'A'
             when 'Monotributista' then 'A'
             when 'Exento' then 'B'
             when 'Consumidor Final' then 'B'
           end
      into v_letra
    from public.cliente cl
    where cl.id = v_p.cliente_id;
  else
    v_letra := 'X';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', i.producto_id, 'codigo', i.codigo, 'descripcion', i.descripcion,
           'observaciones', i.observaciones, 'unidad', i.unidad, 'cantidad', i.cantidad,
           'precio_unitario', i.precio_unitario, 'descuento_pct', i.descuento_pct, 'gravado', i.gravado,
           'alicuota_iva', i.alicuota_iva, 'importe', i.importe,
           'iva', case when v_letra = 'X' then 0 else i.iva end
         ) order by i.orden, i.id), '[]'::jsonb)
    into v_items
  from public.presupuesto_item i
  where i.presupuesto_id = v_p.id;

  v_comprobante := public.guardar_borrador_comprobante(
    null,
    jsonb_build_object(
      'punto_venta', v_pv,
      'clase', 'factura',
      'letra', v_letra,
      'tipo_arca', case v_letra when 'A' then 1 when 'B' then 6 end,
      'fecha', v_hoy,
      'fecha_vencimiento_pago', greatest(v_p.fecha_vencimiento_pago, v_hoy),
      'cliente_id', v_p.cliente_id,
      'lista_precio_id', v_p.lista_precio_id,
      'condicion_pago', v_p.condicion_pago,
      'observaciones', v_p.observaciones,
      'periodo_asoc_desde', null,
      'periodo_asoc_hasta', null,
      'neto', v_p.neto,
      'no_gravado', v_p.no_gravado,
      'iva', case when v_letra = 'X' then 0 else v_p.iva end,
      'total', case when v_letra = 'X' then v_p.neto + v_p.no_gravado else v_p.total end
    ),
    v_items,
    null
  );

  -- El trigger sólo deja pasar a convertido con esta marca de la transacción.
  perform set_config('presupuesto.convirtiendo', v_p.id::text, true);
  update public.presupuesto
  set estado = 'convertido',
      comprobante_id = v_comprobante,
      convertido_en = now()
  where id = v_p.id;
  perform set_config('presupuesto.convirtiendo', '', true);

  return v_comprobante;
end;
$$;

comment on function public.convertir_presupuesto(uuid, integer) is
  'Convierte un presupuesto abierto en un borrador de factura (copia cabecera, ítems y totales; X sin IVA en un punto de venta no electrónico) y lo marca convertido, en una sola transacción. Devuelve el id de la factura';

revoke execute on function public.convertir_presupuesto(uuid, integer) from public, anon;
grant execute on function public.convertir_presupuesto(uuid, integer) to authenticated;

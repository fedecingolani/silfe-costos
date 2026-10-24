-- =====================================================================
-- Silfe Costos - Presupuestos de venta
-- Presupuestos con los mismos campos comerciales que una factura, sin los
-- fiscales (punto de venta, letra, ARCA). Tablas propias: la tabla
-- comprobante es fiscal y no se afloja para alojarlos. El ciclo de vida
-- es:
--
--   abierto -> convertido   (sólo con convertir_presupuesto)
--   convertido -> abierto   (sólo si se borra el borrador de factura
--                            generado: on delete set null de comprobante_id)
--
-- Un presupuesto convertido no se modifica ni se borra, ni sus ítems. Lo
-- controlan triggers, así que vale también para SQL directo.
--
-- Numeración: correlativo interno (identity), asignado al crear y no
-- editable. La app lo muestra como P-00000001.
--
-- Errores de los triggers y RPC (SQLSTATE propio, estable para que la app
-- los traduzca; el HINT repite el motivo en forma de clave):
--   PR001 presupuesto_convertido_inmutable (cabecera o ítems)
--   PR002 transicion_invalida
--   PR003 borrado_no_permitido
--   PR004 presupuesto_inexistente
--   PR005 presupuesto_ya_convertido
--   PR006 numero_no_editable
--   PR007 punto_venta_invalido (al convertir)
-- =====================================================================

-- ----- Presupuesto -------------------------------------------------------

create table presupuesto (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint generated always as identity unique,
  cliente_id              uuid not null references cliente(id) on delete restrict,
  fecha                   date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  valido_hasta            date not null,
  fecha_vencimiento_pago  date not null,
  condicion_pago          text not null default 'cuenta_corriente',
  lista_precio_id         uuid references lista_precio(id) on delete set null,
  observaciones           text,
  neto                    numeric(14,2) not null default 0,
  no_gravado              numeric(14,2) not null default 0,
  iva                     numeric(14,2) not null default 0,
  total                   numeric(14,2) not null default 0,
  estado                  text not null default 'abierto',
  comprobante_id          uuid references comprobante(id) on delete set null,
  convertido_en           timestamptz,
  creado_por              uuid default auth.uid(),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),
  constraint presupuesto_valido_hasta_check check (valido_hasta >= fecha),
  constraint presupuesto_vencimiento_check check (fecha_vencimiento_pago >= fecha),
  constraint presupuesto_condicion_pago_check check (condicion_pago in ('cuenta_corriente', 'contado')),
  constraint presupuesto_no_gravado_check check (no_gravado >= 0),
  constraint presupuesto_estado_check check (estado in ('abierto', 'convertido')),
  constraint presupuesto_conversion_check check (
    (estado = 'abierto' and comprobante_id is null and convertido_en is null)
    or (estado = 'convertido' and comprobante_id is not null and convertido_en is not null)
  )
);

comment on table presupuesto is
  'Presupuestos de venta. Se convierten una sola vez en un borrador de factura; un convertido no se modifica ni se borra';
comment on column presupuesto.numero is 'Correlativo interno, asignado al crear y no editable. Se muestra como P-00000001';
comment on column presupuesto.fecha is 'Fecha del presupuesto (por defecto hoy en Argentina)';
comment on column presupuesto.valido_hasta is 'Validez de la oferta. Por defecto fecha + 15 días; no anterior a la fecha';
comment on column presupuesto.fecha_vencimiento_pago is 'Vencimiento del cobro propuesto. Por defecto la fecha del presupuesto';
comment on column presupuesto.condicion_pago is 'cuenta_corriente (por defecto) o contado';
comment on column presupuesto.lista_precio_id is 'Lista de precios de la que salen los precios propuestos';
comment on column presupuesto.neto is 'Importe neto gravado (suma de los importes de los ítems gravados)';
comment on column presupuesto.no_gravado is 'Importe no gravado (suma de los ítems no gravados)';
comment on column presupuesto.iva is 'IVA total: suma por alícuota, cada una redondeada a 2 decimales';
comment on column presupuesto.total is 'neto + no_gravado + iva';
comment on column presupuesto.estado is 'abierto | convertido (ya generó su borrador de factura)';
comment on column presupuesto.comprobante_id is
  'Borrador de factura generado al convertir. Si se borra, queda vacío y el presupuesto vuelve a abierto';
comment on column presupuesto.convertido_en is 'Momento en que se convirtió';
comment on column presupuesto.creado_por is 'Usuario que creó el presupuesto (auth.uid()). Sin FK: los usuarios se manejan desde Auth';

create unique index presupuesto_comprobante_unico on presupuesto (comprobante_id) where comprobante_id is not null;
create index presupuesto_cliente_idx on presupuesto (cliente_id);
create index presupuesto_fecha_idx on presupuesto (fecha desc);
create index presupuesto_estado_idx on presupuesto (estado);
create index presupuesto_lista_precio_idx on presupuesto (lista_precio_id);

create trigger trg_presupuesto_actualizado before update on presupuesto
  for each row execute function fn_set_actualizado_en();

-- ----- Ítems -------------------------------------------------------------

create table presupuesto_item (
  id               uuid primary key default gen_random_uuid(),
  presupuesto_id   uuid not null references presupuesto(id) on delete cascade,
  orden            integer not null default 0,
  producto_id      uuid references producto(id) on delete restrict,
  codigo           text,
  descripcion      text not null,
  observaciones    text,
  unidad           text,
  cantidad         numeric(14,4) not null,
  precio_unitario  numeric(18,4) not null default 0,
  descuento_pct    numeric(5,2) not null default 0,
  gravado          boolean not null default true,
  alicuota_iva     numeric(5,2),
  importe          numeric(14,2) not null default 0,
  iva              numeric(14,2) not null default 0,
  constraint presupuesto_item_descripcion_check check (btrim(descripcion) <> ''),
  constraint presupuesto_item_cantidad_check check (cantidad > 0),
  constraint presupuesto_item_precio_check check (precio_unitario >= 0),
  constraint presupuesto_item_descuento_check check (descuento_pct between 0 and 100),
  constraint presupuesto_item_alicuota_check check (
    (gravado and alicuota_iva is not null and alicuota_iva in (0, 2.5, 5, 10.5, 21, 27))
    or (not gravado and alicuota_iva is null)
  ),
  constraint presupuesto_item_no_gravado_iva_check check (gravado or iva = 0)
);

comment on table presupuesto_item is 'Renglones de un presupuesto: un producto del catálogo o un ítem libre';
comment on column presupuesto_item.producto_id is 'Producto del catálogo. Vacío en un ítem libre';
comment on column presupuesto_item.codigo is 'Copia del código del producto al cargarlo';
comment on column presupuesto_item.observaciones is 'Texto que se imprime debajo de la descripción';
comment on column presupuesto_item.precio_unitario is 'Precio unitario sin IVA, con 4 decimales';
comment on column presupuesto_item.descuento_pct is 'Descuento del renglón en %';
comment on column presupuesto_item.gravado is 'false: ítem no gravado, sin alícuota ni IVA. true: gravado con alicuota_iva';
comment on column presupuesto_item.alicuota_iva is 'Alícuota de IVA en %: 0, 2.5, 5, 10.5, 21 o 27. Vacía en un ítem no gravado';
comment on column presupuesto_item.importe is 'cantidad × precio × (1 − descuento), redondeado a 2 decimales (sin IVA)';
comment on column presupuesto_item.iva is 'IVA del renglón, redondeado a 2 decimales';

create index presupuesto_item_presupuesto_idx on presupuesto_item (presupuesto_id, orden);
create index presupuesto_item_producto_idx on presupuesto_item (producto_id);

-- ----- Estado e inmutabilidad del presupuesto ----------------------------

-- Valida el alta y cada cambio:
--   - el alta es siempre abierto y sin vínculo;
--   - el número no cambia;
--   - abierto -> convertido sólo desde convertir_presupuesto (marca la
--     transacción con presupuesto.convirtiendo = id);
--   - un convertido no cambia, salvo cuando se borra su factura: el
--     on delete set null deja comprobante_id vacío y acá vuelve a abierto.
create or replace function public.fn_presupuesto_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignorar text[] := array['estado', 'comprobante_id', 'convertido_en', 'actualizado_en'];
begin
  new.valido_hasta := coalesce(new.valido_hasta, new.fecha + 15);
  new.fecha_vencimiento_pago := coalesce(new.fecha_vencimiento_pago, new.fecha);

  if tg_op = 'INSERT' then
    if new.estado <> 'abierto' or new.comprobante_id is not null or new.convertido_en is not null then
      raise exception 'Un presupuesto se crea abierto: se convierte con convertir_presupuesto.'
        using errcode = 'PR002', hint = 'transicion_invalida';
    end if;
    return new;
  end if;

  if new.numero is distinct from old.numero then
    raise exception 'El número del presupuesto no se puede cambiar.'
      using errcode = 'PR006', hint = 'numero_no_editable';
  end if;

  if old.estado = 'convertido' then
    -- Se borró la factura generada: vuelve a abierto.
    if new.comprobante_id is null
      and (to_jsonb(new) - v_ignorar) = (to_jsonb(old) - v_ignorar)
    then
      if exists (select 1 from public.comprobante c where c.id = old.comprobante_id) then
        raise exception 'El presupuesto está convertido: para volver a abrirlo, borrá el borrador de factura generado.'
          using errcode = 'PR002', hint = 'transicion_invalida';
      end if;
      new.estado := 'abierto';
      new.convertido_en := null;
      return new;
    end if;

    if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
      raise exception 'El presupuesto está convertido: no se puede modificar.'
        using errcode = 'PR001', hint = 'presupuesto_convertido_inmutable';
    end if;
    return new;
  end if;

  -- old.estado = 'abierto'
  if new.estado = 'convertido' then
    if new.comprobante_id is null
      or coalesce(current_setting('presupuesto.convirtiendo', true), '') <> new.id::text
    then
      raise exception 'Un presupuesto se convierte sólo con convertir_presupuesto.'
        using errcode = 'PR002', hint = 'transicion_invalida';
    end if;
    new.convertido_en := coalesce(new.convertido_en, now());
  elsif new.comprobante_id is not null or new.convertido_en is not null then
    raise exception 'Un presupuesto abierto no está vinculado a una factura.'
      using errcode = 'PR002', hint = 'transicion_invalida';
  end if;

  return new;
end;
$$;

create or replace function public.fn_presupuesto_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'convertido' then
    raise exception 'El presupuesto está convertido: no se puede borrar.'
      using errcode = 'PR003', hint = 'borrado_no_permitido';
  end if;
  return old;
end;
$$;

create trigger trg_presupuesto_validar before insert or update on presupuesto
  for each row execute function public.fn_presupuesto_validar();

create trigger trg_presupuesto_borrar before delete on presupuesto
  for each row execute function public.fn_presupuesto_borrar();

-- Los ítems sólo cambian mientras el presupuesto está abierto. Si el
-- presupuesto ya no existe (borrado en cascada) no hay nada que proteger.
create or replace function public.fn_presupuesto_item_bloqueo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.presupuesto_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.presupuesto_id, new.presupuesto_id];
  else
    v_ids := array[old.presupuesto_id];
  end if;

  if exists (
    select 1 from public.presupuesto p where p.id = any (v_ids) and p.estado = 'convertido'
  ) then
    raise exception 'El presupuesto está convertido: sus ítems no se pueden cambiar.'
      using errcode = 'PR001', hint = 'presupuesto_convertido_inmutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_presupuesto_item_bloqueo before insert or update or delete on presupuesto_item
  for each row execute function public.fn_presupuesto_item_bloqueo();

revoke execute on function public.fn_presupuesto_validar() from anon, authenticated, public;
revoke execute on function public.fn_presupuesto_borrar() from anon, authenticated, public;
revoke execute on function public.fn_presupuesto_item_bloqueo() from anon, authenticated, public;

-- ----- Guardar un presupuesto ----------------------------------------------

-- p_presupuesto: { cliente_id, fecha, valido_hasta, fecha_vencimiento_pago,
--                  condicion_pago, lista_precio_id, observaciones,
--                  neto, no_gravado, iva, total }
--   fecha vacía: hoy; valido_hasta vacío: fecha + 15; vencimiento vacío:
--   la fecha; condicion_pago vacía: cuenta_corriente.
-- p_items: [{ producto_id, codigo, descripcion, observaciones, unidad,
--             cantidad, precio_unitario, descuento_pct, gravado,
--             alicuota_iva, importe, iva }] (gravado vacío: true)
create or replace function public.guardar_presupuesto(
  p_id uuid,
  p_presupuesto jsonb,
  p_items jsonb
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
    (p_presupuesto->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
begin
  if v_id is not null then
    select p.estado into v_estado
    from public.presupuesto p
    where p.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el presupuesto.'
        using errcode = 'PR004', hint = 'presupuesto_inexistente';
    end if;
    if v_estado <> 'abierto' then
      raise exception 'El presupuesto está convertido: no se puede modificar.'
        using errcode = 'PR001', hint = 'presupuesto_convertido_inmutable';
    end if;
  end if;

  if v_id is null then
    insert into public.presupuesto (
      cliente_id, fecha, valido_hasta, fecha_vencimiento_pago, condicion_pago, lista_precio_id, observaciones,
      neto, no_gravado, iva, total
    )
    values (
      (p_presupuesto->>'cliente_id')::uuid,
      v_fecha,
      (p_presupuesto->>'valido_hasta')::date,
      (p_presupuesto->>'fecha_vencimiento_pago')::date,
      coalesce(p_presupuesto->>'condicion_pago', 'cuenta_corriente'),
      (p_presupuesto->>'lista_precio_id')::uuid,
      p_presupuesto->>'observaciones',
      coalesce((p_presupuesto->>'neto')::numeric, 0),
      coalesce((p_presupuesto->>'no_gravado')::numeric, 0),
      coalesce((p_presupuesto->>'iva')::numeric, 0),
      coalesce((p_presupuesto->>'total')::numeric, 0)
    )
    returning id into v_id;
  else
    update public.presupuesto
    set cliente_id = (p_presupuesto->>'cliente_id')::uuid,
        fecha = v_fecha,
        valido_hasta = (p_presupuesto->>'valido_hasta')::date,
        fecha_vencimiento_pago = (p_presupuesto->>'fecha_vencimiento_pago')::date,
        condicion_pago = coalesce(p_presupuesto->>'condicion_pago', 'cuenta_corriente'),
        lista_precio_id = (p_presupuesto->>'lista_precio_id')::uuid,
        observaciones = p_presupuesto->>'observaciones',
        neto = coalesce((p_presupuesto->>'neto')::numeric, 0),
        no_gravado = coalesce((p_presupuesto->>'no_gravado')::numeric, 0),
        iva = coalesce((p_presupuesto->>'iva')::numeric, 0),
        total = coalesce((p_presupuesto->>'total')::numeric, 0)
    where id = v_id;

    delete from public.presupuesto_item where presupuesto_id = v_id;
  end if;

  insert into public.presupuesto_item (
    presupuesto_id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad,
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

  return v_id;
end;
$$;

comment on function public.guardar_presupuesto(uuid, jsonb, jsonb) is
  'Crea o actualiza un presupuesto abierto y reemplaza sus ítems, en una sola transacción';

-- ----- Convertir en factura ------------------------------------------------

-- Crea un borrador de factura con guardar_borrador_comprobante (así valen
-- todas las reglas de los comprobantes): fecha de hoy, cliente, lista,
-- condición de pago, observaciones, totales e ítems copiados tal cual. El
-- vencimiento del pago se conserva si no quedó en el pasado; si no, hoy.
-- La letra sale de la condición IVA del cliente (vacía si no la tiene: la
-- factura la pide antes de autorizar). p_punto_venta vacío: el primer
-- punto de venta electrónico activo. Devuelve el id de la factura.
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
  elsif not exists (select 1 from public.punto_venta pv where pv.numero = v_pv and pv.activo) then
    raise exception 'El punto de venta % no existe o no está activo.', v_pv
      using errcode = 'PR007', hint = 'punto_venta_invalido';
  end if;

  select case cl.condicion_iva
           when 'Responsable Inscripto' then 'A'
           when 'Monotributista' then 'A'
           when 'Exento' then 'B'
           when 'Consumidor Final' then 'B'
         end
    into v_letra
  from public.cliente cl
  where cl.id = v_p.cliente_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', i.producto_id, 'codigo', i.codigo, 'descripcion', i.descripcion,
           'observaciones', i.observaciones, 'unidad', i.unidad, 'cantidad', i.cantidad,
           'precio_unitario', i.precio_unitario, 'descuento_pct', i.descuento_pct, 'gravado', i.gravado,
           'alicuota_iva', i.alicuota_iva, 'importe', i.importe, 'iva', i.iva
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
      'iva', v_p.iva,
      'total', v_p.total
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
  'Convierte un presupuesto abierto en un borrador de factura (copia cabecera, ítems y totales) y lo marca convertido, en una sola transacción. Devuelve el id de la factura';

revoke execute on function public.guardar_presupuesto(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.convertir_presupuesto(uuid, integer) from public, anon;
grant execute on function public.guardar_presupuesto(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.convertir_presupuesto(uuid, integer) to authenticated;

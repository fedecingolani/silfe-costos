-- =====================================================================
-- Charoli Gestión - Remitos de venta
-- Remitos (letra R) con los mismos campos comerciales que una factura más
-- los de la entrega: transporte, domicilio de entrega, valor declarado y
-- bultos. Tablas propias, como presupuesto: la tabla comprobante es
-- fiscal y un remito no va a ARCA ni toca la cuenta corriente. El ciclo
-- de vida es:
--
--   borrador -> emitido   (sólo con emitir_remito: toma número)
--   emitido  -> anulado   (sólo con anular_remito: conserva el número)
--
-- Los estados derivados de la facturación (parcial, facturado) llegan con
-- la facturación de remitos.
--
--   - borrador: se edita y se borra, ítems incluidos;
--   - emitido: la cabecera y los ítems se editan, salvo punto de venta,
--     número, cliente y fecha de emisión. No se borra (el número ya se
--     usó): se anula;
--   - anulado: no se modifica ni se borra, ni sus ítems.
--
-- Lo controlan triggers, así que vale también para SQL directo.
--
-- Numeración: por punto de venta (cualquiera activo, electrónico o no),
-- último + 1 al emitir, con candado consultivo e índice único, como los
-- comprobantes X. La app lo muestra como R-<pv>-<número>.
--
-- Bultos totales: suma de los bultos de los ítems, la mantienen los
-- triggers. No se escribe a mano: cualquier valor se reemplaza por la suma.
--
-- Errores de los triggers y RPC (SQLSTATE propio, estable para que la app
-- los traduzca; el HINT repite el motivo en forma de clave):
--   RM001 remito_anulado_inmutable (cabecera o ítems)
--   RM002 transicion_invalida
--   RM003 borrado_no_permitido
--   RM004 remito_inexistente
--   RM005 remito_sin_items       (al emitir)
--   RM006 campo_no_editable      (número, punto de venta, cliente, emisión)
--   RM007 punto_venta_invalido   (al emitir)
-- =====================================================================

-- ----- Remito ------------------------------------------------------------

create table remito (
  id                      uuid primary key default gen_random_uuid(),
  punto_venta             integer not null references punto_venta(numero) on delete restrict,
  numero                  bigint,
  cliente_id              uuid not null references cliente(id) on delete restrict,
  fecha                   date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  fecha_vencimiento_pago  date not null,
  condicion_pago          text not null default 'cuenta_corriente',
  lista_precio_id         uuid references lista_precio(id) on delete set null,
  transporte_id           uuid references transporte(id) on delete restrict,
  domicilio_entrega       text,
  observaciones           text,
  neto                    numeric(14,2) not null default 0,
  no_gravado              numeric(14,2) not null default 0,
  iva                     numeric(14,2) not null default 0,
  total                   numeric(14,2) not null default 0,
  valor_declarado         numeric(14,2) not null default 0,
  bultos_total            integer not null default 0,
  estado                  text not null default 'borrador',
  emitido_en              timestamptz,
  anulado_en              timestamptz,
  creado_por              uuid default auth.uid(),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),
  constraint remito_vencimiento_check check (fecha_vencimiento_pago >= fecha),
  constraint remito_condicion_pago_check check (condicion_pago in ('cuenta_corriente', 'contado')),
  constraint remito_no_gravado_check check (no_gravado >= 0),
  constraint remito_valor_declarado_check check (valor_declarado >= 0),
  constraint remito_bultos_total_check check (bultos_total >= 0),
  constraint remito_numero_check check (numero is null or numero > 0),
  constraint remito_estado_check check (estado in ('borrador', 'emitido', 'anulado')),
  constraint remito_numero_estado_check check ((numero is not null) = (estado in ('emitido', 'anulado'))),
  constraint remito_emitido_en_check check ((emitido_en is not null) = (estado in ('emitido', 'anulado'))),
  constraint remito_anulado_en_check check ((anulado_en is not null) = (estado = 'anulado'))
);

comment on table remito is
  'Remitos de venta (letra R). Registran la entrega; no van a ARCA ni a la cuenta corriente. Un emitido no se borra: se anula';
comment on column remito.punto_venta is
  'Punto de venta del remito (cualquiera activo, electrónico o no). Define la serie de numeración';
comment on column remito.numero is
  'Número del remito, correlativo propio por punto de venta. Vacío hasta que se emite. Se muestra como R-<pv>-<número>';
comment on column remito.fecha is 'Fecha del remito (por defecto hoy en Argentina)';
comment on column remito.fecha_vencimiento_pago is 'Vencimiento del cobro propuesto para la factura. Por defecto la fecha del remito';
comment on column remito.condicion_pago is 'cuenta_corriente (por defecto) o contado';
comment on column remito.lista_precio_id is 'Lista de precios de la que salen los precios';
comment on column remito.transporte_id is 'Transporte con el que viaja la mercadería. Arranca con el del cliente y se puede cambiar';
comment on column remito.domicilio_entrega is 'Domicilio de entrega, texto libre. Arranca con el del cliente';
comment on column remito.neto is 'Importe neto gravado (suma de los importes de los ítems gravados)';
comment on column remito.no_gravado is 'Importe no gravado (suma de los ítems no gravados)';
comment on column remito.iva is 'IVA total: suma por alícuota, cada una redondeada a 2 decimales';
comment on column remito.total is 'neto + no_gravado + iva';
comment on column remito.valor_declarado is 'Valor declarado de la mercadería transportada. Se sugiere con la suma de los ítems y se puede cambiar';
comment on column remito.bultos_total is 'Suma de los bultos de los ítems. La mantienen los triggers; no se escribe a mano';
comment on column remito.estado is 'borrador | emitido (tiene número) | anulado (conserva el número)';
comment on column remito.emitido_en is 'Momento en que se emitió';
comment on column remito.anulado_en is 'Momento en que se anuló';
comment on column remito.creado_por is 'Usuario que creó el remito (auth.uid()). Sin FK: los usuarios se manejan desde Auth';

create unique index remito_numero_unico on remito (punto_venta, numero) where numero is not null;
create index remito_cliente_idx on remito (cliente_id);
create index remito_fecha_idx on remito (fecha desc);
create index remito_estado_idx on remito (estado);
create index remito_lista_precio_idx on remito (lista_precio_id);
create index remito_transporte_idx on remito (transporte_id);

create trigger trg_remito_actualizado before update on remito
  for each row execute function fn_set_actualizado_en();

-- ----- Ítems -------------------------------------------------------------

create table remito_item (
  id               uuid primary key default gen_random_uuid(),
  remito_id        uuid not null references remito(id) on delete cascade,
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
  bultos           integer not null default 0,
  constraint remito_item_descripcion_check check (btrim(descripcion) <> ''),
  constraint remito_item_cantidad_check check (cantidad > 0),
  constraint remito_item_precio_check check (precio_unitario >= 0),
  constraint remito_item_descuento_check check (descuento_pct between 0 and 100),
  constraint remito_item_alicuota_check check (
    (gravado and alicuota_iva is not null and alicuota_iva in (0, 2.5, 5, 10.5, 21, 27))
    or (not gravado and alicuota_iva is null)
  ),
  constraint remito_item_no_gravado_iva_check check (gravado or iva = 0),
  constraint remito_item_bultos_check check (bultos >= 0)
);

comment on table remito_item is 'Renglones de un remito: un producto del catálogo o un ítem libre, con sus bultos';
comment on column remito_item.producto_id is 'Producto del catálogo. Vacío en un ítem libre';
comment on column remito_item.codigo is 'Copia del código del producto al cargarlo';
comment on column remito_item.observaciones is 'Texto que se imprime debajo de la descripción';
comment on column remito_item.precio_unitario is 'Precio unitario sin IVA, con 4 decimales';
comment on column remito_item.descuento_pct is 'Descuento del renglón en %';
comment on column remito_item.gravado is 'false: ítem no gravado, sin alícuota ni IVA. true: gravado con alicuota_iva';
comment on column remito_item.alicuota_iva is 'Alícuota de IVA en %: 0, 2.5, 5, 10.5, 21 o 27. Vacía en un ítem no gravado';
comment on column remito_item.importe is 'cantidad × precio × (1 − descuento), redondeado a 2 decimales (sin IVA)';
comment on column remito_item.iva is 'IVA del renglón, redondeado a 2 decimales';
comment on column remito_item.bultos is 'Cantidad de bultos del renglón (entero, 0 o más)';

create index remito_item_remito_idx on remito_item (remito_id, orden);
create index remito_item_producto_idx on remito_item (producto_id);

-- ----- Estado e inmutabilidad del remito ---------------------------------

-- Valida el alta y cada cambio:
--   - el alta es siempre borrador, sin número ni fechas de emisión o
--     anulación;
--   - bultos_total se recalcula siempre desde los ítems;
--   - borrador -> emitido sólo desde emitir_remito (marca la transacción
--     con remito.emitiendo = id); un borrador no recibe número a mano;
--   - emitido -> anulado sólo desde anular_remito (remito.anulando = id),
--     sin cambiar nada más;
--   - en un emitido no cambian punto de venta, número, cliente ni emisión;
--   - un anulado no cambia.
create or replace function public.fn_remito_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignorar text[] := array['estado', 'anulado_en', 'actualizado_en'];
begin
  new.fecha_vencimiento_pago := coalesce(new.fecha_vencimiento_pago, new.fecha);

  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' or new.numero is not null
      or new.emitido_en is not null or new.anulado_en is not null
    then
      raise exception 'Un remito se crea en borrador y sin número: se emite con emitir_remito.'
        using errcode = 'RM002', hint = 'transicion_invalida';
    end if;
    new.bultos_total := 0;
    return new;
  end if;

  select coalesce(sum(i.bultos), 0)::integer into new.bultos_total
  from public.remito_item i
  where i.remito_id = new.id;

  if old.estado = 'anulado' then
    if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
      raise exception 'El remito está anulado: no se puede modificar.'
        using errcode = 'RM001', hint = 'remito_anulado_inmutable';
    end if;
    return new;
  end if;

  if old.estado = 'emitido' then
    if new.estado = 'anulado' then
      if coalesce(current_setting('remito.anulando', true), '') <> new.id::text
        or (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar)
      then
        raise exception 'Un remito se anula sólo con anular_remito.'
          using errcode = 'RM002', hint = 'transicion_invalida';
      end if;
      new.anulado_en := coalesce(new.anulado_en, now());
      return new;
    end if;

    if new.estado <> 'emitido' then
      raise exception 'Un remito emitido sólo puede pasar a anulado.'
        using errcode = 'RM002', hint = 'transicion_invalida';
    end if;

    if new.punto_venta is distinct from old.punto_venta
      or new.numero is distinct from old.numero
      or new.cliente_id is distinct from old.cliente_id
      or new.emitido_en is distinct from old.emitido_en
    then
      raise exception 'En un remito emitido no cambian el punto de venta, el número, el cliente ni la emisión.'
        using errcode = 'RM006', hint = 'campo_no_editable';
    end if;
    return new;
  end if;

  -- old.estado = 'borrador'
  if new.estado = 'emitido' then
    if coalesce(current_setting('remito.emitiendo', true), '') <> new.id::text then
      raise exception 'Un remito se emite sólo con emitir_remito.'
        using errcode = 'RM002', hint = 'transicion_invalida';
    end if;
    new.emitido_en := coalesce(new.emitido_en, now());
    return new;
  end if;

  if new.estado <> 'borrador' then
    raise exception 'Un remito en borrador sólo puede pasar a emitido.'
      using errcode = 'RM002', hint = 'transicion_invalida';
  end if;

  if new.numero is not null then
    raise exception 'El número del remito se asigna al emitir.'
      using errcode = 'RM006', hint = 'campo_no_editable';
  end if;

  return new;
end;
$$;

create or replace function public.fn_remito_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'El remito está %: no se puede borrar (un emitido se anula).', old.estado
      using errcode = 'RM003', hint = 'borrado_no_permitido';
  end if;
  return old;
end;
$$;

create trigger trg_remito_validar before insert or update on remito
  for each row execute function public.fn_remito_validar();

create trigger trg_remito_borrar before delete on remito
  for each row execute function public.fn_remito_borrar();

-- Los ítems cambian mientras el remito está en borrador o emitido; no en
-- uno anulado. Si el remito ya no existe (borrado en cascada) no hay nada
-- que proteger.
create or replace function public.fn_remito_item_bloqueo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.remito_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.remito_id, new.remito_id];
  else
    v_ids := array[old.remito_id];
  end if;

  if exists (
    select 1 from public.remito r where r.id = any (v_ids) and r.estado = 'anulado'
  ) then
    raise exception 'El remito está anulado: sus ítems no se pueden cambiar.'
      using errcode = 'RM001', hint = 'remito_anulado_inmutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Después de cada cambio de ítems, el remito recalcula bultos_total (el
-- trigger de validación del remito lo toma de la suma de los ítems).
create or replace function public.fn_remito_item_bultos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.remito_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.remito_id, new.remito_id];
  else
    v_ids := array[old.remito_id];
  end if;

  update public.remito r
  set bultos_total = s.total
  from (
    select x.id, coalesce((select sum(i.bultos) from public.remito_item i where i.remito_id = x.id), 0)::integer as total
    from unnest(v_ids) as x(id)
  ) s
  where r.id = s.id
    and r.bultos_total is distinct from s.total;

  return null;
end;
$$;

create trigger trg_remito_item_bloqueo before insert or update or delete on remito_item
  for each row execute function public.fn_remito_item_bloqueo();

create trigger trg_remito_item_bultos after insert or update or delete on remito_item
  for each row execute function public.fn_remito_item_bultos();

revoke execute on function public.fn_remito_validar() from anon, authenticated, public;
revoke execute on function public.fn_remito_borrar() from anon, authenticated, public;
revoke execute on function public.fn_remito_item_bloqueo() from anon, authenticated, public;
revoke execute on function public.fn_remito_item_bultos() from anon, authenticated, public;

-- ----- Emitir ------------------------------------------------------------

-- Emite un borrador con ítems en un punto de venta activo: toma el último
-- número del punto de venta + 1 (con candado consultivo por punto de
-- venta, así dos emisiones a la vez no chocan) y lo deja emitido.
create or replace function public.emitir_remito(p_id uuid)
returns public.remito
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_r public.remito;
  v_numero bigint;
begin
  select * into v_r
  from public.remito r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el remito.'
      using errcode = 'RM004', hint = 'remito_inexistente';
  end if;
  if v_r.estado <> 'borrador' then
    raise exception 'Sólo se emite un remito en borrador (el remito está %).', v_r.estado
      using errcode = 'RM002', hint = 'transicion_invalida';
  end if;
  if not exists (select 1 from public.remito_item i where i.remito_id = v_r.id) then
    raise exception 'El remito no tiene ítems.'
      using errcode = 'RM005', hint = 'remito_sin_items';
  end if;
  if not exists (select 1 from public.punto_venta pv where pv.numero = v_r.punto_venta and pv.activo) then
    raise exception 'El punto de venta % no existe o no está activo.', v_r.punto_venta
      using errcode = 'RM007', hint = 'punto_venta_invalido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('remito:' || v_r.punto_venta::text, 0));

  select coalesce(max(r.numero), 0) + 1 into v_numero
  from public.remito r
  where r.punto_venta = v_r.punto_venta
    and r.numero is not null;

  -- El trigger sólo deja pasar a emitido con esta marca de la transacción.
  perform set_config('remito.emitiendo', v_r.id::text, true);
  update public.remito
  set estado = 'emitido',
      numero = v_numero,
      emitido_en = now()
  where id = v_r.id
  returning * into v_r;
  perform set_config('remito.emitiendo', '', true);

  return v_r;
end;
$$;

comment on function public.emitir_remito(uuid) is
  'Emite un remito en borrador con ítems: le asigna el siguiente número de su punto de venta y lo deja emitido. Devuelve el remito';

-- ----- Anular ------------------------------------------------------------

-- Anula un remito emitido; conserva el número.
-- Pendiente de la facturación de remitos: rechazar la anulación si el
-- remito tiene algo facturado (incluidos los borradores de factura).
create or replace function public.anular_remito(p_id uuid)
returns public.remito
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_r public.remito;
begin
  select * into v_r
  from public.remito r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el remito.'
      using errcode = 'RM004', hint = 'remito_inexistente';
  end if;
  if v_r.estado <> 'emitido' then
    raise exception 'Sólo se anula un remito emitido (el remito está %).', v_r.estado
      using errcode = 'RM002', hint = 'transicion_invalida';
  end if;

  -- El trigger sólo deja pasar a anulado con esta marca de la transacción.
  perform set_config('remito.anulando', v_r.id::text, true);
  update public.remito
  set estado = 'anulado',
      anulado_en = now()
  where id = v_r.id
  returning * into v_r;
  perform set_config('remito.anulando', '', true);

  return v_r;
end;
$$;

comment on function public.anular_remito(uuid) is
  'Anula un remito emitido (conserva el número). Devuelve el remito';

revoke execute on function public.emitir_remito(uuid) from public, anon;
revoke execute on function public.anular_remito(uuid) from public, anon;
grant execute on function public.emitir_remito(uuid) to authenticated;
grant execute on function public.anular_remito(uuid) to authenticated;

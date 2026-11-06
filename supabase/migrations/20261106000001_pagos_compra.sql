-- =====================================================================
-- Charoli Gestión - Órdenes de pago a proveedores (Compras)
--
-- Es la cobranza al revés (20261026000001_cobranzas.sql): una orden de
-- pago cancela facturas y notas de débito de compra confirmadas de un
-- proveedor con sus medios de pago. Lo que no se imputa queda a favor.
--
-- Ciclo de vida (los nombres del lado de compras):
--   borrador -> confirmado -> anulado
-- Un borrador se edita y se borra libremente, con sus medios e
-- imputaciones (guardar_orden_pago los reemplaza). Al confirmarlo
-- (confirmar_orden_pago) toma número y queda inmutable con sus medios e
-- imputaciones; sólo se le agregan imputaciones automáticas (la
-- aplicación de su saldo a favor). Se corrige anulándolo
-- (anular_orden_pago, con motivo): se deshacen todas sus imputaciones y
-- sus cheques de terceros vuelven a la cartera. Las reglas viven en
-- triggers, así que valen también para SQL directo.
--
-- Numeración: propia y sin punto de venta (OP-00000001). Un contador de
-- una sola fila (orden_pago_numeracion) que confirmar_orden_pago toma con
-- select ... for update en la misma transacción: sin huecos ni carreras.
-- authenticated sólo lo lee; confirmar_orden_pago es security definer
-- para poder avanzarlo (como emitir_recibo en 20261028000001). El trigger
-- exige que el número confirmado sea el recién tomado del contador.
--
-- Medios:
--   - efectivo y transferencia: sin banco ni caja (Finanzas todavía no
--     existe). La transferencia lleva una referencia opcional;
--   - cheque_tercero: un cheque de la cartera (en_cartera, de un recibo
--     emitido), por su importe (lo pone la base). Al confirmar la orden
--     pasa a "entregado" con entregado_a = nombre del proveedor y los
--     vínculos cheque.proveedor_id y cheque.orden_pago_id (y su fila de
--     historial). Al anular la orden vuelve a en_cartera sin vínculos. Si
--     el cheque ya no está entregado por esta orden (lo rechazaron), la
--     orden no se anula;
--   - cheque_propio: banco, número, fecha de pago e importe, sin chequera.
-- Sin retenciones.
--
-- Débitos: facturas y notas de débito de compra confirmadas. Créditos:
-- órdenes de pago confirmadas y notas de crédito de compra confirmadas.
-- Una imputación cuenta (vigente) si sale de una orden confirmada o de una
-- nota de crédito. Las de un borrador no cancelan nada todavía, pero sí
-- cuentan para el tope de la propia orden.
--
-- Saldo a favor automático (como 20261027000001_cobranzas_saldo_a_favor):
-- al confirmar una factura o nota de débito de compra se le imputan los
-- créditos del proveedor con algo disponible (v_proveedor_saldo_a_favor),
-- del más viejo al más nuevo. Al confirmar una nota de crédito con
-- factura asociada se imputa a esa factura hasta su saldo; el resto (o
-- toda una nota suelta) queda a favor. Una nota de crédito también se
-- imputa a mano a otro débito del proveedor (insert en imputacion_compra).
-- A diferencia de ventas, una falla de la aplicación deshace la
-- confirmación: no hay un CAE de ARCA que conservar.
--
-- Anular un comprobante de compra (anular_comprobante_compra):
--   - una factura o nota de débito con imputaciones vigentes no se anula
--     (OP016): primero se anula la orden de pago o la nota de crédito;
--   - una nota de crédito sí: sus imputaciones se deshacen, como las de
--     una orden anulada.
--
-- Errores (SQLSTATE propio, estable; el HINT repite el motivo como clave):
--   OP001 orden_pago_inmutable         (confirmada o anulada, sus medios e
--                                       imputaciones; imputaciones de NC)
--   OP002 transicion_invalida
--   OP003 orden_pago_sin_medios
--   OP004 total_distinto_medios
--   OP005 imputacion_excede_credito    (más que el total de la orden o la NC)
--   OP006 imputacion_excede_saldo      (más que el saldo pendiente del débito)
--   OP007 debito_invalido              (no es factura o ND confirmada)
--   OP008 proveedor_distinto
--   OP009 cheque_no_disponible         (no está en la cartera)
--   OP010 cheque_no_devolvible         (anular con un cheque que ya no
--                                       está entregado por la orden)
--   OP011 medio_invalido
--   OP012 orden_pago_inexistente
--   OP013 numeracion_invalida
--   OP014 credito_invalido             (origen: NC de compra confirmada)
--   OP015 motivo_requerido
--   OP016 comprobante_con_imputaciones (anular un débito con imputaciones)
--   OP017 cheque_vinculo_invalido      (cambiar a mano el vínculo del
--                                       cheque con la orden)
-- =====================================================================

-- ----- Contador -----------------------------------------------------------

create table orden_pago_numeracion (
  id             boolean primary key default true,
  ultimo_numero  bigint not null default 0,
  constraint orden_pago_numeracion_unica check (id),
  constraint orden_pago_numeracion_ultimo_check check (ultimo_numero >= 0)
);

comment on table orden_pago_numeracion is
  'Contador de las órdenes de pago (una sola fila). Lo avanza confirmar_orden_pago con select ... for update';

insert into orden_pago_numeracion (id) values (true) on conflict (id) do nothing;

-- ----- Orden de pago ------------------------------------------------------

create table orden_pago (
  id                uuid primary key default gen_random_uuid(),
  numero            bigint,
  numero_texto      text generated always as (
    case when numero is null then null else 'OP-' || lpad(numero::text, 8, '0') end
  ) stored,
  fecha             date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  proveedor_id      uuid not null references proveedor(id) on delete restrict,
  total             numeric(14,2) not null default 0,
  estado            text not null default 'borrador',
  motivo_anulacion  text,
  observaciones     text,
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  confirmado_en     timestamptz,
  anulado_en        timestamptz,
  constraint orden_pago_estado_check check (estado in ('borrador', 'confirmado', 'anulado')),
  constraint orden_pago_total_check check (total >= 0),
  constraint orden_pago_numero_check check ((numero is null) = (estado = 'borrador') and (numero is null or numero > 0)),
  constraint orden_pago_confirmado_en_check check ((confirmado_en is not null) = (estado in ('confirmado', 'anulado'))),
  constraint orden_pago_anulado_check check (
    (estado = 'anulado') = (anulado_en is not null)
    and (estado <> 'anulado' or (motivo_anulacion is not null and btrim(motivo_anulacion) <> ''))
  )
);

comment on table orden_pago is
  'Órdenes de pago a proveedores. Una confirmada no se modifica: se anula';
comment on column orden_pago.numero is 'Número propio y correlativo. Vacío en borrador';
comment on column orden_pago.numero_texto is 'Número para mostrar: OP-00000001';
comment on column orden_pago.total is 'Suma de los medios de pago (se exige al confirmar)';
comment on column orden_pago.estado is 'borrador | confirmado | anulado';

create unique index orden_pago_numero_unico on orden_pago (numero) where numero is not null;
create index orden_pago_proveedor_idx on orden_pago (proveedor_id);
create index orden_pago_fecha_idx on orden_pago (fecha desc);

create trigger trg_orden_pago_actualizado before update on orden_pago
  for each row execute function fn_set_actualizado_en();

-- ----- Medios de pago -----------------------------------------------------

create table orden_pago_medio (
  id             uuid primary key default gen_random_uuid(),
  orden_pago_id  uuid not null references orden_pago(id) on delete cascade,
  orden          integer not null default 0,
  tipo           text not null,
  importe        numeric(14,2) not null,
  referencia     text,
  cheque_id      uuid references cheque(id) on delete restrict,
  banco          text,
  numero         text,
  fecha_pago     date,
  constraint orden_pago_medio_tipo_check check (tipo in ('efectivo', 'transferencia', 'cheque_tercero', 'cheque_propio')),
  constraint orden_pago_medio_importe_check check (importe > 0),
  constraint orden_pago_medio_referencia_check check (referencia is null or tipo = 'transferencia'),
  constraint orden_pago_medio_cheque_tercero_check check ((tipo = 'cheque_tercero') = (cheque_id is not null)),
  constraint orden_pago_medio_cheque_propio_check check (
    (tipo = 'cheque_propio'
      and banco is not null and btrim(banco) <> ''
      and numero is not null and btrim(numero) <> ''
      and fecha_pago is not null)
    or (tipo <> 'cheque_propio' and banco is null and numero is null and fecha_pago is null)
  ),
  constraint orden_pago_medio_cheque_unico unique (orden_pago_id, cheque_id)
);

comment on table orden_pago_medio is 'Medios de pago de una orden de pago. El total de la orden es su suma';
comment on column orden_pago_medio.tipo is 'efectivo | transferencia | cheque_tercero | cheque_propio';
comment on column orden_pago_medio.referencia is 'Transferencia: referencia de la operación (opcional)';
comment on column orden_pago_medio.cheque_id is 'Cheque de terceros de la cartera (mismo importe)';
comment on column orden_pago_medio.banco is 'Cheque propio: banco';
comment on column orden_pago_medio.numero is 'Cheque propio: número';
comment on column orden_pago_medio.fecha_pago is 'Cheque propio: fecha de pago';

create index orden_pago_medio_orden_pago_idx on orden_pago_medio (orden_pago_id, orden);
create index orden_pago_medio_cheque_idx on orden_pago_medio (cheque_id);

-- ----- Imputaciones -------------------------------------------------------

create table imputacion_compra (
  id                     uuid primary key default gen_random_uuid(),
  orden_pago_id          uuid references orden_pago(id) on delete cascade,
  nota_credito_id        uuid references comprobante_compra(id) on delete restrict,
  comprobante_compra_id  uuid not null references comprobante_compra(id) on delete restrict,
  importe                numeric(14,2) not null,
  fecha                  date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  automatica             boolean not null default false,
  creado_por             uuid default auth.uid(),
  creado_en              timestamptz not null default now(),
  constraint imputacion_compra_origen_check check (num_nonnulls(orden_pago_id, nota_credito_id) = 1),
  constraint imputacion_compra_importe_check check (importe > 0)
);

comment on table imputacion_compra is
  'Cancelación de un débito de compra (factura o nota de débito) con una orden de pago o una nota de crédito de compra';
comment on column imputacion_compra.automatica is
  'true: aplicación automática del saldo a favor (o de una nota de crédito a su factura)';

create unique index imputacion_compra_orden_pago_unica on imputacion_compra (orden_pago_id, comprobante_compra_id)
  where orden_pago_id is not null;
create unique index imputacion_compra_nc_unica on imputacion_compra (nota_credito_id, comprobante_compra_id)
  where nota_credito_id is not null;
create index imputacion_compra_comprobante_idx on imputacion_compra (comprobante_compra_id);

-- ----- Cheques de terceros entregados a un proveedor ----------------------

alter table cheque
  add column proveedor_id uuid references proveedor(id) on delete restrict,
  add column orden_pago_id uuid references orden_pago(id) on delete restrict,
  add constraint cheque_orden_pago_check check ((orden_pago_id is null) = (proveedor_id is null)),
  add constraint cheque_orden_pago_estado_check check (orden_pago_id is null or estado in ('entregado', 'rechazado'));

comment on column cheque.proveedor_id is 'Proveedor al que se entregó con una orden de pago';
comment on column cheque.orden_pago_id is 'Orden de pago con que se entregó. Al anularla, el cheque vuelve a la cartera';

create index cheque_orden_pago_idx on cheque (orden_pago_id);
create index cheque_proveedor_idx on cheque (proveedor_id);

-- ----- Ayudas -------------------------------------------------------------

create or replace function public.fn_es_debito_compra(p_tipo text, p_estado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tipo in ('factura', 'nota_debito') and p_estado = 'confirmado';
$$;

create or replace function public.fn_es_nota_credito_compra(p_tipo text, p_estado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tipo = 'nota_credito' and p_estado = 'confirmado';
$$;

-- Lo imputado a un débito de compra por imputaciones vigentes (orden
-- confirmada o nota de crédito), más las de la orden p_orden_pago aunque
-- sea borrador, sin contar la imputación p_excluir.
create or replace function public.fn_imputado_debito_compra(p_comprobante uuid, p_orden_pago uuid, p_excluir uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(i.importe), 0)
  from public.imputacion_compra i
  left join public.orden_pago o on o.id = i.orden_pago_id
  where i.comprobante_compra_id = p_comprobante
    and i.id is distinct from p_excluir
    and (i.nota_credito_id is not null or o.estado = 'confirmado' or i.orden_pago_id = p_orden_pago);
$$;

-- «FC A 00003-00012345», como numeroComprobanteCompra (src/lib/compras/comprobantes/numero.ts).
create or replace function public.fn_numero_comprobante_compra(p_tipo text, p_letra text, p_punto_venta integer, p_numero bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tipo when 'factura' then 'FC' when 'nota_credito' then 'NC' else 'ND' end
    || ' ' || p_letra || ' ' || lpad(p_punto_venta::text, 5, '0') || '-' || lpad(p_numero::text, 8, '0');
$$;

-- ----- Orden de pago: estado, confirmación e inmutabilidad ----------------

create or replace function public.fn_orden_pago_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ultimo bigint;
  v_suma numeric;
  v_cantidad integer;
  v_fila record;
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Una orden de pago se crea en borrador (se recibió "%").', new.estado
        using errcode = 'OP002', hint = 'transicion_invalida';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.estado = 'anulado' then
    raise exception 'La orden de pago está anulada: no se puede modificar.'
      using errcode = 'OP001', hint = 'orden_pago_inmutable';
  end if;

  if old.estado = 'confirmado' then
    if new.estado = 'confirmado' then
      raise exception 'La orden de pago está confirmada: no se puede modificar. Si se cargó mal, anulala.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    if new.estado <> 'anulado' then
      raise exception 'Una orden de pago no puede pasar de % a %.', old.estado, new.estado
        using errcode = 'OP002', hint = 'transicion_invalida';
    end if;
    if new.numero is distinct from old.numero
      or new.fecha is distinct from old.fecha
      or new.proveedor_id is distinct from old.proveedor_id
      or new.total is distinct from old.total
      or new.observaciones is distinct from old.observaciones
      or new.confirmado_en is distinct from old.confirmado_en
      or new.creado_por is distinct from old.creado_por
      or new.creado_en is distinct from old.creado_en
    then
      raise exception 'Al anular una orden de pago sólo se registra el motivo.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    if new.motivo_anulacion is null or btrim(new.motivo_anulacion) = '' then
      raise exception 'Para anular la orden de pago, indicá el motivo.'
        using errcode = 'OP015', hint = 'motivo_requerido';
    end if;
    -- Sus cheques de terceros vuelven a la cartera: tienen que seguir
    -- entregados por esta orden (bloqueados mientras se controla).
    for v_fila in
      select ch.numero, ch.banco, ch.estado, ch.orden_pago_id
      from public.orden_pago_medio m
      join public.cheque ch on ch.id = m.cheque_id
      where m.orden_pago_id = new.id
      order by ch.id
      for update of ch
    loop
      if v_fila.estado <> 'entregado' or v_fila.orden_pago_id is distinct from new.id then
        raise exception 'El cheque N° % (%) está %: la orden de pago no se puede anular.',
          v_fila.numero, v_fila.banco, v_fila.estado
          using errcode = 'OP010', hint = 'cheque_no_devolvible';
      end if;
    end loop;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_en := now();
    return new;
  end if;

  -- Desde borrador
  if new.estado = 'anulado' then
    raise exception 'Una orden de pago en borrador no se anula: se borra.'
      using errcode = 'OP002', hint = 'transicion_invalida';
  end if;

  if new.estado = 'borrador' then
    return new;
  end if;

  -- borrador -> confirmado
  select n.ultimo_numero into v_ultimo from public.orden_pago_numeracion n;
  if new.numero is null or v_ultimo is null or new.numero <> v_ultimo then
    raise exception 'El número de la orden de pago lo asigna confirmar_orden_pago.'
      using errcode = 'OP013', hint = 'numeracion_invalida';
  end if;

  select count(*), coalesce(sum(m.importe), 0) into v_cantidad, v_suma
  from public.orden_pago_medio m
  where m.orden_pago_id = new.id;
  if v_cantidad = 0 then
    raise exception 'La orden de pago no tiene medios de pago: cargá al menos uno.'
      using errcode = 'OP003', hint = 'orden_pago_sin_medios';
  end if;
  if v_suma <> new.total then
    raise exception 'El total de la orden de pago ($ %) no coincide con la suma de sus medios ($ %).', new.total, v_suma
      using errcode = 'OP004', hint = 'total_distinto_medios';
  end if;

  -- Cheques de terceros: en la cartera, por su importe. Bloqueados en
  -- orden de id: otra orden con el mismo cheque espera y después ya no lo
  -- encuentra en la cartera.
  for v_fila in
    select ch.numero, ch.banco, ch.estado, ch.importe, r.estado as recibo_estado, m.importe as medio_importe
    from public.orden_pago_medio m
    join public.cheque ch on ch.id = m.cheque_id
    join public.recibo r on r.id = ch.recibo_id
    where m.orden_pago_id = new.id
    order by ch.id
    for update of ch
  loop
    if v_fila.estado <> 'en_cartera' or v_fila.recibo_estado <> 'emitido' then
      raise exception 'El cheque N° % (%) ya no está en la cartera.', v_fila.numero, v_fila.banco
        using errcode = 'OP009', hint = 'cheque_no_disponible';
    end if;
    if v_fila.medio_importe <> v_fila.importe then
      raise exception 'El cheque N° % (%) va por su importe ($ %).', v_fila.numero, v_fila.banco, v_fila.importe
        using errcode = 'OP011', hint = 'medio_invalido';
    end if;
  end loop;

  -- Imputaciones: del mismo proveedor, sin superar el total ni el saldo de cada débito.
  if (select coalesce(sum(i.importe), 0) from public.imputacion_compra i where i.orden_pago_id = new.id) > new.total then
    raise exception 'Las imputaciones superan el total de la orden de pago ($ %).', new.total
      using errcode = 'OP005', hint = 'imputacion_excede_credito';
  end if;
  for v_fila in
    select c.id, c.proveedor_id, c.tipo, c.estado, c.letra, c.punto_venta, c.numero, c.total
    from public.imputacion_compra i
    join public.comprobante_compra c on c.id = i.comprobante_compra_id
    where i.orden_pago_id = new.id
    order by c.id
    for update of c
  loop
    if not public.fn_es_debito_compra(v_fila.tipo, v_fila.estado) then
      raise exception 'La orden de pago imputa a % (está %): sólo se pagan facturas y notas de débito confirmadas.',
        public.fn_numero_comprobante_compra(v_fila.tipo, v_fila.letra, v_fila.punto_venta, v_fila.numero), v_fila.estado
        using errcode = 'OP007', hint = 'debito_invalido';
    end if;
    if v_fila.proveedor_id <> new.proveedor_id then
      raise exception 'La orden de pago imputa a un comprobante de otro proveedor.'
        using errcode = 'OP008', hint = 'proveedor_distinto';
    end if;
    if public.fn_imputado_debito_compra(v_fila.id, new.id, null) > v_fila.total then
      raise exception 'Las imputaciones superan el saldo pendiente de %.',
        public.fn_numero_comprobante_compra(v_fila.tipo, v_fila.letra, v_fila.punto_venta, v_fila.numero)
        using errcode = 'OP006', hint = 'imputacion_excede_saldo';
    end if;
  end loop;

  new.confirmado_en := now();
  return new;
end;
$$;

-- Al confirmar: sus cheques de terceros (ya bloqueados y controlados)
-- pasan a entregados al proveedor. El historial lo escribe el trigger del cheque.
create or replace function public.fn_orden_pago_confirmada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.cheque ch
  set estado = 'entregado',
      entregado_a = p.nombre,
      proveedor_id = new.proveedor_id,
      orden_pago_id = new.id,
      estado_fecha = new.fecha,
      estado_observacion = 'Orden de pago ' || new.numero_texto
  from public.orden_pago_medio m, public.proveedor p
  where m.orden_pago_id = new.id
    and m.cheque_id = ch.id
    and p.id = new.proveedor_id;
  return null;
end;
$$;

-- Al anular: se deshacen sus imputaciones (los débitos vuelven a quedar
-- pendientes) y sus cheques de terceros vuelven a la cartera.
create or replace function public.fn_orden_pago_anulada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.imputacion_compra where orden_pago_id = new.id;
  update public.cheque
  set estado = 'en_cartera',
      entregado_a = null,
      proveedor_id = null,
      orden_pago_id = null,
      estado_fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date,
      estado_observacion = 'Orden de pago ' || new.numero_texto || ' anulada: ' || new.motivo_anulacion
  where orden_pago_id = new.id;
  return null;
end;
$$;

create or replace function public.fn_orden_pago_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'La orden de pago está %: no se puede borrar. Si se cargó mal, anulala.', old.estado
      using errcode = 'OP001', hint = 'orden_pago_inmutable';
  end if;
  return old;
end;
$$;

create trigger trg_orden_pago_validar before insert or update on orden_pago
  for each row execute function public.fn_orden_pago_validar();

create trigger trg_orden_pago_confirmada after update on orden_pago
  for each row when (old.estado = 'borrador' and new.estado = 'confirmado')
  execute function public.fn_orden_pago_confirmada();

create trigger trg_orden_pago_anulada after update on orden_pago
  for each row when (old.estado = 'confirmado' and new.estado = 'anulado')
  execute function public.fn_orden_pago_anulada();

create trigger trg_orden_pago_borrar before delete on orden_pago
  for each row execute function public.fn_orden_pago_borrar();

-- ----- Medios: sólo en borrador -------------------------------------------

create or replace function public.fn_orden_pago_medio_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estado text;
  v_cheque record;
begin
  select o.estado into v_estado
  from public.orden_pago o
  where o.id = case when tg_op = 'DELETE' then old.orden_pago_id else new.orden_pago_id end;

  if tg_op = 'UPDATE' and new.orden_pago_id is distinct from old.orden_pago_id then
    raise exception 'Un medio de pago no cambia de orden de pago.'
      using errcode = 'OP011', hint = 'medio_invalido';
  end if;

  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'La orden de pago está %: sus medios de pago no se pueden cambiar.', v_estado
      using errcode = 'OP001', hint = 'orden_pago_inmutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.cheque_id is not null then
    select ch.numero, ch.banco, ch.importe, ch.estado, r.estado as recibo_estado into v_cheque
    from public.cheque ch
    join public.recibo r on r.id = ch.recibo_id
    where ch.id = new.cheque_id;
    if not found or v_cheque.estado <> 'en_cartera' or v_cheque.recibo_estado <> 'emitido' then
      raise exception 'El cheque elegido no está en la cartera.'
        using errcode = 'OP009', hint = 'cheque_no_disponible';
    end if;
    if new.importe <> v_cheque.importe then
      raise exception 'El cheque N° % (%) va por su importe ($ %).', v_cheque.numero, v_cheque.banco, v_cheque.importe
        using errcode = 'OP011', hint = 'medio_invalido';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_orden_pago_medio_validar before insert or update or delete on orden_pago_medio
  for each row execute function public.fn_orden_pago_medio_validar();

-- ----- Cheques: lo de 20261026000001 más el vínculo con la orden de pago --

-- Igual que en 20261026000001_cobranzas.sql, más:
--   - un cheque nace sin proveedor ni orden de pago;
--   - el vínculo (proveedor_id, orden_pago_id) sólo cambia de dos formas:
--     al confirmar una orden que lo tiene como medio (en_cartera ->
--     entregado, al proveedor de la orden) y al anularla (entregado ->
--     en_cartera, sin vínculo). Cualquier otro cambio es OP017;
--   - la vuelta entregado -> en_cartera sólo es esa.
create or replace function public.fn_cheque_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recibo record;
  v_nd record;
  v_vinculo_ok boolean;
begin
  select r.estado, r.cliente_id into v_recibo
  from public.recibo r
  where r.id = case when tg_op = 'DELETE' then old.recibo_id else new.recibo_id end;

  if tg_op = 'DELETE' then
    if v_recibo.estado is null or v_recibo.estado = 'borrador' then
      return old;
    end if;
    raise exception 'El cheque es de un recibo %: no se puede borrar.', v_recibo.estado
      using errcode = 'CB001', hint = 'recibo_inmutable';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'en_cartera' then
      raise exception 'Un cheque entra a la cartera en estado en_cartera.'
        using errcode = 'CB009', hint = 'cheque_transicion_invalida';
    end if;
    if new.orden_pago_id is not null or new.proveedor_id is not null then
      raise exception 'Un cheque entra a la cartera sin proveedor ni orden de pago.'
        using errcode = 'OP017', hint = 'cheque_vinculo_invalido';
    end if;
    if v_recibo.estado <> 'borrador' then
      raise exception 'El recibo está %: no se le agregan cheques.', v_recibo.estado
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if new.cliente_id <> v_recibo.cliente_id then
      raise exception 'El cheque tiene que ser del cliente del recibo.'
        using errcode = 'CB008', hint = 'cliente_distinto';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.recibo_id is distinct from old.recibo_id then
    raise exception 'Un cheque no cambia de recibo.'
      using errcode = 'CB017', hint = 'cheque_bloqueado';
  end if;

  -- Vínculo con la orden de pago
  if new.orden_pago_id is distinct from old.orden_pago_id or new.proveedor_id is distinct from old.proveedor_id then
    if old.orden_pago_id is null and new.orden_pago_id is not null then
      -- Entrega: la orden está confirmada, es del proveedor y tiene el cheque como medio.
      v_vinculo_ok := old.estado = 'en_cartera' and new.estado = 'entregado' and exists (
        select 1
        from public.orden_pago o
        join public.orden_pago_medio m on m.orden_pago_id = o.id and m.cheque_id = new.id
        where o.id = new.orden_pago_id and o.estado = 'confirmado' and o.proveedor_id = new.proveedor_id
      );
    elsif old.orden_pago_id is not null and new.orden_pago_id is null then
      -- Vuelta a la cartera: la orden se anuló.
      v_vinculo_ok := old.estado = 'entregado' and new.estado = 'en_cartera' and new.proveedor_id is null
        and exists (select 1 from public.orden_pago o where o.id = old.orden_pago_id and o.estado = 'anulado');
    else
      v_vinculo_ok := false;
    end if;
    if not v_vinculo_ok then
      raise exception 'El vínculo del cheque con la orden de pago lo manejan la confirmación y la anulación de la orden.'
        using errcode = 'OP017', hint = 'cheque_vinculo_invalido';
    end if;
  end if;

  if v_recibo.estado = 'borrador' then
    if new.estado is distinct from old.estado then
      raise exception 'El cheque entra a la cartera cuando se emite el recibo: hasta entonces no cambia de estado.'
        using errcode = 'CB009', hint = 'cheque_transicion_invalida';
    end if;
    if new.cliente_id <> v_recibo.cliente_id then
      raise exception 'El cheque tiene que ser del cliente del recibo.'
        using errcode = 'CB008', hint = 'cliente_distinto';
    end if;
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'en_cartera' and new.estado in ('depositado', 'entregado', 'rechazado') and v_recibo.estado = 'emitido')
      or (old.estado in ('depositado', 'entregado') and new.estado = 'rechazado' and v_recibo.estado = 'emitido')
      or (old.estado = 'en_cartera' and new.estado = 'anulado' and v_recibo.estado = 'anulado')
      -- La anulación de la orden de pago (el vínculo ya se controló arriba).
      or (old.estado = 'entregado' and new.estado = 'en_cartera' and v_recibo.estado = 'emitido'
          and old.orden_pago_id is not null and new.orden_pago_id is null)
    ) then
      raise exception 'Un cheque no puede pasar de % a %.', old.estado, new.estado
        using errcode = 'CB009', hint = 'cheque_transicion_invalida';
    end if;
  end if;

  if new.tipo is distinct from old.tipo
    or new.banco is distinct from old.banco
    or new.numero is distinct from old.numero
    or new.fecha_emision is distinct from old.fecha_emision
    or new.fecha_pago is distinct from old.fecha_pago
    or new.librador is distinct from old.librador
    or new.librador_cuit is distinct from old.librador_cuit
    or new.importe is distinct from old.importe
    or new.cliente_id is distinct from old.cliente_id
    or (old.nd_comprobante_id is not null and new.nd_comprobante_id is distinct from old.nd_comprobante_id)
  then
    raise exception 'El cheque es de un recibo emitido: sus datos no se pueden cambiar, sólo su estado.'
      using errcode = 'CB017', hint = 'cheque_bloqueado';
  end if;

  if new.nd_comprobante_id is not null and new.nd_comprobante_id is distinct from old.nd_comprobante_id then
    select c.clase, c.cliente_id into v_nd from public.comprobante c where c.id = new.nd_comprobante_id;
    if not found or v_nd.clase <> 'nota_debito' or v_nd.cliente_id <> new.cliente_id then
      raise exception 'El rechazo se vincula a una nota de débito al cliente del cheque.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
  end if;

  return new;
end;
$$;

-- ----- Imputaciones -------------------------------------------------------

create or replace function public.fn_imputacion_compra_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estado text;
  v_deb record;
  v_orden record;
  v_nc record;
  v_proveedor uuid;
  v_total_origen numeric;
  v_imputado_origen numeric;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.nota_credito_id is not null then
      -- Se borran sólo al anular su nota de crédito.
      if tg_op = 'DELETE' and exists (
        select 1 from public.comprobante_compra c where c.id = old.nota_credito_id and c.estado = 'anulado'
      ) then
        return old;
      end if;
      raise exception 'Las imputaciones de una nota de crédito no se modifican ni se borran: se deshacen anulando la nota.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    select o.estado into v_estado from public.orden_pago o where o.id = old.orden_pago_id;
    if tg_op = 'DELETE' then
      -- Borrador, anulación (el trigger de la orden las borra) o cascada.
      if v_estado is null or v_estado in ('borrador', 'anulado') then
        return old;
      end if;
      raise exception 'La orden de pago está confirmada: sus imputaciones no se pueden cambiar. Para deshacerlas, anulá la orden.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'La orden de pago está %: sus imputaciones no se pueden cambiar.', v_estado
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    if new.orden_pago_id is distinct from old.orden_pago_id or new.nota_credito_id is distinct from old.nota_credito_id then
      raise exception 'Una imputación no cambia de origen.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
  end if;

  -- Sin origen o con dos, la restricción imputacion_compra_origen_check lo informa.
  if num_nonnulls(new.orden_pago_id, new.nota_credito_id) <> 1 then
    return new;
  end if;

  -- El débito, bloqueado mientras se controla su saldo.
  select c.tipo, c.estado, c.proveedor_id, c.total into v_deb
  from public.comprobante_compra c
  where c.id = new.comprobante_compra_id
  for update;
  if not found or not public.fn_es_debito_compra(v_deb.tipo, v_deb.estado) then
    raise exception 'Sólo se imputan facturas y notas de débito de compra confirmadas.'
      using errcode = 'OP007', hint = 'debito_invalido';
  end if;

  if new.orden_pago_id is not null then
    select o.estado, o.proveedor_id, o.total into v_orden
    from public.orden_pago o
    where o.id = new.orden_pago_id
    for update;
    if v_orden.estado = 'anulado' then
      raise exception 'La orden de pago está anulada: no imputa.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    if v_orden.estado = 'confirmado' and not new.automatica then
      raise exception 'La orden de pago está confirmada: sólo se le agrega la aplicación automática de su saldo a favor.'
        using errcode = 'OP001', hint = 'orden_pago_inmutable';
    end if;
    v_proveedor := v_orden.proveedor_id;
    v_total_origen := v_orden.total;
    select coalesce(sum(i.importe), 0) into v_imputado_origen
    from public.imputacion_compra i
    where i.orden_pago_id = new.orden_pago_id and i.id is distinct from new.id;
  else
    select c.tipo, c.estado, c.proveedor_id, c.total into v_nc
    from public.comprobante_compra c
    where c.id = new.nota_credito_id
    for update;
    if not found or not public.fn_es_nota_credito_compra(v_nc.tipo, v_nc.estado) then
      raise exception 'El origen tiene que ser una nota de crédito de compra confirmada.'
        using errcode = 'OP014', hint = 'credito_invalido';
    end if;
    v_proveedor := v_nc.proveedor_id;
    v_total_origen := v_nc.total;
    select coalesce(sum(i.importe), 0) into v_imputado_origen
    from public.imputacion_compra i
    where i.nota_credito_id = new.nota_credito_id and i.id is distinct from new.id;
  end if;

  if v_proveedor <> v_deb.proveedor_id then
    raise exception 'El crédito y el comprobante son de proveedores distintos.'
      using errcode = 'OP008', hint = 'proveedor_distinto';
  end if;

  if v_imputado_origen + new.importe > v_total_origen then
    raise exception 'Las imputaciones ($ %) superan el total del crédito ($ %).', v_imputado_origen + new.importe, v_total_origen
      using errcode = 'OP005', hint = 'imputacion_excede_credito';
  end if;

  if public.fn_imputado_debito_compra(new.comprobante_compra_id, new.orden_pago_id, new.id) + new.importe > v_deb.total then
    raise exception 'La imputación supera el saldo pendiente del comprobante ($ %).',
      v_deb.total - public.fn_imputado_debito_compra(new.comprobante_compra_id, new.orden_pago_id, new.id)
      using errcode = 'OP006', hint = 'imputacion_excede_saldo';
  end if;

  return new;
end;
$$;

create trigger trg_imputacion_compra_validar before insert or update or delete on imputacion_compra
  for each row execute function public.fn_imputacion_compra_validar();

-- ----- Vistas -------------------------------------------------------------

-- Saldo de cada débito de compra (factura o nota de débito confirmada).
create view v_comprobante_compra_saldo
with (security_invoker = true) as
with imputado as (
  select i.comprobante_compra_id, sum(i.importe) as imputado
  from imputacion_compra i
  left join orden_pago o on o.id = i.orden_pago_id
  where i.nota_credito_id is not null or o.estado = 'confirmado'
  group by i.comprobante_compra_id
)
select
  c.id as comprobante_compra_id,
  c.proveedor_id,
  c.tipo,
  c.letra,
  c.punto_venta,
  c.numero,
  public.fn_numero_comprobante_compra(c.tipo, c.letra, c.punto_venta, c.numero) as numero_texto,
  c.fecha,
  c.fecha_vencimiento,
  c.total,
  coalesce(im.imputado, 0) as imputado,
  c.total - coalesce(im.imputado, 0) as saldo,
  case
    when c.total - coalesce(im.imputado, 0) <= 0 then 'cancelado'
    when coalesce(im.imputado, 0) = 0 then 'pendiente'
    else 'parcial'
  end as estado_pago
from comprobante_compra c
left join imputado im on im.comprobante_compra_id = c.id
where public.fn_es_debito_compra(c.tipo, c.estado);

comment on view v_comprobante_compra_saldo is
  'Facturas y notas de débito de compra confirmadas con lo imputado, el saldo y el estado de pago';

-- Créditos con algo sin imputar: órdenes de pago confirmadas y notas de crédito confirmadas.
create view v_proveedor_saldo_a_favor
with (security_invoker = true) as
with creditos as (
  select 'orden_pago'::text as origen, o.id as orden_pago_id, null::uuid as nota_credito_id, o.proveedor_id,
         o.fecha, o.creado_en, o.numero_texto, o.total,
         (select coalesce(sum(i.importe), 0) from imputacion_compra i where i.orden_pago_id = o.id) as imputado
  from orden_pago o
  where o.estado = 'confirmado'
  union all
  select 'nota_credito', null, c.id, c.proveedor_id, c.fecha, c.creado_en,
         public.fn_numero_comprobante_compra(c.tipo, c.letra, c.punto_venta, c.numero), c.total,
         (select coalesce(sum(i.importe), 0) from imputacion_compra i where i.nota_credito_id = c.id)
  from comprobante_compra c
  where public.fn_es_nota_credito_compra(c.tipo, c.estado)
)
select origen, orden_pago_id, nota_credito_id, proveedor_id, fecha, creado_en, numero_texto, total, imputado,
       total - imputado as disponible
from creditos
where total - imputado > 0;

comment on view v_proveedor_saldo_a_favor is
  'Saldo a favor por crédito (orden de pago o nota de crédito de compra) con lo no imputado. Se aplica del más viejo al más nuevo';

-- ----- Comprobantes de compra: saldo a favor y anulación ------------------

-- Al confirmar: a una factura o nota de débito se le aplican los créditos
-- del proveedor con algo disponible; una nota de crédito se imputa a su
-- factura asociada hasta su saldo. Un candado por proveedor serializa dos
-- confirmaciones a la vez del mismo proveedor.
create or replace function public.fn_comprobante_compra_aplicar_creditos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_restante numeric;
  v_importe numeric;
  v_fila record;
begin
  perform pg_advisory_xact_lock(hashtextextended('saldo_a_favor_compra:' || new.proveedor_id::text, 0));

  if public.fn_es_debito_compra(new.tipo, new.estado) then
    v_restante := new.total - public.fn_imputado_debito_compra(new.id, null, null);
    for v_fila in
      select f.orden_pago_id, f.nota_credito_id, f.disponible
      from public.v_proveedor_saldo_a_favor f
      where f.proveedor_id = new.proveedor_id
      order by f.fecha, f.creado_en, coalesce(f.orden_pago_id, f.nota_credito_id)
    loop
      exit when v_restante <= 0;
      v_importe := least(v_restante, v_fila.disponible);
      insert into public.imputacion_compra (orden_pago_id, nota_credito_id, comprobante_compra_id, importe, automatica)
      values (v_fila.orden_pago_id, v_fila.nota_credito_id, new.id, v_importe, true);
      v_restante := v_restante - v_importe;
    end loop;

  elsif public.fn_es_nota_credito_compra(new.tipo, new.estado) and new.comprobante_asociado_id is not null then
    select c.total - public.fn_imputado_debito_compra(c.id, null, null) as saldo into v_fila
    from public.comprobante_compra c
    where c.id = new.comprobante_asociado_id
      and c.proveedor_id = new.proveedor_id
      and public.fn_es_debito_compra(c.tipo, c.estado);
    if found and v_fila.saldo > 0 then
      insert into public.imputacion_compra (nota_credito_id, comprobante_compra_id, importe, automatica)
      values (new.id, new.comprobante_asociado_id, least(new.total, v_fila.saldo), true);
    end if;
  end if;
  return null;
end;
$$;

comment on function public.fn_comprobante_compra_aplicar_creditos() is
  'Al confirmar: aplica el saldo a favor del proveedor a una factura o ND, o imputa una NC a su factura asociada';

create trigger trg_comprobante_compra_aplicar_creditos after update on comprobante_compra
  for each row when (old.estado = 'borrador' and new.estado = 'confirmado')
  execute function public.fn_comprobante_compra_aplicar_creditos();

-- Al anular: un débito con imputaciones vigentes no se anula; una nota de
-- crédito deshace sus imputaciones.
create or replace function public.fn_comprobante_compra_anulado_imputaciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tipo = 'nota_credito' then
    delete from public.imputacion_compra where nota_credito_id = new.id;
  elsif public.fn_imputado_debito_compra(new.id, null, null) > 0 then
    raise exception 'El comprobante tiene pagos o notas de crédito imputados: primero anulá esas órdenes de pago o notas de crédito.'
      using errcode = 'OP016', hint = 'comprobante_con_imputaciones';
  end if;
  return null;
end;
$$;

create trigger trg_comprobante_compra_anulado_imputaciones after update on comprobante_compra
  for each row when (old.estado = 'confirmado' and new.estado = 'anulado')
  execute function public.fn_comprobante_compra_anulado_imputaciones();

-- ----- Guardado, confirmación y anulación ----------------------------------

-- p_orden: { proveedor_id, fecha, observaciones }
-- p_medios: [{ tipo, importe, referencia,          -- efectivo / transferencia
--              cheque_id,                          -- cheque_tercero (importe: el del cheque)
--              banco, numero, fecha_pago }]        -- cheque_propio
-- p_imputaciones: [{ comprobante_compra_id, importe }] (los importes en cero se ignoran)
-- Crea (p_id null) o reemplaza un borrador. El total es la suma de los medios.
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

  insert into public.orden_pago_medio (orden_pago_id, orden, tipo, importe, referencia, cheque_id, banco, numero, fecha_pago)
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
    case when m.dato->>'tipo' = 'transferencia' then nullif(btrim(m.dato->>'referencia'), '') end,
    (m.dato->>'cheque_id')::uuid,
    nullif(btrim(m.dato->>'banco'), ''),
    nullif(btrim(m.dato->>'numero'), ''),
    nullif(m.dato->>'fecha_pago', '')::date
  from jsonb_array_elements(p_medios) with ordinality as m(dato, orden)
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
  'Crea (p_id null) o reemplaza una orden de pago en borrador con sus medios e imputaciones en una transacción. Devuelve el id';

-- Asigna el número en la misma transacción: bloquea el contador, lo avanza
-- y confirma. Si alguna regla de la confirmación falla, se deshace todo,
-- contador incluido. Security definer: es la única vía para avanzar el
-- contador (authenticated sólo lo lee). Es seguro: search_path vacío y
-- nombres calificados, no recibe el número desde afuera, y los triggers de
-- la orden siguen controlando la confirmación entera.
create or replace function public.confirmar_orden_pago(p_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_numero bigint;
begin
  select o.estado into v_estado
  from public.orden_pago o
  where o.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró la orden de pago.'
      using errcode = 'OP012', hint = 'orden_pago_inexistente';
  end if;
  if v_estado <> 'borrador' then
    raise exception 'La orden de pago ya está %.', v_estado
      using errcode = 'OP002', hint = 'transicion_invalida';
  end if;

  select n.ultimo_numero + 1 into v_numero
  from public.orden_pago_numeracion n
  for update;

  update public.orden_pago_numeracion set ultimo_numero = v_numero;
  update public.orden_pago set estado = 'confirmado', numero = v_numero where id = p_id;
  return v_numero;
end;
$$;

comment on function public.confirmar_orden_pago(uuid) is
  'Confirma una orden de pago en borrador: le asigna el número siguiente, entrega sus cheques de terceros y la deja inmutable. Devuelve el número';

create or replace function public.anular_orden_pago(p_id uuid, p_motivo text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estado text;
begin
  select o.estado into v_estado
  from public.orden_pago o
  where o.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró la orden de pago.'
      using errcode = 'OP012', hint = 'orden_pago_inexistente';
  end if;
  if v_estado <> 'confirmado' then
    raise exception 'Sólo se anula una orden de pago confirmada (está %).', v_estado
      using errcode = 'OP002', hint = 'transicion_invalida';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Para anular la orden de pago, indicá el motivo.'
      using errcode = 'OP015', hint = 'motivo_requerido';
  end if;
  update public.orden_pago set estado = 'anulado', motivo_anulacion = p_motivo where id = p_id;
end;
$$;

comment on function public.anular_orden_pago(uuid, text) is
  'Anula una orden de pago confirmada: deshace sus imputaciones y devuelve sus cheques de terceros a la cartera';

-- ----- Permisos de las funciones --------------------------------------------

-- Funciones de triggers: no se llaman directamente.
revoke execute on function public.fn_orden_pago_validar() from anon, authenticated, public;
revoke execute on function public.fn_orden_pago_confirmada() from anon, authenticated, public;
revoke execute on function public.fn_orden_pago_anulada() from anon, authenticated, public;
revoke execute on function public.fn_orden_pago_borrar() from anon, authenticated, public;
revoke execute on function public.fn_orden_pago_medio_validar() from anon, authenticated, public;
revoke execute on function public.fn_imputacion_compra_validar() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_aplicar_creditos() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_anulado_imputaciones() from anon, authenticated, public;
revoke execute on function public.fn_cheque_validar() from anon, authenticated, public;

-- Ayudas que usan los triggers y las vistas (security invoker): sólo authenticated.
revoke execute on function public.fn_es_debito_compra(text, text) from public, anon;
revoke execute on function public.fn_es_nota_credito_compra(text, text) from public, anon;
revoke execute on function public.fn_imputado_debito_compra(uuid, uuid, uuid) from public, anon;
revoke execute on function public.fn_numero_comprobante_compra(text, text, integer, bigint) from public, anon;
grant execute on function public.fn_es_debito_compra(text, text) to authenticated;
grant execute on function public.fn_es_nota_credito_compra(text, text) to authenticated;
grant execute on function public.fn_imputado_debito_compra(uuid, uuid, uuid) to authenticated;
grant execute on function public.fn_numero_comprobante_compra(text, text, integer, bigint) to authenticated;

revoke execute on function public.guardar_orden_pago(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.confirmar_orden_pago(uuid) from public, anon;
revoke execute on function public.anular_orden_pago(uuid, text) from public, anon;
grant execute on function public.guardar_orden_pago(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.confirmar_orden_pago(uuid) to authenticated;
grant execute on function public.anular_orden_pago(uuid, text) to authenticated;

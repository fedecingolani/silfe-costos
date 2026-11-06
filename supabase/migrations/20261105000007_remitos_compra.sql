-- =====================================================================
-- Charoli Gestión - Remitos de compra
-- La mercadería que entrega un proveedor, con el número de su remito
-- (punto de venta y número), la fecha, observaciones y renglones con
-- cantidad. No mueven stock. El ciclo de vida es:
--
--   borrador -> recibido  (sólo con recibir_remito_compra)
--   recibido -> anulado   (sólo con anular_remito_compra)
--
--   - borrador: se edita y se borra, renglones incluidos;
--   - recibido: no se modifica ni se borra, ni sus renglones. Se anula
--     mientras no tenga nada facturado;
--   - anulado: no se modifica ni se borra; conserva todos sus datos.
--
-- Lo controlan triggers, así que vale también para SQL directo. Las
-- reglas de recibir y anular se repiten en el trigger: la marca de la
-- transacción (compras.recibiendo_remito / compras.anulando_remito) se
-- puede poner a mano con set_config, así que sola no alcanza.
--
-- Número del proveedor: el mismo remito (proveedor, punto de venta y
-- número) no se carga dos veces entre los no anulados (índice único,
-- también para los borradores); uno anulado deja libre el número.
--
-- Renglones: siempre un artículo del catálogo del proveedor (no hay
-- renglones libres), que lleva a la materia prima. Guardan el código y
-- la descripción tal como los escribió el proveedor (por defecto, los del
-- artículo). La materia prima la copian los triggers desde el artículo;
-- un artículo sin materia prima se acepta en un borrador pero no deja
-- recibir. guardar_remito_compra busca o da de alta los artículos nuevos
-- igual que guardar_comprobante_compra (fn_compras_articulo, compartida).
--
-- Facturación: comprobante_compra_item.remito_compra_item_id vincula un
-- renglón de factura con un renglón de remito, por cantidad.
--   - Facturado de un renglón de remito = suma de las cantidades de los
--     renglones de comprobantes no anulados (borrador o confirmado) que lo
--     apuntan; pendiente = cantidad − facturado
--     (v_remito_compra_item_pendiente). v_remito_compra_estado da el
--     estado de facturación del remito: pendiente, parcial o facturado.
--   - Un trigger de comprobante_compra_item bloquea el remito (for update)
--     y exige: una factura (no una nota), el remito recibido y del mismo
--     proveedor, el mismo artículo y que lo facturado no supere la
--     cantidad. Una factura anulada libera su cantidad; borrar un
--     borrador, también.
--   - Un remito con algo facturado no se anula (y, como está recibido,
--     tampoco se modifica).
--   - facturar_remitos_compra arma el borrador de factura con
--     guardar_comprobante_compra, que ahora guarda remito_compra_item_id.
--
-- Reemplaza guardar_comprobante_compra (20261105000006).
--
-- Errores (SQLSTATE propio, estable para que la app los traduzca; el HINT
-- repite el motivo en forma de clave):
--   RC001 remito_inmutable             (recibido o anulado: cabecera o
--                                       renglones)
--   RC002 transicion_invalida
--   RC003 borrado_no_permitido
--   RC004 remito_inexistente           (remito o renglón de remito)
--   RC005 remito_sin_items             (al recibir)
--   RC006 articulo_de_otro_proveedor
--   RC007 articulo_sin_materia_prima   (al recibir)
--   RC008 remito_facturado             (anular un remito con algo facturado)
--   RC009 facturacion_invalida         (renglones vacíos o repetidos,
--                                       cantidad <= 0, remito no recibido,
--                                       otro proveedor, otro artículo, no
--                                       es una factura)
--   RC010 excede_pendiente             (facturar más que lo pendiente)
--   RC011 renglon_sin_articulo         (un renglón de remito sin artículo)
-- =====================================================================

-- ----- Remito de compra ----------------------------------------------------

create table remito_compra (
  id              uuid primary key default gen_random_uuid(),
  proveedor_id    uuid not null references proveedor(id) on delete restrict,
  punto_venta     integer not null,
  numero          bigint not null,
  fecha           date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  observaciones   text,
  estado          text not null default 'borrador',
  recibido_en     timestamptz,
  anulado_en      timestamptz,
  creado_por      uuid default auth.uid(),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint remito_compra_punto_venta_check check (punto_venta between 1 and 99999),
  constraint remito_compra_numero_check check (numero > 0),
  constraint remito_compra_estado_check check (estado in ('borrador', 'recibido', 'anulado')),
  constraint remito_compra_recibido_en_check check ((recibido_en is not null) = (estado in ('recibido', 'anulado'))),
  constraint remito_compra_anulado_en_check check ((anulado_en is not null) = (estado = 'anulado'))
);

comment on table remito_compra is
  'Remitos de compra: mercadería recibida de un proveedor. Un recibido no se borra: se anula';
comment on column remito_compra.punto_venta is 'Punto de venta del remito del proveedor (1 a 99999)';
comment on column remito_compra.numero is 'Número del remito del proveedor';
comment on column remito_compra.fecha is 'Fecha del remito';
comment on column remito_compra.estado is 'borrador | recibido | anulado (conserva los datos)';
comment on column remito_compra.recibido_en is 'Momento en que se registró como recibido';
comment on column remito_compra.anulado_en is 'Momento en que se anuló';
comment on column remito_compra.creado_por is 'Usuario que lo cargó (auth.uid()). Sin FK: los usuarios se manejan desde Auth';

create unique index remito_compra_numero_unico
  on remito_compra (proveedor_id, punto_venta, numero)
  where estado <> 'anulado';
create index remito_compra_fecha_idx on remito_compra (fecha desc);
create index remito_compra_estado_idx on remito_compra (estado);

-- ----- Renglones -----------------------------------------------------------

create table remito_compra_item (
  id                     uuid primary key default gen_random_uuid(),
  remito_compra_id       uuid not null references remito_compra(id) on delete cascade,
  orden                  integer not null default 0,
  proveedor_articulo_id  uuid not null references proveedor_articulo(id) on delete restrict,
  materia_prima_id       uuid references materia_prima(id) on delete restrict,
  codigo_proveedor       text,
  descripcion            text not null,
  unidad                 text,
  cantidad               numeric(14,4) not null,
  constraint remito_compra_item_descripcion_check check (btrim(descripcion) <> ''),
  constraint remito_compra_item_cantidad_check check (cantidad > 0)
);

comment on table remito_compra_item is 'Renglones de un remito de compra: siempre un artículo del proveedor';
comment on column remito_compra_item.proveedor_articulo_id is 'Artículo del catálogo del proveedor';
comment on column remito_compra_item.materia_prima_id is 'Materia prima del artículo. La copian los triggers desde el artículo';
comment on column remito_compra_item.codigo_proveedor is 'Código tal como lo escribió el proveedor';
comment on column remito_compra_item.descripcion is 'Descripción tal como la escribió el proveedor';
comment on column remito_compra_item.cantidad is 'Cantidad recibida, en la unidad del proveedor';

create index remito_compra_item_remito_idx on remito_compra_item (remito_compra_id, orden);
create index remito_compra_item_articulo_idx on remito_compra_item (proveedor_articulo_id);
create index remito_compra_item_materia_prima_idx on remito_compra_item (materia_prima_id);

-- ----- Vínculo con los renglones de las facturas ---------------------------

alter table comprobante_compra_item
  add column remito_compra_item_id uuid references remito_compra_item(id) on delete restrict;

comment on column comprobante_compra_item.remito_compra_item_id is
  'Renglón de remito de compra que factura este renglón (sólo en facturas). Cuenta como facturado mientras el comprobante no esté anulado';

create index comprobante_compra_item_remito_idx on comprobante_compra_item (remito_compra_item_id)
  where remito_compra_item_id is not null;

-- ----- Lo facturado ---------------------------------------------------------

-- Si un remito tiene algún renglón apuntado por un comprobante no anulado.
create or replace function public.fn_remito_compra_facturado(p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.comprobante_compra_item ci
    join public.comprobante_compra c on c.id = ci.comprobante_compra_id
    join public.remito_compra_item ri on ri.id = ci.remito_compra_item_id
    where ri.remito_compra_id = p_id
      and c.estado <> 'anulado'
  );
$$;

comment on function public.fn_remito_compra_facturado(uuid) is
  'Si el remito de compra tiene cantidades facturadas por comprobantes no anulados';

create view v_remito_compra_item_pendiente
with (security_invoker = true) as
select
  ri.id as remito_compra_item_id,
  ri.remito_compra_id,
  r.proveedor_id,
  r.punto_venta,
  r.numero,
  r.fecha,
  r.estado as estado_remito,
  ri.orden,
  ri.proveedor_articulo_id,
  ri.materia_prima_id,
  ri.codigo_proveedor,
  ri.descripcion,
  ri.unidad,
  ri.cantidad,
  coalesce(f.facturada, 0) as facturada,
  ri.cantidad - coalesce(f.facturada, 0) as pendiente
from remito_compra_item ri
join remito_compra r on r.id = ri.remito_compra_id
left join (
  select ci.remito_compra_item_id, sum(ci.cantidad) as facturada
  from comprobante_compra_item ci
  join comprobante_compra c on c.id = ci.comprobante_compra_id
  where ci.remito_compra_item_id is not null
    and c.estado <> 'anulado'
  group by ci.remito_compra_item_id
) f on f.remito_compra_item_id = ri.id;

comment on view v_remito_compra_item_pendiente is
  'Cantidad, facturada (comprobantes no anulados, borradores incluidos) y pendiente de cada renglón de remito de compra';

create view v_remito_compra_estado
with (security_invoker = true) as
select
  r.id as remito_compra_id,
  r.proveedor_id,
  r.punto_venta,
  r.numero,
  r.fecha,
  r.estado,
  case
    when coalesce(sum(p.facturada), 0) = 0 then 'pendiente'
    when coalesce(sum(p.pendiente), 0) <= 0 then 'facturado'
    else 'parcial'
  end as estado_facturacion,
  coalesce(sum(p.cantidad), 0) as cantidad,
  coalesce(sum(p.facturada), 0) as facturada,
  coalesce(sum(p.pendiente), 0) as pendiente
from remito_compra r
left join v_remito_compra_item_pendiente p on p.remito_compra_id = r.id
group by r.id;

comment on view v_remito_compra_estado is
  'Estado de facturación de cada remito de compra: pendiente (nada facturado), parcial o facturado (nada pendiente), con los totales';

revoke all on public.v_remito_compra_item_pendiente, public.v_remito_compra_estado from anon;
grant select on public.v_remito_compra_item_pendiente, public.v_remito_compra_estado to authenticated;

-- ----- Estado e inmutabilidad de la cabecera ------------------------------

-- Valida el alta y cada cambio:
--   - el alta es siempre borrador, sin fechas de recepción ni anulación;
--   - en un borrador no se pasa a otro proveedor con renglones de
--     artículos del anterior (RC006);
--   - borrador -> recibido sólo con la marca compras.recibiendo_remito = id
--     y con lo mismo que exige recibir_remito_compra: renglones (RC005) y
--     artículos con materia prima, ya copiada al renglón (RC007);
--   - recibido -> anulado sólo con la marca compras.anulando_remito = id,
--     sin cambiar nada más y sin nada facturado (RC008);
--   - un recibido o un anulado no cambia (RC001).
create or replace function public.fn_remito_compra_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignorar text[] := array['estado', 'anulado_en', 'actualizado_en'];
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' or new.recibido_en is not null or new.anulado_en is not null then
      raise exception 'Un remito de compra se crea en borrador: se recibe con recibir_remito_compra.'
        using errcode = 'RC002', hint = 'transicion_invalida';
    end if;
    return new;
  end if;

  if old.estado = 'anulado' then
    if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
      raise exception 'El remito está anulado: no se puede modificar.'
        using errcode = 'RC001', hint = 'remito_inmutable';
    end if;
    return new;
  end if;

  if old.estado = 'recibido' then
    if new.estado = 'anulado' then
      if coalesce(current_setting('compras.anulando_remito', true), '') <> new.id::text
        or (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar)
      then
        raise exception 'Un remito de compra se anula sólo con anular_remito_compra.'
          using errcode = 'RC002', hint = 'transicion_invalida';
      end if;
      -- Lo mismo que controla anular_remito_compra: la marca sola no alcanza.
      if public.fn_remito_compra_facturado(new.id) then
        raise exception 'El remito tiene cantidades facturadas: no se puede anular. Anulá o borrá antes las facturas que lo usan.'
          using errcode = 'RC008', hint = 'remito_facturado';
      end if;
      new.anulado_en := coalesce(new.anulado_en, now());
      return new;
    end if;

    if new.estado <> 'recibido' then
      raise exception 'Un remito recibido sólo puede pasar a anulado.'
        using errcode = 'RC002', hint = 'transicion_invalida';
    end if;

    if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
      raise exception 'El remito está recibido: no se puede modificar (se anula).'
        using errcode = 'RC001', hint = 'remito_inmutable';
    end if;
    return new;
  end if;

  -- old.estado = 'borrador'
  if new.estado = 'recibido' then
    if coalesce(current_setting('compras.recibiendo_remito', true), '') <> new.id::text then
      raise exception 'Un remito de compra se recibe sólo con recibir_remito_compra.'
        using errcode = 'RC002', hint = 'transicion_invalida';
    end if;
    -- Lo mismo que controla recibir_remito_compra: la marca sola no alcanza.
    if not exists (select 1 from public.remito_compra_item i where i.remito_compra_id = new.id) then
      raise exception 'El remito no tiene renglones.'
        using errcode = 'RC005', hint = 'remito_sin_items';
    end if;
    if exists (
      select 1
      from public.remito_compra_item i
      join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
      where i.remito_compra_id = new.id
        and (a.materia_prima_id is null or i.materia_prima_id is distinct from a.materia_prima_id)
    ) then
      raise exception 'Hay renglones con un artículo sin materia prima asociada.'
        using errcode = 'RC007', hint = 'articulo_sin_materia_prima';
    end if;
    new.recibido_en := coalesce(new.recibido_en, now());
  elsif new.estado <> 'borrador' then
    raise exception 'Un remito en borrador sólo puede pasar a recibido (o borrarse).'
      using errcode = 'RC002', hint = 'transicion_invalida';
  end if;

  if new.proveedor_id is distinct from old.proveedor_id and exists (
    select 1
    from public.remito_compra_item i
    join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
    where i.remito_compra_id = new.id and a.proveedor_id <> new.proveedor_id
  ) then
    raise exception 'El remito tiene artículos de otro proveedor.'
      using errcode = 'RC006', hint = 'articulo_de_otro_proveedor';
  end if;

  return new;
end;
$$;

create or replace function public.fn_remito_compra_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'El remito está %: no se puede borrar (un recibido se anula).', old.estado
      using errcode = 'RC003', hint = 'borrado_no_permitido';
  end if;
  return old;
end;
$$;

create trigger trg_remito_compra_actualizado before update on remito_compra
  for each row execute function fn_set_actualizado_en();

create trigger trg_remito_compra_validar before insert or update on remito_compra
  for each row execute function public.fn_remito_compra_validar();

create trigger trg_remito_compra_borrar before delete on remito_compra
  for each row execute function public.fn_remito_compra_borrar();

-- ----- Renglones ------------------------------------------------------------

-- Los renglones cambian sólo mientras el remito está en borrador. Antes de
-- mirar el estado bloquea la fila del remito (for update, en orden de id):
-- un renglón que se agrega mientras otra transacción recibe el remito
-- espera y ve el estado final. Si el remito ya no existe (borrado en
-- cascada) no hay nada que proteger.
create or replace function public.fn_remito_compra_item_bloqueo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_r record;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.remito_compra_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.remito_compra_id, new.remito_compra_id];
  else
    v_ids := array[old.remito_compra_id];
  end if;

  for v_r in
    select r.id, r.estado
    from public.remito_compra r
    where r.id = any (v_ids)
    order by r.id
    for update
  loop
    if v_r.estado <> 'borrador' then
      raise exception 'El remito está %: sus renglones no se pueden cambiar.', v_r.estado
        using errcode = 'RC001', hint = 'remito_inmutable';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Copia la materia prima del artículo, que tiene que ser del proveedor del
-- remito (RC006). Un artículo inexistente lo rechaza la clave foránea.
create or replace function public.fn_remito_compra_item_articulo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_a record;
begin
  new.materia_prima_id := null;
  select a.proveedor_id, a.materia_prima_id into v_a
  from public.proveedor_articulo a
  where a.id = new.proveedor_articulo_id;
  if found then
    if v_a.proveedor_id <> (select r.proveedor_id from public.remito_compra r where r.id = new.remito_compra_id) then
      raise exception 'El artículo es de otro proveedor.'
        using errcode = 'RC006', hint = 'articulo_de_otro_proveedor';
    end if;
    new.materia_prima_id := v_a.materia_prima_id;
  end if;
  return new;
end;
$$;

create trigger trg_remito_compra_item_bloqueo before insert or update or delete on remito_compra_item
  for each row execute function public.fn_remito_compra_item_bloqueo();

create trigger trg_remito_compra_item_articulo before insert or update on remito_compra_item
  for each row execute function public.fn_remito_compra_item_articulo();

-- Un recibido o anulado siempre tiene al menos un renglón. Trigger de
-- restricción diferido (como trg_comprobante_compra_con_items).
create or replace function public.fn_remito_compra_con_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.remito_compra r
    where r.id = old.remito_compra_id
      and r.estado in ('recibido', 'anulado')
      and not exists (select 1 from public.remito_compra_item i where i.remito_compra_id = r.id)
  ) then
    raise exception 'Un remito recibido tiene que tener al menos un renglón.'
      using errcode = 'RC005', hint = 'remito_sin_items';
  end if;
  return null;
end;
$$;

create constraint trigger trg_remito_compra_con_items
  after delete or update of remito_compra_id on remito_compra_item
  deferrable initially deferred
  for each row
  execute function public.fn_remito_compra_con_items();

-- ----- Tope de lo facturado -------------------------------------------------

-- Después de insertar o cambiar un renglón de comprobante que apunta a un
-- renglón de remito: bloquea el remito (dos facturas a la vez se
-- serializan con anular_remito_compra y entre sí, y la segunda ve lo que
-- guardó la primera), exige que el comprobante sea una factura del mismo
-- proveedor, que el remito esté recibido, que el artículo sea el mismo y
-- que lo facturado no supere la cantidad. Es AFTER para ver todas las
-- filas de la misma sentencia.
create or replace function public.fn_comprobante_compra_item_remito()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_r public.remito_compra;
  v_ri public.remito_compra_item;
  v_c record;
  v_facturada numeric;
begin
  select ri.* into v_ri from public.remito_compra_item ri where ri.id = new.remito_compra_item_id;
  select r.* into v_r
  from public.remito_compra r
  where r.id = v_ri.remito_compra_id
  for update;
  if not found then
    raise exception 'No se encontró el renglón del remito.'
      using errcode = 'RC004', hint = 'remito_inexistente';
  end if;

  if v_r.estado <> 'recibido' then
    raise exception 'Sólo se facturan remitos recibidos (el remito está %).', v_r.estado
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;

  select c.tipo, c.proveedor_id into v_c
  from public.comprobante_compra c
  where c.id = new.comprobante_compra_id;
  if v_c.tipo is distinct from 'factura' then
    raise exception 'Sólo una factura factura remitos (no una nota de crédito o débito).'
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;
  if v_c.proveedor_id is distinct from v_r.proveedor_id then
    raise exception 'El remito es de otro proveedor: una factura junta remitos de su mismo proveedor.'
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;
  if new.proveedor_articulo_id is distinct from v_ri.proveedor_articulo_id then
    raise exception 'El renglón "%" factura el remito con otro artículo.', new.descripcion
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;

  select coalesce(sum(ci.cantidad), 0) into v_facturada
  from public.comprobante_compra_item ci
  join public.comprobante_compra c on c.id = ci.comprobante_compra_id
  where ci.remito_compra_item_id = new.remito_compra_item_id
    and c.estado <> 'anulado';

  if v_facturada > v_ri.cantidad then
    raise exception 'Del renglón "%" del remito %-% quedan % pendientes: no se pueden facturar %.',
      v_ri.descripcion, lpad(v_r.punto_venta::text, 5, '0'), lpad(v_r.numero::text, 8, '0'),
      v_ri.cantidad - (v_facturada - new.cantidad), new.cantidad
      using errcode = 'RC010', hint = 'excede_pendiente';
  end if;

  return null;
end;
$$;

create trigger trg_comprobante_compra_item_remito
  after insert or update of remito_compra_item_id, cantidad, comprobante_compra_id, proveedor_articulo_id
  on comprobante_compra_item
  for each row when (new.remito_compra_item_id is not null)
  execute function public.fn_comprobante_compra_item_remito();

-- La cabecera de una factura con renglones de remitos no cambia de
-- proveedor ni de tipo (los renglones seguirían apuntando a remitos de
-- otro proveedor, o una nota facturaría remitos).
create or replace function public.fn_comprobante_compra_remito()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.proveedor_id is distinct from old.proveedor_id or new.tipo is distinct from old.tipo)
    and exists (
      select 1 from public.comprobante_compra_item ci
      where ci.comprobante_compra_id = new.id and ci.remito_compra_item_id is not null
    )
  then
    raise exception 'La factura tiene renglones de remitos: no cambia el proveedor ni el tipo.'
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;
  return new;
end;
$$;

create trigger trg_comprobante_compra_remito
  before update of proveedor_id, tipo on comprobante_compra
  for each row execute function public.fn_comprobante_compra_remito();

revoke execute on function public.fn_remito_compra_validar() from anon, authenticated, public;
revoke execute on function public.fn_remito_compra_borrar() from anon, authenticated, public;
revoke execute on function public.fn_remito_compra_item_bloqueo() from anon, authenticated, public;
revoke execute on function public.fn_remito_compra_item_articulo() from anon, authenticated, public;
revoke execute on function public.fn_remito_compra_con_items() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_item_remito() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_remito() from anon, authenticated, public;
-- La llama el trigger de la cabecera con el rol de quien escribe: sólo lee.
revoke execute on function public.fn_remito_compra_facturado(uuid) from public, anon;
grant execute on function public.fn_remito_compra_facturado(uuid) to authenticated;

-- ----- Artículo de un renglón (compartida) ---------------------------------

-- El artículo de un renglón de factura o de remito, sacado de
-- guardar_comprobante_compra (20261105000006) sin cambios de comportamiento:
--   - proveedor_articulo_id: ese artículo (si no existe, sólo el id, y lo
--     rechaza la clave foránea del renglón);
--   - articulo_nuevo { codigo, descripcion, unidad, factor_conversion,
--     materia_prima_id }: se busca en el catálogo del proveedor por código
--     (sin mayúsculas ni espacios en los bordes) o, sin código, por
--     descripción; si no está, se crea. Si estaba sin materia prima y
--     viene una, se la asocia;
--   - ninguno: vacío (un renglón libre).
create or replace function public.fn_compras_articulo(p_proveedor uuid, p_item jsonb)
returns public.proveedor_articulo
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_art public.proveedor_articulo;
  v_nuevo jsonb;
  v_codigo text;
  v_descripcion text;
  v_mp uuid;
begin
  if p_item->>'proveedor_articulo_id' is not null then
    select * into v_art from public.proveedor_articulo a where a.id = (p_item->>'proveedor_articulo_id')::uuid;
    if not found then
      v_art.id := (p_item->>'proveedor_articulo_id')::uuid;
    end if;
  elsif jsonb_typeof(p_item->'articulo_nuevo') = 'object' then
    v_nuevo := p_item->'articulo_nuevo';
    v_codigo := nullif(btrim(v_nuevo->>'codigo'), '');
    v_descripcion := btrim(v_nuevo->>'descripcion');
    v_mp := (v_nuevo->>'materia_prima_id')::uuid;

    -- Con on conflict, dos cargas a la vez del mismo artículo no chocan.
    if v_codigo is not null then
      insert into public.proveedor_articulo (proveedor_id, codigo, descripcion, unidad, factor_conversion, materia_prima_id)
      values (p_proveedor, v_codigo, v_descripcion, nullif(btrim(v_nuevo->>'unidad'), ''),
              coalesce((v_nuevo->>'factor_conversion')::numeric, 1), v_mp)
      on conflict (proveedor_id, lower(btrim(codigo))) where codigo is not null do nothing;

      select * into v_art from public.proveedor_articulo a
      where a.proveedor_id = p_proveedor and a.codigo is not null and lower(btrim(a.codigo)) = lower(v_codigo);
    else
      insert into public.proveedor_articulo (proveedor_id, descripcion, unidad, factor_conversion, materia_prima_id)
      values (p_proveedor, v_descripcion, nullif(btrim(v_nuevo->>'unidad'), ''),
              coalesce((v_nuevo->>'factor_conversion')::numeric, 1), v_mp)
      on conflict (proveedor_id, lower(btrim(descripcion))) where codigo is null do nothing;

      select * into v_art from public.proveedor_articulo a
      where a.proveedor_id = p_proveedor and a.codigo is null and lower(btrim(a.descripcion)) = lower(v_descripcion);
    end if;

    if v_art.materia_prima_id is null and v_mp is not null then
      update public.proveedor_articulo set materia_prima_id = v_mp where id = v_art.id
      returning * into v_art;
    end if;
  end if;

  return v_art;
end;
$$;

comment on function public.fn_compras_articulo(uuid, jsonb) is
  'Artículo de un renglón de compra: el indicado, o el nuevo buscado o dado de alta en el catálogo del proveedor. Vacío si el renglón no trae artículo';

-- Sólo hace lo que el usuario puede hacer directo sobre proveedor_articulo.
revoke execute on function public.fn_compras_articulo(uuid, jsonb) from public, anon;
grant execute on function public.fn_compras_articulo(uuid, jsonb) to authenticated;

-- ----- Guardar un remito ----------------------------------------------------

-- p_remito: { proveedor_id, punto_venta, numero, fecha, observaciones }
--   (fecha vacía: hoy en Argentina).
-- p_items: [{ proveedor_articulo_id | articulo_nuevo, codigo_proveedor,
--             descripcion, unidad, cantidad }]
--   El artículo, como en guardar_comprobante_compra (fn_compras_articulo);
--   sin artículo, RC011. Código, descripción y unidad: los que vengan, o
--   los del artículo. La materia prima sale siempre del artículo.
-- Crea un borrador (p_id vacío) o actualiza un borrador y reemplaza sus
-- renglones, en una sola transacción. No recibe.
create or replace function public.guardar_remito_compra(
  p_id uuid,
  p_remito jsonb,
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
  v_proveedor uuid := (p_remito->>'proveedor_id')::uuid;
  v_fecha date := coalesce(
    (p_remito->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
  v_item jsonb;
  v_orden bigint;
  v_art public.proveedor_articulo;
begin
  if v_id is not null then
    select r.estado into v_estado
    from public.remito_compra r
    where r.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el remito de compra.'
        using errcode = 'RC004', hint = 'remito_inexistente';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'El remito está %: no se puede modificar.', v_estado
        using errcode = 'RC001', hint = 'remito_inmutable';
    end if;

    -- Primero los renglones: así la cabecera puede cambiar de proveedor.
    delete from public.remito_compra_item where remito_compra_id = v_id;

    update public.remito_compra
    set proveedor_id = v_proveedor,
        punto_venta = (p_remito->>'punto_venta')::integer,
        numero = (p_remito->>'numero')::bigint,
        fecha = v_fecha,
        observaciones = p_remito->>'observaciones'
    where id = v_id;
  else
    insert into public.remito_compra (proveedor_id, punto_venta, numero, fecha, observaciones)
    values (
      v_proveedor,
      (p_remito->>'punto_venta')::integer,
      (p_remito->>'numero')::bigint,
      v_fecha,
      p_remito->>'observaciones'
    )
    returning id into v_id;
  end if;

  for v_item, v_orden in
    select e.item, e.orden from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, orden)
  loop
    v_art := public.fn_compras_articulo(v_proveedor, v_item);
    if v_art.id is null then
      raise exception 'Cada renglón del remito lleva un artículo del proveedor (el renglón % no tiene).', v_orden
        using errcode = 'RC011', hint = 'renglon_sin_articulo';
    end if;

    insert into public.remito_compra_item (
      remito_compra_id, orden, proveedor_articulo_id, codigo_proveedor, descripcion, unidad, cantidad
    )
    values (
      v_id,
      (v_orden - 1)::integer,
      v_art.id,
      coalesce(nullif(v_item->>'codigo_proveedor', ''), v_art.codigo),
      -- Tal cual la escribió el proveedor (sin recortar); en blanco, la del artículo.
      coalesce(case when btrim(v_item->>'descripcion') <> '' then v_item->>'descripcion' end,
               v_art.descripcion, v_item->>'descripcion'),
      coalesce(nullif(v_item->>'unidad', ''), v_art.unidad),
      (v_item->>'cantidad')::numeric
    );
  end loop;

  return v_id;
end;
$$;

comment on function public.guardar_remito_compra(uuid, jsonb, jsonb) is
  'Crea o actualiza un remito de compra en borrador y reemplaza sus renglones; da de alta en el catálogo los artículos nuevos. Devuelve el id';

-- ----- Recibir ---------------------------------------------------------------

-- Recibe un borrador: tiene que tener renglones y todos sus artículos con
-- materia prima. Antes, los renglones toman la materia prima vigente de su
-- artículo (se pudo asociar en el catálogo después de guardar).
create or replace function public.recibir_remito_compra(p_id uuid)
returns public.remito_compra
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_r public.remito_compra;
  v_descripcion text;
begin
  select * into v_r
  from public.remito_compra r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el remito de compra.'
      using errcode = 'RC004', hint = 'remito_inexistente';
  end if;
  if v_r.estado <> 'borrador' then
    raise exception 'Sólo se recibe un remito en borrador (el remito está %).', v_r.estado
      using errcode = 'RC002', hint = 'transicion_invalida';
  end if;
  if not exists (select 1 from public.remito_compra_item i where i.remito_compra_id = v_r.id) then
    raise exception 'El remito no tiene renglones.'
      using errcode = 'RC005', hint = 'remito_sin_items';
  end if;

  select i.descripcion into v_descripcion
  from public.remito_compra_item i
  join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
  where i.remito_compra_id = v_r.id and a.materia_prima_id is null
  order by i.orden
  limit 1;
  if found then
    raise exception 'El artículo "%" no tiene materia prima asociada.', v_descripcion
      using errcode = 'RC007', hint = 'articulo_sin_materia_prima';
  end if;

  -- El trigger del renglón copia la materia prima vigente del artículo.
  update public.remito_compra_item i
  set materia_prima_id = a.materia_prima_id
  from public.proveedor_articulo a
  where a.id = i.proveedor_articulo_id
    and i.remito_compra_id = v_r.id
    and i.materia_prima_id is distinct from a.materia_prima_id;

  -- El trigger sólo deja pasar a recibido con esta marca de la transacción.
  perform set_config('compras.recibiendo_remito', v_r.id::text, true);
  update public.remito_compra
  set estado = 'recibido',
      recibido_en = now()
  where id = v_r.id
  returning * into v_r;
  perform set_config('compras.recibiendo_remito', '', true);

  return v_r;
end;
$$;

comment on function public.recibir_remito_compra(uuid) is
  'Registra como recibido un remito de compra en borrador (con renglones y artículos con materia prima). Devuelve el remito';

-- ----- Anular ------------------------------------------------------------------

-- Anula un remito recibido sin nada facturado; conserva sus datos y deja
-- libre el número. El trigger lo vuelve a controlar.
create or replace function public.anular_remito_compra(p_id uuid)
returns public.remito_compra
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_r public.remito_compra;
begin
  select * into v_r
  from public.remito_compra r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el remito de compra.'
      using errcode = 'RC004', hint = 'remito_inexistente';
  end if;
  if v_r.estado <> 'recibido' then
    raise exception 'Sólo se anula un remito recibido (el remito está %).', v_r.estado
      using errcode = 'RC002', hint = 'transicion_invalida';
  end if;
  if public.fn_remito_compra_facturado(v_r.id) then
    raise exception 'El remito tiene cantidades facturadas: no se puede anular. Anulá o borrá antes las facturas que lo usan.'
      using errcode = 'RC008', hint = 'remito_facturado';
  end if;

  -- El trigger sólo deja pasar a anulado con esta marca de la transacción.
  perform set_config('compras.anulando_remito', v_r.id::text, true);
  update public.remito_compra
  set estado = 'anulado',
      anulado_en = now()
  where id = v_r.id
  returning * into v_r;
  perform set_config('compras.anulando_remito', '', true);

  return v_r;
end;
$$;

comment on function public.anular_remito_compra(uuid) is
  'Anula un remito de compra recibido sin nada facturado (conserva los datos y libera el número). Devuelve el remito';

-- ----- Guardar un comprobante ---------------------------------------------------

-- Igual que en 20261105000006, con el artículo resuelto por
-- fn_compras_articulo y, además, remito_compra_item_id en cada renglón
-- (vacío: sin remito). El editor lo manda de vuelta para no perder el
-- vínculo al volver a guardar una factura armada desde remitos. Los
-- controles del vínculo los hace trg_comprobante_compra_item_remito; los
-- renglones se borran antes de actualizar la cabecera, así
-- trg_comprobante_compra_remito mira sólo los nuevos.
create or replace function public.guardar_comprobante_compra(
  p_id uuid,
  p_comprobante jsonb,
  p_items jsonb,
  p_percepciones jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_estado text;
  v_proveedor uuid := (p_comprobante->>'proveedor_id')::uuid;
  v_fecha date := coalesce(
    (p_comprobante->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
  v_item jsonb;
  v_orden bigint;
  v_art public.proveedor_articulo;
begin
  if v_id is not null then
    select c.estado into v_estado
    from public.comprobante_compra c
    where c.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el comprobante de compra.'
        using errcode = 'CP004', hint = 'comprobante_inexistente';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'El comprobante está %: no se puede modificar.', v_estado
        using errcode = 'CP001', hint = 'comprobante_inmutable';
    end if;

    -- Primero los renglones: así la cabecera puede cambiar de proveedor o de letra.
    delete from public.comprobante_compra_item where comprobante_compra_id = v_id;
    delete from public.comprobante_compra_percepcion where comprobante_compra_id = v_id;

    update public.comprobante_compra
    set proveedor_id = v_proveedor,
        tipo = p_comprobante->>'tipo',
        letra = p_comprobante->>'letra',
        punto_venta = (p_comprobante->>'punto_venta')::integer,
        numero = (p_comprobante->>'numero')::bigint,
        fecha = v_fecha,
        fecha_vencimiento = (p_comprobante->>'fecha_vencimiento')::date,
        observaciones = p_comprobante->>'observaciones',
        comprobante_asociado_id = (p_comprobante->>'comprobante_asociado_id')::uuid
    where id = v_id;
  else
    insert into public.comprobante_compra (
      proveedor_id, tipo, letra, punto_venta, numero, fecha, fecha_vencimiento, observaciones,
      comprobante_asociado_id
    )
    values (
      v_proveedor,
      p_comprobante->>'tipo',
      p_comprobante->>'letra',
      (p_comprobante->>'punto_venta')::integer,
      (p_comprobante->>'numero')::bigint,
      v_fecha,
      (p_comprobante->>'fecha_vencimiento')::date,
      p_comprobante->>'observaciones',
      (p_comprobante->>'comprobante_asociado_id')::uuid
    )
    returning id into v_id;
  end if;

  for v_item, v_orden in
    select e.item, e.orden from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, orden)
  loop
    v_art := public.fn_compras_articulo(v_proveedor, v_item);

    insert into public.comprobante_compra_item (
      comprobante_compra_id, orden, proveedor_articulo_id, codigo_proveedor, descripcion, unidad,
      cantidad, precio_unitario, descuento_pct, alicuota_iva, exento, remito_compra_item_id
    )
    values (
      v_id,
      (v_orden - 1)::integer,
      v_art.id,
      coalesce(nullif(v_item->>'codigo_proveedor', ''), v_art.codigo),
      -- Tal cual la escribió el proveedor (sin recortar); en blanco, la del artículo.
      coalesce(case when btrim(v_item->>'descripcion') <> '' then v_item->>'descripcion' end,
               v_art.descripcion, v_item->>'descripcion'),
      coalesce(nullif(v_item->>'unidad', ''), v_art.unidad),
      (v_item->>'cantidad')::numeric,
      coalesce((v_item->>'precio_unitario')::numeric, 0),
      coalesce((v_item->>'descuento_pct')::numeric, 0),
      (v_item->>'alicuota_iva')::numeric,
      coalesce((v_item->>'exento')::boolean, false),
      (v_item->>'remito_compra_item_id')::uuid
    );
  end loop;

  insert into public.comprobante_compra_percepcion (comprobante_compra_id, tipo, jurisdiccion, descripcion, importe)
  select
    v_id,
    e.p->>'tipo',
    nullif(btrim(e.p->>'jurisdiccion'), ''),
    nullif(btrim(e.p->>'descripcion'), ''),
    (e.p->>'importe')::numeric
  from jsonb_array_elements(coalesce(p_percepciones, '[]'::jsonb)) as e(p);

  return v_id;
end;
$$;

comment on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) is
  'Crea o actualiza un comprobante de compra en borrador (con su factura asociada, si es una nota, y el renglón de remito de cada renglón) y reemplaza sus renglones y percepciones; da de alta en el catálogo los artículos nuevos. Devuelve el id';

-- ----- Facturar remitos ---------------------------------------------------------

-- p_items: [{ remito_compra_item_id, cantidad }]. Todos de remitos
-- recibidos de un mismo proveedor, cada cantidad > 0 y hasta lo pendiente.
-- p_comprobante: la cabecera de guardar_comprobante_compra (letra,
--   punto_venta, numero, fecha, fecha_vencimiento, observaciones). El tipo
--   es siempre factura y el proveedor, el de los remitos; sin factura
--   asociada ni percepciones.
-- Crea un borrador de factura con guardar_comprobante_compra: un renglón
-- por renglón de remito, en el orden pedido, con su artículo, código,
-- descripción y unidad, la cantidad pedida y remito_compra_item_id.
-- Precio sugerido: el vigente del proveedor para la materia prima del
-- artículo a la fecha de la factura (como precios_comprobante_compra: el
-- de vigente_desde más reciente hasta esa fecha; a igual fecha, el último
-- cargado) por el factor de conversión (precio por unidad del proveedor),
-- a 4 decimales; sin precio, 0. Alícuota 21 en A y M; ninguna en B y C.
-- Bloquea los remitos (en orden de id) antes de leer lo pendiente; el
-- trigger de comprobante_compra_item vuelve a controlar el tope.
create or replace function public.facturar_remitos_compra(
  p_items jsonb,
  p_comprobante jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fecha date := coalesce(
    (p_comprobante->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
  v_letra text := p_comprobante->>'letra';
  v_proveedor uuid;
  v_fila record;
  v_items jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elegí al menos un renglón de remito para facturar.'
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where (e->>'remito_compra_item_id') is null or coalesce((e->>'cantidad')::numeric, 0) <= 0
  ) then
    raise exception 'Cada renglón a facturar lleva su renglón de remito y una cantidad mayor que cero.'
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;
  if (select count(distinct e->>'remito_compra_item_id') from jsonb_array_elements(p_items) e)
    <> jsonb_array_length(p_items)
  then
    raise exception 'Un renglón de remito aparece más de una vez.'
      using errcode = 'RC009', hint = 'facturacion_invalida';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where not exists (
      select 1 from public.remito_compra_item ri where ri.id = (e->>'remito_compra_item_id')::uuid
    )
  ) then
    raise exception 'No se encontró un renglón de remito.'
      using errcode = 'RC004', hint = 'remito_inexistente';
  end if;

  -- Bloquea los remitos en orden de id (dos facturaciones a la vez no se
  -- cruzan ni se traban) y controla estado y proveedor.
  for v_fila in
    select r.id, r.estado, r.proveedor_id
    from public.remito_compra r
    where r.id in (
      select ri.remito_compra_id
      from jsonb_array_elements(p_items) e
      join public.remito_compra_item ri on ri.id = (e->>'remito_compra_item_id')::uuid
    )
    order by r.id
    for update
  loop
    if v_fila.estado <> 'recibido' then
      raise exception 'Sólo se facturan remitos recibidos (hay uno %).', v_fila.estado
        using errcode = 'RC009', hint = 'facturacion_invalida';
    end if;
    if v_proveedor is not null and v_proveedor <> v_fila.proveedor_id then
      raise exception 'Los remitos son de proveedores distintos: una factura junta remitos de un mismo proveedor.'
        using errcode = 'RC009', hint = 'facturacion_invalida';
    end if;
    v_proveedor := v_fila.proveedor_id;
  end loop;

  for v_fila in
    select (e->>'cantidad')::numeric as pedida, p.pendiente, p.descripcion, p.punto_venta, p.numero
    from jsonb_array_elements(p_items) e
    join public.v_remito_compra_item_pendiente p on p.remito_compra_item_id = (e->>'remito_compra_item_id')::uuid
    where (e->>'cantidad')::numeric > p.pendiente
    limit 1
  loop
    raise exception 'Del renglón "%" del remito %-% quedan % pendientes: no se pueden facturar %.',
      v_fila.descripcion, lpad(v_fila.punto_venta::text, 5, '0'), lpad(v_fila.numero::text, 8, '0'),
      v_fila.pendiente, v_fila.pedida
      using errcode = 'RC010', hint = 'excede_pendiente';
  end loop;

  select jsonb_agg(jsonb_build_object(
      'proveedor_articulo_id', ri.proveedor_articulo_id,
      'codigo_proveedor', ri.codigo_proveedor,
      'descripcion', ri.descripcion,
      'unidad', ri.unidad,
      'cantidad', (e.item->>'cantidad')::numeric,
      'precio_unitario', coalesce(round(pv.precio * a.factor_conversion, 4), 0),
      'alicuota_iva', case when v_letra in ('A', 'M') then 21 end,
      'remito_compra_item_id', ri.id
    ) order by e.orden)
    into v_items
  from jsonb_array_elements(p_items) with ordinality as e(item, orden)
  join public.remito_compra_item ri on ri.id = (e.item->>'remito_compra_item_id')::uuid
  join public.proveedor_articulo a on a.id = ri.proveedor_articulo_id
  left join lateral (
    select p.precio
    from public.precio_materia_prima p
    where p.materia_prima_id = a.materia_prima_id
      and p.proveedor_id = v_proveedor
      and p.vigente_desde <= v_fecha
    order by p.vigente_desde desc, p.creado_en desc
    limit 1
  ) pv on true;

  return public.guardar_comprobante_compra(
    null,
    p_comprobante || jsonb_build_object(
      'proveedor_id', v_proveedor,
      'tipo', 'factura',
      'fecha', v_fecha,
      'comprobante_asociado_id', null
    ),
    v_items,
    '[]'::jsonb
  );
end;
$$;

comment on function public.facturar_remitos_compra(jsonb, jsonb) is
  'Crea un borrador de factura de compra con cantidades de renglones de remitos recibidos de un mismo proveedor (hasta lo pendiente), con el precio vigente sugerido y el vínculo con cada renglón de remito. Devuelve el id';

-- create or replace conserva los permisos de guardar_comprobante_compra; se repiten por claridad.
revoke execute on function public.guardar_remito_compra(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.recibir_remito_compra(uuid) from public, anon;
revoke execute on function public.anular_remito_compra(uuid) from public, anon;
revoke execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.facturar_remitos_compra(jsonb, jsonb) from public, anon;
grant execute on function public.guardar_remito_compra(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.recibir_remito_compra(uuid) to authenticated;
grant execute on function public.anular_remito_compra(uuid) to authenticated;
grant execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.facturar_remitos_compra(jsonb, jsonb) to authenticated;

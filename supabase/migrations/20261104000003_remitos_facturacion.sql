-- =====================================================================
-- Charoli Gestión - Facturación de remitos
-- Un remito emitido se factura por cantidad, total o parcialmente, y una
-- factura puede juntar remitos distintos de un mismo cliente.
--
--   - Vínculo por ítem: comprobante_item.remito_item_id. Lo facturado de
--     un ítem de remito es la suma de las cantidades de los ítems de
--     comprobante que lo apuntan, en cualquier estado (borrador,
--     verificando, autorizado o rechazado): así dos borradores no
--     facturan lo mismo. Si se borra el borrador, sus ítems caen en
--     cascada y la cantidad vuelve a quedar pendiente.
--   - Pendiente = cantidad − facturado (v_remito_item_pendiente). El
--     estado derivado del remito (v_remito_estado) es emitido, parcial o
--     facturado según lo facturado; borrador y anulado, como están.
--   - Tope: un trigger de comprobante_item bloquea la fila del remito y
--     no deja que lo facturado supere la cantidad del ítem. Sólo apunta a
--     remitos emitidos, del mismo cliente que el comprobante, desde una
--     factura. Vale también para SQL directo.
--   - Bloqueo: un remito con cualquier cantidad facturada no se modifica
--     (cabecera, ítems ni anulación). Vuelve a editarse cuando no queda
--     nada facturado.
--   - facturar_remitos arma un borrador de factura con
--     guardar_borrador_comprobante; guardar_remito guarda un remito con
--     sus ítems en una sola llamada.
--
-- Además corrige tres advertencias de la revisión de 20261104000001:
--   1. Las transiciones borrador -> emitido y emitido -> anulado ya no se
--      apoyan sólo en la marca de la transacción (remito.emitiendo /
--      remito.anulando, que cualquier sesión puede poner con set_config):
--      el trigger exige además lo mismo que emitir_remito (ítems, punto
--      de venta activo y número = último + 1, con el mismo candado) y que
--      anular_remito (nada facturado).
--   2. fn_remito_item_bloqueo bloquea la fila del remito (for update)
--      antes de leer su estado: un ítem que se agrega mientras se anula o
--      se factura espera y ve el estado final.
--   3. Borrar una lista de precios usada por un remito anulado o
--      facturado ponía su lista_precio_id en null (on delete set null) y
--      el trigger lo rechazaba. Ahora se acepta ese único cambio cuando la
--      lista ya no existe (es decir, sólo el que hace la clave foránea).
--
-- Reemplaza fn_remito_validar, fn_remito_item_bloqueo y anular_remito
-- (20261104000001) y guardar_borrador_comprobante (20261030000003).
--
-- Errores nuevos (SQLSTATE propio, el HINT repite el motivo):
--   RM008 remito_facturado       (modificar o anular un remito con algo facturado)
--   RM009 facturacion_invalida   (ítems vacíos o repetidos, cantidad <= 0,
--                                 remito no emitido, otro cliente, no factura)
--   RM010 excede_pendiente       (facturar más que lo pendiente)
-- =====================================================================

-- ----- Vínculo ---------------------------------------------------------------

alter table comprobante_item
  add column remito_item_id uuid references remito_item(id) on delete restrict;

comment on column comprobante_item.remito_item_id is
  'Ítem de remito que factura este renglón (sólo en facturas). Su cantidad cuenta como facturada del remito en cualquier estado del comprobante';

create index comprobante_item_remito_item_idx on comprobante_item (remito_item_id)
  where remito_item_id is not null;

-- ----- Pendiente por ítem y estado derivado ------------------------------------

create view v_remito_item_pendiente
with (security_invoker = true) as
select
  ri.id as remito_item_id,
  ri.remito_id,
  r.cliente_id,
  r.punto_venta,
  r.numero,
  r.fecha,
  r.estado as estado_remito,
  ri.orden,
  ri.producto_id,
  ri.codigo,
  ri.descripcion,
  ri.unidad,
  ri.precio_unitario,
  ri.descuento_pct,
  ri.gravado,
  ri.alicuota_iva,
  ri.bultos,
  ri.cantidad,
  coalesce(f.facturado, 0) as facturado,
  ri.cantidad - coalesce(f.facturado, 0) as pendiente
from remito_item ri
join remito r on r.id = ri.remito_id
left join (
  select ci.remito_item_id, sum(ci.cantidad) as facturado
  from comprobante_item ci
  where ci.remito_item_id is not null
  group by ci.remito_item_id
) f on f.remito_item_id = ri.id;

comment on view v_remito_item_pendiente is
  'Cantidad, facturado (suma de los ítems de comprobante que lo apuntan, borradores incluidos) y pendiente de cada ítem de remito';

create view v_remito_estado
with (security_invoker = true) as
select
  r.id as remito_id,
  r.cliente_id,
  r.punto_venta,
  r.numero,
  case when r.numero is not null
    then 'R-' || lpad(r.punto_venta::text, 5, '0') || '-' || lpad(r.numero::text, 8, '0')
  end as numero_texto,
  r.fecha,
  r.estado as estado_guardado,
  case
    when r.estado <> 'emitido' then r.estado
    when coalesce(sum(p.facturado), 0) = 0 then 'emitido'
    when coalesce(sum(p.pendiente), 0) <= 0 then 'facturado'
    else 'parcial'
  end as estado,
  coalesce(sum(p.cantidad), 0) as cantidad,
  coalesce(sum(p.facturado), 0) as facturado,
  coalesce(sum(p.pendiente), 0) as pendiente
from remito r
left join v_remito_item_pendiente p on p.remito_id = r.id
group by r.id;

comment on view v_remito_estado is
  'Estado de cada remito: borrador, emitido (nada facturado), parcial, facturado (nada pendiente) o anulado, con los totales de cantidad, facturado y pendiente';

revoke all on public.v_remito_item_pendiente, public.v_remito_estado from anon;
grant select on public.v_remito_item_pendiente, public.v_remito_estado to authenticated;

-- ----- Estado e inmutabilidad del remito ---------------------------------

-- Igual que en 20261104000001, más:
--   - borrador -> emitido: además de la marca remito.emitiendo, ítems,
--     punto de venta activo y número = último + 1 del punto de venta (con
--     el candado de emitir_remito); la emisión la fecha el trigger;
--   - emitido -> anulado: además de la marca remito.anulando, nada
--     facturado (RM008);
--   - un emitido con algo facturado no cambia (RM008);
--   - en un anulado o un facturado se acepta que lista_precio_id pase a
--     null cuando la lista ya no existe (on delete set null).
create or replace function public.fn_remito_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignorar text[] := array['estado', 'anulado_en', 'actualizado_en'];
  v_facturado boolean;
  v_numero bigint;
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

  -- La clave foránea de la lista (on delete set null) es el único cambio
  -- que se acepta en un anulado o un facturado.
  if old.estado = 'anulado' or (
    old.estado = 'emitido' and exists (
      select 1
      from public.comprobante_item ci
      join public.remito_item ri on ri.id = ci.remito_item_id
      where ri.remito_id = old.id
    )
  ) then
    v_facturado := old.estado = 'emitido';
    if (to_jsonb(new) - 'actualizado_en' - 'lista_precio_id') is distinct from (to_jsonb(old) - 'actualizado_en' - 'lista_precio_id')
      or (
        new.lista_precio_id is distinct from old.lista_precio_id
        and not (
          new.lista_precio_id is null
          and not exists (select 1 from public.lista_precio l where l.id = old.lista_precio_id)
        )
      )
    then
      if v_facturado then
        raise exception 'El remito tiene cantidades facturadas: no se puede modificar ni anular. Borrá antes los borradores de factura que lo usan.'
          using errcode = 'RM008', hint = 'remito_facturado';
      end if;
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
      new.anulado_en := now();
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
    -- Lo mismo que controla emitir_remito: la marca sola no alcanza.
    if not exists (select 1 from public.remito_item i where i.remito_id = new.id) then
      raise exception 'El remito no tiene ítems.'
        using errcode = 'RM005', hint = 'remito_sin_items';
    end if;
    if not exists (select 1 from public.punto_venta pv where pv.numero = new.punto_venta and pv.activo) then
      raise exception 'El punto de venta % no existe o no está activo.', new.punto_venta
        using errcode = 'RM007', hint = 'punto_venta_invalido';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('remito:' || new.punto_venta::text, 0));
    select coalesce(max(r.numero), 0) + 1 into v_numero
    from public.remito r
    where r.punto_venta = new.punto_venta
      and r.numero is not null
      and r.id <> new.id;
    if new.numero is distinct from v_numero then
      raise exception 'El remito se emite con el número % del punto de venta %, no con %.', v_numero, new.punto_venta, new.numero
        using errcode = 'RM002', hint = 'transicion_invalida';
    end if;
    new.emitido_en := now();
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

-- Los ítems cambian mientras el remito está en borrador o emitido sin
-- nada facturado. Antes de mirar el estado bloquea la fila del remito
-- (for update, en orden de id): un ítem que se agrega mientras otra
-- transacción anula o factura el remito espera y ve el estado final. Si
-- el remito ya no existe (borrado en cascada) no hay nada que proteger.
create or replace function public.fn_remito_item_bloqueo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_r record;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.remito_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.remito_id, new.remito_id];
  else
    v_ids := array[old.remito_id];
  end if;

  for v_r in
    select r.id, r.estado
    from public.remito r
    where r.id = any (v_ids)
    order by r.id
    for update
  loop
    if v_r.estado = 'anulado' then
      raise exception 'El remito está anulado: sus ítems no se pueden cambiar.'
        using errcode = 'RM001', hint = 'remito_anulado_inmutable';
    end if;
    if exists (
      select 1
      from public.comprobante_item ci
      join public.remito_item ri on ri.id = ci.remito_item_id
      where ri.remito_id = v_r.id
    ) then
      raise exception 'El remito tiene cantidades facturadas: sus ítems no se pueden cambiar. Borrá antes los borradores de factura que lo usan.'
        using errcode = 'RM008', hint = 'remito_facturado';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ----- Anular ------------------------------------------------------------

-- Igual que en 20261104000001, más: rechaza un remito con algo facturado
-- (incluidos los borradores de factura). El trigger lo controla igual.
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
  if exists (
    select 1
    from public.comprobante_item ci
    join public.remito_item ri on ri.id = ci.remito_item_id
    where ri.remito_id = v_r.id
  ) then
    raise exception 'El remito tiene cantidades facturadas: no se puede anular. Borrá antes los borradores de factura que lo usan.'
      using errcode = 'RM008', hint = 'remito_facturado';
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
  'Anula un remito emitido sin nada facturado (conserva el número). Devuelve el remito';

-- ----- Tope de lo facturado ----------------------------------------------------

-- Después de insertar o cambiar un ítem de comprobante que apunta a un
-- ítem de remito: bloquea la fila del remito (dos borradores a la vez se
-- serializan, y el segundo ve lo que guardó el primero), exige que el
-- remito esté emitido, que el comprobante sea una factura del mismo
-- cliente y que lo facturado del ítem no supere su cantidad. Es AFTER
-- para ver todas las filas de la misma sentencia.
create or replace function public.fn_comprobante_item_remito()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_r public.remito;
  v_cantidad numeric;
  v_facturado numeric;
  v_c record;
begin
  select r.* into v_r
  from public.remito r
  where r.id = (select ri.remito_id from public.remito_item ri where ri.id = new.remito_item_id)
  for update;
  if not found then
    raise exception 'No se encontró el ítem de remito.'
      using errcode = 'RM004', hint = 'remito_inexistente';
  end if;

  if v_r.estado <> 'emitido' then
    raise exception 'Sólo se facturan remitos emitidos (el remito está %).', v_r.estado
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;

  select c.clase, c.cliente_id into v_c
  from public.comprobante c
  where c.id = new.comprobante_id;
  if v_c.clase is distinct from 'factura' then
    raise exception 'Sólo una factura puede facturar un remito.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;
  if v_c.cliente_id is distinct from v_r.cliente_id then
    raise exception 'El remito es de otro cliente: una factura junta remitos de un mismo cliente.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;

  select ri.cantidad into v_cantidad from public.remito_item ri where ri.id = new.remito_item_id;
  select coalesce(sum(ci.cantidad), 0) into v_facturado
  from public.comprobante_item ci
  where ci.remito_item_id = new.remito_item_id;

  if v_facturado > v_cantidad then
    raise exception 'Se facturaría % de un ítem de remito de %: lo pendiente es %.',
      v_facturado, v_cantidad, v_cantidad - (v_facturado - new.cantidad)
      using errcode = 'RM010', hint = 'excede_pendiente';
  end if;

  return null;
end;
$$;

create trigger trg_comprobante_item_remito
  after insert or update of remito_item_id, cantidad, comprobante_id on comprobante_item
  for each row when (new.remito_item_id is not null)
  execute function public.fn_comprobante_item_remito();

-- La cabecera de una factura con ítems de remito no cambia de cliente ni
-- de clase (los ítems seguirían apuntando a remitos de otro cliente).
create or replace function public.fn_comprobante_remito()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.cliente_id is distinct from old.cliente_id or new.clase is distinct from old.clase)
    and exists (
      select 1 from public.comprobante_item ci
      where ci.comprobante_id = new.id and ci.remito_item_id is not null
    )
  then
    raise exception 'La factura tiene ítems de remitos: no cambia el cliente ni la clase.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;
  return new;
end;
$$;

create trigger trg_comprobante_remito
  before update of cliente_id, clase on comprobante
  for each row execute function public.fn_comprobante_remito();

revoke execute on function public.fn_comprobante_item_remito() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_remito() from anon, authenticated, public;

-- ----- Guardar un borrador -------------------------------------------------

-- Igual que en 20261030000003, más remito_item_id en los ítems:
--   - un ítem que trae la clave remito_item_id la usa tal cual (null lo
--     desvincula);
--   - al volver a guardar una factura, un ítem sin la clave (el editor de
--     comprobantes no la conoce) hereda el vínculo del ítem anterior con
--     el mismo producto y la misma descripción, en el mismo orden relativo.
--     Una nota o un comprobante nuevo (copia, nota generada) no heredan
--     nada.
-- Borra los ítems anteriores antes de actualizar la cabecera, así el
-- control de cliente y clase (trg_comprobante_remito) mira sólo los
-- ítems nuevos. El tope de lo facturado lo controla
-- trg_comprobante_item_remito.
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
  v_vinculos jsonb := '[]'::jsonb;
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
    -- Vínculos con remitos de los ítems que se reemplazan.
    with borrados as (
      delete from public.comprobante_item ci
      where ci.comprobante_id = v_id
      returning ci.orden, ci.producto_id, ci.descripcion, ci.remito_item_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'orden', b.orden, 'producto_id', b.producto_id, 'descripcion', b.descripcion,
             'remito_item_id', b.remito_item_id
           )), '[]'::jsonb)
      into v_vinculos
    from borrados b
    where b.remito_item_id is not null;

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
  end if;

  -- Sólo una factura hereda vínculos.
  if v_clase is distinct from 'factura' then
    v_vinculos := '[]'::jsonb;
  end if;

  insert into public.comprobante_item (
    comprobante_id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad,
    precio_unitario, descuento_pct, gravado, alicuota_iva, importe, iva, remito_item_id
  )
  with nuevos as (
    select
      e.item,
      e.orden,
      e.item ? 'remito_item_id' as explicito,
      row_number() over (
        partition by e.item ? 'remito_item_id', (e.item->>'producto_id')::uuid, e.item->>'descripcion'
        order by e.orden
      ) as rango
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, orden)
  ),
  previos as (
    select
      (v->>'producto_id')::uuid as producto_id,
      v->>'descripcion' as descripcion,
      (v->>'remito_item_id')::uuid as remito_item_id,
      row_number() over (
        partition by (v->>'producto_id')::uuid, v->>'descripcion'
        order by (v->>'orden')::integer
      ) as rango
    from jsonb_array_elements(v_vinculos) v
  )
  select
    v_id,
    (n.orden - 1)::integer,
    (n.item->>'producto_id')::uuid,
    n.item->>'codigo',
    n.item->>'descripcion',
    n.item->>'observaciones',
    n.item->>'unidad',
    (n.item->>'cantidad')::numeric,
    coalesce((n.item->>'precio_unitario')::numeric, 0),
    coalesce((n.item->>'descuento_pct')::numeric, 0),
    coalesce((n.item->>'gravado')::boolean, true),
    (n.item->>'alicuota_iva')::numeric,
    coalesce((n.item->>'importe')::numeric, 0),
    coalesce((n.item->>'iva')::numeric, 0),
    case when n.explicito then (n.item->>'remito_item_id')::uuid else p.remito_item_id end
  from nuevos n
  left join previos p
    on not n.explicito
   and p.producto_id is not distinct from (n.item->>'producto_id')::uuid
   and p.descripcion is not distinct from n.item->>'descripcion'
   and p.rango = n.rango
  order by n.orden;

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
  'Crea o actualiza un borrador (o corrige un rechazado) y reemplaza sus ítems (conservando sus vínculos con remitos) y, si se mandan, sus asociados (o su período asociado), en una sola transacción';

revoke execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ----- Facturar remitos ------------------------------------------------------

-- p_items: [{ remito_item_id, cantidad }]. Todos de remitos emitidos de un
-- mismo cliente, cada cantidad > 0 y hasta lo pendiente. Crea un borrador
-- de factura con guardar_borrador_comprobante: letra X en un punto de
-- venta no electrónico (sin IVA), si no A o B por la condición de IVA del
-- cliente (como convertir_presupuesto). Un ítem por ítem de remito, en el
-- orden pedido, con producto, código, descripción, unidad, precio,
-- descuento, gravado y alícuota del remito, la cantidad pedida y
-- remito_item_id. Condición de pago y lista de precios del primer remito;
-- fecha de hoy. Bloquea los remitos (en orden de id) antes de leer lo
-- pendiente; el trigger de comprobante_item vuelve a controlar el tope.
create or replace function public.facturar_remitos(
  p_items jsonb,
  p_punto_venta integer
)
returns public.comprobante
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_electronico boolean;
  v_letra text;
  v_primero public.remito;
  v_fila record;
  v_items jsonb;
  v_neto numeric;
  v_no_gravado numeric;
  v_iva numeric;
  v_id uuid;
  v_c public.comprobante;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elegí al menos un ítem de remito para facturar.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where (e->>'remito_item_id') is null or coalesce((e->>'cantidad')::numeric, 0) <= 0
  ) then
    raise exception 'Cada ítem a facturar lleva su ítem de remito y una cantidad mayor que cero.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;
  if (select count(distinct e->>'remito_item_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
    raise exception 'Un ítem de remito aparece más de una vez.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where not exists (select 1 from public.remito_item ri where ri.id = (e->>'remito_item_id')::uuid)
  ) then
    raise exception 'No se encontró un ítem de remito.'
      using errcode = 'RM004', hint = 'remito_inexistente';
  end if;

  select pv.electronico into v_electronico
  from public.punto_venta pv
  where pv.numero = p_punto_venta and pv.activo;
  if v_electronico is null then
    raise exception 'El punto de venta % no existe o no está activo.', p_punto_venta
      using errcode = 'RM007', hint = 'punto_venta_invalido';
  end if;

  -- Bloquea los remitos en orden de id (dos facturaciones a la vez no se
  -- cruzan ni se traban) y controla estado y cliente.
  for v_fila in
    select r.id, r.estado, r.cliente_id, r.punto_venta, r.numero
    from public.remito r
    where r.id in (
      select ri.remito_id
      from jsonb_array_elements(p_items) e
      join public.remito_item ri on ri.id = (e->>'remito_item_id')::uuid
    )
    order by r.id
    for update
  loop
    if v_fila.estado <> 'emitido' then
      raise exception 'Sólo se facturan remitos emitidos (hay uno %).', v_fila.estado
        using errcode = 'RM009', hint = 'facturacion_invalida';
    end if;
  end loop;

  if (
    select count(distinct r.cliente_id)
    from jsonb_array_elements(p_items) e
    join public.remito_item ri on ri.id = (e->>'remito_item_id')::uuid
    join public.remito r on r.id = ri.remito_id
  ) > 1 then
    raise exception 'Los remitos son de clientes distintos: una factura junta remitos de un mismo cliente.'
      using errcode = 'RM009', hint = 'facturacion_invalida';
  end if;

  for v_fila in
    select (e->>'cantidad')::numeric as pedida, p.pendiente, p.descripcion, p.punto_venta, p.numero
    from jsonb_array_elements(p_items) e
    join public.v_remito_item_pendiente p on p.remito_item_id = (e->>'remito_item_id')::uuid
    where (e->>'cantidad')::numeric > p.pendiente
    limit 1
  loop
    raise exception 'Del ítem "%" del remito R-%-% quedan % pendientes: no se pueden facturar %.',
      v_fila.descripcion, lpad(v_fila.punto_venta::text, 5, '0'), lpad(v_fila.numero::text, 8, '0'),
      v_fila.pendiente, v_fila.pedida
      using errcode = 'RM010', hint = 'excede_pendiente';
  end loop;

  select r.* into v_primero
  from public.remito_item ri
  join public.remito r on r.id = ri.remito_id
  where ri.id = (p_items->0->>'remito_item_id')::uuid;

  if v_electronico then
    select case cl.condicion_iva
             when 'Responsable Inscripto' then 'A'
             when 'Monotributista' then 'A'
             when 'Exento' then 'B'
             when 'Consumidor Final' then 'B'
           end
      into v_letra
    from public.cliente cl
    where cl.id = v_primero.cliente_id;
  else
    v_letra := 'X';
  end if;

  -- Importe = cantidad × precio × (1 − dto%) a 2 decimales; IVA del
  -- renglón informativo; IVA del comprobante por alícuota sobre la base
  -- sumada, redondeado una vez (como src/lib/comprobantes/calculo.ts). X:
  -- sin IVA.
  with calculados as (
    select
      e.orden,
      (e.item->>'cantidad')::numeric as cantidad,
      ri.id, ri.producto_id, ri.codigo, ri.descripcion, ri.observaciones, ri.unidad, ri.precio_unitario,
      ri.descuento_pct, ri.gravado, ri.alicuota_iva,
      round((e.item->>'cantidad')::numeric * ri.precio_unitario * (1 - ri.descuento_pct / 100), 2) as importe_calc
    from jsonb_array_elements(p_items) with ordinality as e(item, orden)
    join public.remito_item ri on ri.id = (e.item->>'remito_item_id')::uuid
  )
  select
    jsonb_agg(jsonb_build_object(
      'producto_id', c.producto_id, 'codigo', c.codigo, 'descripcion', c.descripcion,
      'observaciones', c.observaciones, 'unidad', c.unidad, 'cantidad', c.cantidad,
      'precio_unitario', c.precio_unitario, 'descuento_pct', c.descuento_pct, 'gravado', c.gravado,
      'alicuota_iva', c.alicuota_iva, 'importe', c.importe_calc,
      'iva', case when v_letra = 'X' or not c.gravado then 0 else round(c.importe_calc * c.alicuota_iva / 100, 2) end,
      'remito_item_id', c.id
    ) order by c.orden),
    coalesce(sum(c.importe_calc) filter (where c.gravado), 0),
    coalesce(sum(c.importe_calc) filter (where not c.gravado), 0)
    into v_items, v_neto, v_no_gravado
  from calculados c;

  if v_letra = 'X' then
    v_iva := 0;
  else
    select coalesce(sum(round(b.base * b.alicuota_iva / 100, 2)), 0) into v_iva
    from (
      select ri.alicuota_iva,
             sum(round((e->>'cantidad')::numeric * ri.precio_unitario * (1 - ri.descuento_pct / 100), 2)) as base
      from jsonb_array_elements(p_items) e
      join public.remito_item ri on ri.id = (e->>'remito_item_id')::uuid
      where ri.gravado
      group by ri.alicuota_iva
    ) b;
  end if;

  v_id := public.guardar_borrador_comprobante(
    null,
    jsonb_build_object(
      'punto_venta', p_punto_venta,
      'clase', 'factura',
      'letra', v_letra,
      'tipo_arca', case v_letra when 'A' then 1 when 'B' then 6 end,
      'fecha', v_hoy,
      'fecha_vencimiento_pago', greatest(v_primero.fecha_vencimiento_pago, v_hoy),
      'cliente_id', v_primero.cliente_id,
      'lista_precio_id', v_primero.lista_precio_id,
      'condicion_pago', v_primero.condicion_pago,
      'observaciones', null,
      'periodo_asoc_desde', null,
      'periodo_asoc_hasta', null,
      'neto', v_neto,
      'no_gravado', v_no_gravado,
      'iva', v_iva,
      'total', v_neto + v_no_gravado + v_iva
    ),
    v_items,
    null
  );

  select * into v_c from public.comprobante c where c.id = v_id;
  return v_c;
end;
$$;

comment on function public.facturar_remitos(jsonb, integer) is
  'Crea un borrador de factura con cantidades de ítems de remitos emitidos de un mismo cliente (hasta lo pendiente), vinculando cada ítem con su remito. Devuelve el comprobante';

revoke execute on function public.facturar_remitos(jsonb, integer) from public, anon;
grant execute on function public.facturar_remitos(jsonb, integer) to authenticated;

-- ----- Guardar un remito -----------------------------------------------------

-- p_remito: { punto_venta, cliente_id, fecha, fecha_vencimiento_pago,
--             condicion_pago, lista_precio_id, transporte_id,
--             domicilio_entrega, observaciones, valor_declarado,
--             neto, no_gravado, iva, total }
--   fecha vacía: hoy; vencimiento vacío: la fecha; condicion_pago vacía:
--   cuenta_corriente; valor_declarado vacío: 0.
-- p_items: [{ producto_id, codigo, descripcion, observaciones, unidad,
--             cantidad, precio_unitario, descuento_pct, gravado,
--             alicuota_iva, importe, iva, bultos }]
--   (gravado vacío: true; bultos vacío: 0)
-- Crea un borrador (p_id vacío) o actualiza un borrador o un emitido sin
-- nada facturado, y reemplaza sus ítems, en una sola transacción. No
-- emite (emitir_remito) ni anula (anular_remito). En un emitido, los
-- triggers rechazan cambiar punto de venta o cliente (RM006).
create or replace function public.guardar_remito(
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
  v_fecha date := coalesce(
    (p_remito->>'fecha')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
begin
  if v_id is not null then
    select r.estado into v_estado
    from public.remito r
    where r.id = v_id
    for update;
    if not found then
      raise exception 'No se encontró el remito.'
        using errcode = 'RM004', hint = 'remito_inexistente';
    end if;
    if v_estado = 'anulado' then
      raise exception 'El remito está anulado: no se puede modificar.'
        using errcode = 'RM001', hint = 'remito_anulado_inmutable';
    end if;
    if exists (
      select 1
      from public.comprobante_item ci
      join public.remito_item ri on ri.id = ci.remito_item_id
      where ri.remito_id = v_id
    ) then
      raise exception 'El remito tiene cantidades facturadas: no se puede modificar. Borrá antes los borradores de factura que lo usan.'
        using errcode = 'RM008', hint = 'remito_facturado';
    end if;
  end if;

  if v_id is null then
    insert into public.remito (
      punto_venta, cliente_id, fecha, fecha_vencimiento_pago, condicion_pago, lista_precio_id, transporte_id,
      domicilio_entrega, observaciones, valor_declarado, neto, no_gravado, iva, total
    )
    values (
      (p_remito->>'punto_venta')::integer,
      (p_remito->>'cliente_id')::uuid,
      v_fecha,
      (p_remito->>'fecha_vencimiento_pago')::date,
      coalesce(p_remito->>'condicion_pago', 'cuenta_corriente'),
      (p_remito->>'lista_precio_id')::uuid,
      (p_remito->>'transporte_id')::uuid,
      p_remito->>'domicilio_entrega',
      p_remito->>'observaciones',
      coalesce((p_remito->>'valor_declarado')::numeric, 0),
      coalesce((p_remito->>'neto')::numeric, 0),
      coalesce((p_remito->>'no_gravado')::numeric, 0),
      coalesce((p_remito->>'iva')::numeric, 0),
      coalesce((p_remito->>'total')::numeric, 0)
    )
    returning id into v_id;
  else
    update public.remito
    set punto_venta = (p_remito->>'punto_venta')::integer,
        cliente_id = (p_remito->>'cliente_id')::uuid,
        fecha = v_fecha,
        fecha_vencimiento_pago = (p_remito->>'fecha_vencimiento_pago')::date,
        condicion_pago = coalesce(p_remito->>'condicion_pago', 'cuenta_corriente'),
        lista_precio_id = (p_remito->>'lista_precio_id')::uuid,
        transporte_id = (p_remito->>'transporte_id')::uuid,
        domicilio_entrega = p_remito->>'domicilio_entrega',
        observaciones = p_remito->>'observaciones',
        valor_declarado = coalesce((p_remito->>'valor_declarado')::numeric, 0),
        neto = coalesce((p_remito->>'neto')::numeric, 0),
        no_gravado = coalesce((p_remito->>'no_gravado')::numeric, 0),
        iva = coalesce((p_remito->>'iva')::numeric, 0),
        total = coalesce((p_remito->>'total')::numeric, 0)
    where id = v_id;

    delete from public.remito_item where remito_id = v_id;
  end if;

  insert into public.remito_item (
    remito_id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad,
    precio_unitario, descuento_pct, gravado, alicuota_iva, importe, iva, bultos
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
    coalesce((e.item->>'iva')::numeric, 0),
    coalesce((e.item->>'bultos')::integer, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, orden);

  return v_id;
end;
$$;

comment on function public.guardar_remito(uuid, jsonb, jsonb) is
  'Crea un remito en borrador o actualiza un borrador o un emitido sin nada facturado, y reemplaza sus ítems, en una sola transacción. Devuelve el id';

revoke execute on function public.guardar_remito(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_remito(uuid, jsonb, jsonb) to authenticated;

-- =====================================================================
-- Charoli Gestión - Notas de crédito y débito asociadas a una factura
--
-- Una nota de crédito o de débito de compra puede indicar a qué factura
-- corrige (comprobante_asociado_id). Es opcional: una nota suelta se carga
-- con los importes que se quiera. La app abre una nota desde una factura
-- confirmada con sus renglones y precios ya cargados para ajustarlos.
--
-- Reglas (trigger, así que valen también para SQL directo):
--   - sólo una nota de crédito o de débito tiene factura asociada;
--   - la asociada es una factura confirmada, del mismo proveedor y la
--     misma letra, y no el mismo comprobante;
--   - se controla al guardar el borrador y otra vez al confirmarlo (la
--     factura pudo anularse mientras tanto). La factura se bloquea (for
--     share) mientras se controla, así no se anula a la vez;
--   - un confirmado o un anulado no cambia (lo controla el trigger de
--     validación de 20261105000003), así que no se vuelve a controlar.
--
-- Precios de costeo: las notas no los actualizan. precios_comprobante_compra
-- no devuelve renglones de una nota y confirmar_comprobante_compra rechaza
-- renglones elegidos en una nota.
--
-- Anular: una factura con notas asociadas confirmadas no se anula (primero
-- se anulan las notas). Una nota en borrador no lo impide: todavía no
-- cuenta y, como la factura ya no está confirmada, no se va a poder
-- confirmar asociada a ella (se asocia a otra o queda suelta).
--
-- Errores nuevos (siguen la lista de 20261105000005):
--   CP012 comprobante_asociado_invalido (no es una nota, o la factura no
--                                       es una factura confirmada del mismo
--                                       proveedor y letra, o es ella misma)
--   CP013 nota_sin_precios             (al confirmar una nota con
--                                       renglones elegidos para precios)
--   CP014 factura_con_notas            (al anular una factura con notas
--                                       confirmadas)
-- =====================================================================

-- ----- Columna -----------------------------------------------------------

alter table comprobante_compra
  add column comprobante_asociado_id uuid references comprobante_compra(id) on delete restrict;

comment on column comprobante_compra.comprobante_asociado_id is
  'Factura que corrige una nota de crédito o débito (opcional). Confirmada, del mismo proveedor y la misma letra';

create index comprobante_compra_asociado_idx on comprobante_compra (comprobante_asociado_id);

-- ----- Control de la asociación -------------------------------------------

create or replace function public.fn_comprobante_compra_asociado()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_f record;
begin
  if new.comprobante_asociado_id is null then
    return new;
  end if;
  -- Sólo el alta y los borradores (incluida su confirmación): un
  -- confirmado o anulado no cambia.
  if tg_op = 'UPDATE' and old.estado <> 'borrador' then
    return new;
  end if;

  if new.tipo not in ('nota_credito', 'nota_debito') then
    raise exception 'Sólo una nota de crédito o de débito tiene factura asociada.'
      using errcode = 'CP012', hint = 'comprobante_asociado_invalido';
  end if;
  if new.comprobante_asociado_id = new.id then
    raise exception 'Un comprobante no se asocia a sí mismo.'
      using errcode = 'CP012', hint = 'comprobante_asociado_invalido';
  end if;

  select c.tipo, c.estado, c.proveedor_id, c.letra into v_f
  from public.comprobante_compra c
  where c.id = new.comprobante_asociado_id
  for share;
  if not found then
    -- Lo rechaza la clave foránea.
    return new;
  end if;

  if v_f.tipo <> 'factura' or v_f.estado <> 'confirmado' then
    raise exception 'La factura asociada tiene que ser una factura confirmada.'
      using errcode = 'CP012', hint = 'comprobante_asociado_invalido';
  end if;
  if v_f.proveedor_id <> new.proveedor_id or v_f.letra <> new.letra then
    raise exception 'La factura asociada tiene que ser del mismo proveedor y la misma letra.'
      using errcode = 'CP012', hint = 'comprobante_asociado_invalido';
  end if;
  return new;
end;
$$;

create trigger trg_comprobante_compra_asociado before insert or update on comprobante_compra
  for each row execute function public.fn_comprobante_compra_asociado();

revoke execute on function public.fn_comprobante_compra_asociado() from anon, authenticated, public;

-- ----- Guardar -----------------------------------------------------------

-- Igual que en 20261105000003, y además lee comprobante_asociado_id de
-- p_comprobante (vacío: nota suelta o factura).
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
  v_nuevo jsonb;
  v_codigo text;
  v_descripcion text;
  v_mp uuid;
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
    v_art := null;

    if v_item->>'proveedor_articulo_id' is not null then
      select * into v_art from public.proveedor_articulo a where a.id = (v_item->>'proveedor_articulo_id')::uuid;
      if not found then
        -- Lo rechaza la clave foránea del renglón.
        v_art.id := (v_item->>'proveedor_articulo_id')::uuid;
      end if;
    elsif jsonb_typeof(v_item->'articulo_nuevo') = 'object' then
      v_nuevo := v_item->'articulo_nuevo';
      v_codigo := nullif(btrim(v_nuevo->>'codigo'), '');
      v_descripcion := btrim(v_nuevo->>'descripcion');
      v_mp := (v_nuevo->>'materia_prima_id')::uuid;

      -- Con on conflict, dos cargas a la vez del mismo artículo no chocan.
      if v_codigo is not null then
        insert into public.proveedor_articulo (proveedor_id, codigo, descripcion, unidad, factor_conversion, materia_prima_id)
        values (v_proveedor, v_codigo, v_descripcion, nullif(btrim(v_nuevo->>'unidad'), ''),
                coalesce((v_nuevo->>'factor_conversion')::numeric, 1), v_mp)
        on conflict (proveedor_id, lower(btrim(codigo))) where codigo is not null do nothing;

        select * into v_art from public.proveedor_articulo a
        where a.proveedor_id = v_proveedor and a.codigo is not null and lower(btrim(a.codigo)) = lower(v_codigo);
      else
        insert into public.proveedor_articulo (proveedor_id, descripcion, unidad, factor_conversion, materia_prima_id)
        values (v_proveedor, v_descripcion, nullif(btrim(v_nuevo->>'unidad'), ''),
                coalesce((v_nuevo->>'factor_conversion')::numeric, 1), v_mp)
        on conflict (proveedor_id, lower(btrim(descripcion))) where codigo is null do nothing;

        select * into v_art from public.proveedor_articulo a
        where a.proveedor_id = v_proveedor and a.codigo is null and lower(btrim(a.descripcion)) = lower(v_descripcion);
      end if;

      if v_art.materia_prima_id is null and v_mp is not null then
        update public.proveedor_articulo set materia_prima_id = v_mp where id = v_art.id
        returning * into v_art;
      end if;
    end if;

    insert into public.comprobante_compra_item (
      comprobante_compra_id, orden, proveedor_articulo_id, codigo_proveedor, descripcion, unidad,
      cantidad, precio_unitario, descuento_pct, alicuota_iva, exento
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
      coalesce((v_item->>'exento')::boolean, false)
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
  'Crea o actualiza un comprobante de compra en borrador (con su factura asociada, si es una nota) y reemplaza sus renglones y percepciones; da de alta en el catálogo los artículos nuevos. Devuelve el id';

-- ----- Precios: sólo facturas ---------------------------------------------

-- Igual que en 20261105000005, pero sin filas para una nota.
create or replace function public.precios_comprobante_compra(p_id uuid)
returns table (
  comprobante_compra_item_id uuid,
  orden                      integer,
  descripcion                text,
  materia_prima_id           uuid,
  materia_prima_codigo       text,
  materia_prima_nombre       text,
  unidad_compra              text,
  precio_factura             numeric(18,4),
  precio_vigente             numeric(18,4),
  incluye_iva                boolean,
  cambio                     boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id,
    r.orden,
    r.descripcion,
    r.materia_prima_id,
    r.codigo,
    r.nombre,
    r.unidad_compra,
    r.precio_factura,
    v.precio,
    v.incluye_iva,
    v.precio is null or v.precio <> r.precio_factura
  from (
    select
      i.id,
      i.orden,
      i.descripcion,
      mp.id as materia_prima_id,
      mp.codigo,
      mp.nombre,
      u.codigo as unidad_compra,
      round(i.precio_unitario * (1 - i.descuento_pct / 100) / a.factor_conversion, 4)::numeric(18,4) as precio_factura,
      c.proveedor_id,
      c.fecha
    from public.comprobante_compra c
    join public.comprobante_compra_item i on i.comprobante_compra_id = c.id
    join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
    join public.materia_prima mp on mp.id = a.materia_prima_id
    join public.unidad_medida u on u.id = mp.unidad_compra_id
    where c.id = p_id
      and c.tipo = 'factura'
  ) r
  left join lateral (
    select p.precio, p.incluye_iva
    from public.precio_materia_prima p
    where p.materia_prima_id = r.materia_prima_id
      and p.proveedor_id = r.proveedor_id
      and p.vigente_desde <= r.fecha
    order by p.vigente_desde desc, p.creado_en desc
    limit 1
  ) v on true
  order by r.orden, r.id;
$$;

comment on function public.precios_comprobante_compra(uuid) is
  'Por renglón con materia prima de una factura: precio de la factura por unidad de compra (sin IVA en A y M), precio vigente del proveedor a la fecha del comprobante y si cambió. Una nota no devuelve filas';

-- ----- Confirmar ---------------------------------------------------------

-- Igual que en 20261105000005; una nota con renglones elegidos para
-- actualizar precios se rechaza (CP013). La factura asociada la vuelve a
-- controlar el trigger al pasar a confirmado.
create or replace function public.confirmar_comprobante_compra(
  p_id uuid,
  p_actualizar_precios uuid[] default '{}'
)
returns public.comprobante_compra
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.comprobante_compra;
  v_descripcion text;
  v_observaciones text;
  v_precio record;
  v_preferido boolean;
begin
  select * into v_c
  from public.comprobante_compra c
  where c.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el comprobante de compra.'
      using errcode = 'CP004', hint = 'comprobante_inexistente';
  end if;
  if v_c.estado <> 'borrador' then
    raise exception 'Sólo se confirma un comprobante en borrador (el comprobante está %).', v_c.estado
      using errcode = 'CP002', hint = 'transicion_invalida';
  end if;
  -- Las notas no cambian precios de costeo: sólo las facturas.
  if v_c.tipo <> 'factura' and cardinality(coalesce(p_actualizar_precios, '{}')) > 0 then
    raise exception 'Las notas de crédito y débito no actualizan precios de materias primas.'
      using errcode = 'CP013', hint = 'nota_sin_precios';
  end if;
  if not exists (select 1 from public.comprobante_compra_item i where i.comprobante_compra_id = v_c.id) then
    raise exception 'El comprobante no tiene renglones.'
      using errcode = 'CP005', hint = 'comprobante_sin_items';
  end if;

  select i.descripcion into v_descripcion
  from public.comprobante_compra_item i
  join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
  where i.comprobante_compra_id = v_c.id and a.materia_prima_id is null
  order by i.orden
  limit 1;
  if found then
    raise exception 'El artículo "%" no tiene materia prima asociada.', v_descripcion
      using errcode = 'CP007', hint = 'articulo_sin_materia_prima';
  end if;

  -- El trigger del renglón copia la materia prima vigente del artículo.
  update public.comprobante_compra_item i
  set materia_prima_id = a.materia_prima_id
  from public.proveedor_articulo a
  where a.id = i.proveedor_articulo_id
    and i.comprobante_compra_id = v_c.id
    and i.materia_prima_id is distinct from a.materia_prima_id;

  select * into v_c from public.comprobante_compra c where c.id = p_id;
  if v_c.total <= 0 then
    raise exception 'El total del comprobante tiene que ser mayor que cero.'
      using errcode = 'CP006', hint = 'total_no_positivo';
  end if;

  -- El trigger sólo deja pasar a confirmado con esta marca de la transacción.
  perform set_config('compras.confirmando', v_c.id::text, true);
  update public.comprobante_compra
  set estado = 'confirmado',
      confirmado_en = now()
  where id = v_c.id
  returning * into v_c;
  perform set_config('compras.confirmando', '', true);

  -- ----- Precios elegidos ------------------------------------------------
  p_actualizar_precios := coalesce(p_actualizar_precios, '{}');

  if exists (
    select 1
    from unnest(p_actualizar_precios) as e(item_id)
    where not exists (
      select 1 from public.precios_comprobante_compra(v_c.id) p
      where p.comprobante_compra_item_id = e.item_id
    )
  ) then
    raise exception 'Sólo se actualiza el precio de un renglón del comprobante con materia prima.'
      using errcode = 'CP010', hint = 'renglon_sin_precio';
  end if;

  select p.materia_prima_nombre into v_descripcion
  from public.precios_comprobante_compra(v_c.id) p
  where p.comprobante_compra_item_id = any (p_actualizar_precios)
  group by p.materia_prima_id, p.materia_prima_nombre
  having count(*) > 1
  limit 1;
  if found then
    raise exception 'Elegiste dos renglones de "%": el precio se actualiza con uno solo.', v_descripcion
      using errcode = 'CP011', hint = 'materia_prima_repetida';
  end if;

  v_observaciones := 'Compra '
    || case v_c.tipo when 'factura' then 'FC' when 'nota_credito' then 'NC' else 'ND' end
    || ' ' || v_c.letra || ' '
    || lpad(v_c.punto_venta::text, 5, '0') || '-' || lpad(v_c.numero::text, 8, '0');

  for v_precio in
    select p.materia_prima_id, p.precio_factura
    from public.precios_comprobante_compra(v_c.id) p
    where p.comprobante_compra_item_id = any (p_actualizar_precios)
  loop
    -- Preferido: si era de este proveedor o no había, pasa al precio nuevo.
    v_preferido := not exists (
      select 1 from public.precio_materia_prima pr
      where pr.materia_prima_id = v_precio.materia_prima_id
        and pr.es_preferido
        and pr.proveedor_id is distinct from v_c.proveedor_id
    );
    if v_preferido then
      update public.precio_materia_prima
      set es_preferido = false
      where materia_prima_id = v_precio.materia_prima_id
        and es_preferido;
    end if;

    insert into public.precio_materia_prima
      (materia_prima_id, proveedor_id, precio, incluye_iva, vigente_desde, es_preferido, observaciones)
    values
      (v_precio.materia_prima_id, v_c.proveedor_id, v_precio.precio_factura, false, v_c.fecha, v_preferido, v_observaciones);
  end loop;

  return v_c;
end;
$$;

comment on function public.confirmar_comprobante_compra(uuid, uuid[]) is
  'Confirma un comprobante de compra en borrador (con renglones, total mayor que cero y artículos con materia prima) y, si es una factura, carga el precio de los renglones elegidos. Devuelve el comprobante';

-- ----- Anular ------------------------------------------------------------

-- Igual que en 20261105000003; una factura con notas confirmadas no se
-- anula (CP014). El for update de la factura espera a una nota que se
-- esté confirmando (su trigger bloquea la factura con for share).
create or replace function public.anular_comprobante_compra(p_id uuid)
returns public.comprobante_compra
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.comprobante_compra;
begin
  select * into v_c
  from public.comprobante_compra c
  where c.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el comprobante de compra.'
      using errcode = 'CP004', hint = 'comprobante_inexistente';
  end if;
  if v_c.estado <> 'confirmado' then
    raise exception 'Sólo se anula un comprobante confirmado (el comprobante está %).', v_c.estado
      using errcode = 'CP002', hint = 'transicion_invalida';
  end if;
  if exists (
    select 1 from public.comprobante_compra n
    where n.comprobante_asociado_id = v_c.id and n.estado = 'confirmado'
  ) then
    raise exception 'La factura tiene notas de crédito o débito confirmadas: primero se anulan las notas.'
      using errcode = 'CP014', hint = 'factura_con_notas';
  end if;

  -- El trigger sólo deja pasar a anulado con esta marca de la transacción.
  perform set_config('compras.anulando', v_c.id::text, true);
  update public.comprobante_compra
  set estado = 'anulado',
      anulado_en = now()
  where id = v_c.id
  returning * into v_c;
  perform set_config('compras.anulando', '', true);

  return v_c;
end;
$$;

comment on function public.anular_comprobante_compra(uuid) is
  'Anula un comprobante de compra confirmado (conserva los datos y libera el número). Una factura con notas confirmadas no se anula. Devuelve el comprobante';

-- create or replace conserva los permisos; se repiten por claridad.
revoke execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.precios_comprobante_compra(uuid) from public, anon;
revoke execute on function public.confirmar_comprobante_compra(uuid, uuid[]) from public, anon;
revoke execute on function public.anular_comprobante_compra(uuid) from public, anon;
grant execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.precios_comprobante_compra(uuid) to authenticated;
grant execute on function public.confirmar_comprobante_compra(uuid, uuid[]) to authenticated;
grant execute on function public.anular_comprobante_compra(uuid) to authenticated;

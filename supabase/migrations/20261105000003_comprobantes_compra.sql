-- =====================================================================
-- Charoli Gestión - Comprobantes de compra
-- Facturas, notas de crédito y notas de débito que emiten los proveedores
-- (letras A, B, C o M), con sus renglones y percepciones. Se cargan a mano
-- (más adelante, con el importador). El ciclo de vida es:
--
--   borrador   -> confirmado  (sólo con confirmar_comprobante_compra)
--   confirmado -> anulado     (sólo con anular_comprobante_compra)
--
--   - borrador: se edita y se borra, renglones y percepciones incluidos;
--   - confirmado: no se modifica ni se borra, ni sus renglones ni sus
--     percepciones. Se anula;
--   - anulado: no se modifica ni se borra; conserva todos sus datos.
--
-- Lo controlan triggers, así que vale también para SQL directo.
--
-- Número del proveedor: punto de venta y número. El mismo comprobante
-- (proveedor, tipo, letra, punto de venta y número) no se carga dos veces
-- entre los no anulados (índice único, también para los borradores); uno
-- anulado deja libre el número para cargarlo bien.
--
-- Renglones: guardan el código y la descripción tal como los escribió el
-- proveedor y apuntan a un artículo de su catálogo (proveedor_articulo),
-- que lleva a la materia prima. Sin artículo es un renglón libre (flete,
-- servicio) y no tiene materia prima. La materia prima del renglón sale
-- siempre del artículo: la ponen los triggers. Un artículo sin materia
-- prima se acepta en un borrador pero no deja confirmar.
--
-- Importes (los calcula la base, nunca se toman de la app):
--   - importe del renglón = round(cantidad × precio × (1 − descuento/100), 2);
--   - letras A y M discriminan IVA: IVA del renglón = round(importe ×
--     alícuota/100, 2) si tiene alícuota y no es exento. neto_gravado suma
--     los renglones con alícuota, exento los exentos, no_gravado los que no
--     tienen alícuota ni son exentos;
--   - letras B y C no discriminan IVA (el precio lo incluye): los renglones
--     no llevan alícuota y todo va a no_gravado, salvo lo exento;
--   - percepcion_iva, percepcion_iibb y otros_impuestos suman las
--     percepciones de cada tipo;
--   - total = neto_gravado + no_gravado + exento + iva + percepciones.
-- Los totales de la cabecera los mantienen los triggers: cualquier valor
-- escrito a mano se reemplaza por el calculado.
--
-- Errores de los triggers y RPC (SQLSTATE propio, estable para que la app
-- los traduzca; el HINT repite el motivo en forma de clave):
--   CP001 comprobante_inmutable        (confirmado o anulado: cabecera,
--                                       renglones o percepciones)
--   CP002 transicion_invalida
--   CP003 borrado_no_permitido
--   CP004 comprobante_inexistente
--   CP005 comprobante_sin_items        (al confirmar)
--   CP006 total_no_positivo            (al confirmar)
--   CP007 articulo_sin_materia_prima   (al confirmar)
--   CP008 articulo_de_otro_proveedor
--   CP009 alicuota_no_discriminada     (letras B y C)
-- =====================================================================

-- ----- Comprobante de compra ---------------------------------------------

create table comprobante_compra (
  id                 uuid primary key default gen_random_uuid(),
  proveedor_id       uuid not null references proveedor(id) on delete restrict,
  tipo               text not null,
  letra              text not null,
  punto_venta        integer not null,
  numero             bigint not null,
  fecha              date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  fecha_vencimiento  date,
  observaciones      text,
  neto_gravado       numeric(14,2) not null default 0,
  no_gravado         numeric(14,2) not null default 0,
  exento             numeric(14,2) not null default 0,
  iva                numeric(14,2) not null default 0,
  percepcion_iva     numeric(14,2) not null default 0,
  percepcion_iibb    numeric(14,2) not null default 0,
  otros_impuestos    numeric(14,2) not null default 0,
  total              numeric(14,2) not null default 0,
  estado             text not null default 'borrador',
  confirmado_en      timestamptz,
  anulado_en         timestamptz,
  creado_por         uuid default auth.uid(),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint comprobante_compra_tipo_check check (tipo in ('factura', 'nota_credito', 'nota_debito')),
  constraint comprobante_compra_letra_check check (letra in ('A', 'B', 'C', 'M')),
  constraint comprobante_compra_punto_venta_check check (punto_venta between 1 and 99999),
  constraint comprobante_compra_numero_check check (numero > 0),
  constraint comprobante_compra_vencimiento_check check (fecha_vencimiento >= fecha),
  constraint comprobante_compra_estado_check check (estado in ('borrador', 'confirmado', 'anulado')),
  constraint comprobante_compra_confirmado_en_check check ((confirmado_en is not null) = (estado in ('confirmado', 'anulado'))),
  constraint comprobante_compra_anulado_en_check check ((anulado_en is not null) = (estado = 'anulado'))
);

comment on table comprobante_compra is
  'Comprobantes de compra (facturas, notas de crédito y de débito de los proveedores). Un confirmado no se borra: se anula';
comment on column comprobante_compra.tipo is 'factura | nota_credito | nota_debito';
comment on column comprobante_compra.letra is 'A, B, C o M. A y M discriminan IVA; B y C no';
comment on column comprobante_compra.punto_venta is 'Punto de venta del proveedor (1 a 99999)';
comment on column comprobante_compra.numero is 'Número del comprobante del proveedor';
comment on column comprobante_compra.fecha is 'Fecha de emisión del comprobante';
comment on column comprobante_compra.fecha_vencimiento is 'Vencimiento del pago (opcional, no anterior a la emisión)';
comment on column comprobante_compra.neto_gravado is 'Suma de los importes de los renglones con alícuota (letras A y M)';
comment on column comprobante_compra.no_gravado is 'Suma de los renglones sin alícuota ni exentos; en B y C, todo lo no exento';
comment on column comprobante_compra.exento is 'Suma de los renglones exentos';
comment on column comprobante_compra.iva is 'Suma del IVA de los renglones (letras A y M); 0 en B y C';
comment on column comprobante_compra.percepcion_iva is 'Suma de las percepciones de IVA';
comment on column comprobante_compra.percepcion_iibb is 'Suma de las percepciones de ingresos brutos';
comment on column comprobante_compra.otros_impuestos is 'Suma de las percepciones de otros impuestos';
comment on column comprobante_compra.total is 'neto_gravado + no_gravado + exento + iva + percepciones. Lo calcula la base';
comment on column comprobante_compra.estado is 'borrador | confirmado | anulado (conserva los datos)';
comment on column comprobante_compra.confirmado_en is 'Momento en que se confirmó';
comment on column comprobante_compra.anulado_en is 'Momento en que se anuló';
comment on column comprobante_compra.creado_por is 'Usuario que lo cargó (auth.uid()). Sin FK: los usuarios se manejan desde Auth';

create unique index comprobante_compra_numero_unico
  on comprobante_compra (proveedor_id, tipo, letra, punto_venta, numero)
  where estado <> 'anulado';
create index comprobante_compra_fecha_idx on comprobante_compra (fecha desc);
create index comprobante_compra_estado_idx on comprobante_compra (estado);

-- ----- Renglones ---------------------------------------------------------

create table comprobante_compra_item (
  id                     uuid primary key default gen_random_uuid(),
  comprobante_compra_id  uuid not null references comprobante_compra(id) on delete cascade,
  orden                  integer not null default 0,
  proveedor_articulo_id  uuid references proveedor_articulo(id) on delete restrict,
  materia_prima_id       uuid references materia_prima(id) on delete restrict,
  codigo_proveedor       text,
  descripcion            text not null,
  unidad                 text,
  cantidad               numeric(14,4) not null,
  precio_unitario        numeric(18,4) not null default 0,
  descuento_pct          numeric(5,2) not null default 0,
  alicuota_iva           numeric(5,2),
  exento                 boolean not null default false,
  importe                numeric(14,2) not null default 0,
  iva                    numeric(14,2) not null default 0,
  constraint comprobante_compra_item_descripcion_check check (btrim(descripcion) <> ''),
  constraint comprobante_compra_item_cantidad_check check (cantidad > 0),
  constraint comprobante_compra_item_precio_check check (precio_unitario >= 0),
  constraint comprobante_compra_item_descuento_check check (descuento_pct between 0 and 100),
  constraint comprobante_compra_item_alicuota_check check (alicuota_iva in (0, 2.5, 5, 10.5, 21, 27)),
  constraint comprobante_compra_item_exento_check check (not (exento and alicuota_iva is not null)),
  constraint comprobante_compra_item_materia_prima_check check (materia_prima_id is null or proveedor_articulo_id is not null)
);

comment on table comprobante_compra_item is
  'Renglones de un comprobante de compra: un artículo del proveedor o un renglón libre (flete, servicio)';
comment on column comprobante_compra_item.proveedor_articulo_id is 'Artículo del catálogo del proveedor. Vacío en un renglón libre';
comment on column comprobante_compra_item.materia_prima_id is
  'Materia prima del artículo. La copian los triggers desde el artículo; vacía en un renglón libre';
comment on column comprobante_compra_item.codigo_proveedor is 'Código tal como lo escribió el proveedor';
comment on column comprobante_compra_item.descripcion is 'Descripción tal como la escribió el proveedor';
comment on column comprobante_compra_item.precio_unitario is 'Precio unitario del comprobante (sin IVA en A y M; con IVA en B y C)';
comment on column comprobante_compra_item.descuento_pct is 'Descuento del renglón en %';
comment on column comprobante_compra_item.alicuota_iva is 'Alícuota de IVA en %: 0, 2.5, 5, 10.5, 21 o 27. Vacía: no gravado (y siempre en B y C)';
comment on column comprobante_compra_item.exento is 'Renglón exento de IVA (sin alícuota)';
comment on column comprobante_compra_item.importe is 'cantidad × precio × (1 − descuento), a 2 decimales. Lo calcula la base';
comment on column comprobante_compra_item.iva is 'IVA del renglón, a 2 decimales (letras A y M). Lo calcula la base';

create index comprobante_compra_item_comprobante_idx on comprobante_compra_item (comprobante_compra_id, orden);
create index comprobante_compra_item_articulo_idx on comprobante_compra_item (proveedor_articulo_id);
create index comprobante_compra_item_materia_prima_idx on comprobante_compra_item (materia_prima_id);

-- ----- Percepciones ------------------------------------------------------

create table comprobante_compra_percepcion (
  id                     uuid primary key default gen_random_uuid(),
  comprobante_compra_id  uuid not null references comprobante_compra(id) on delete cascade,
  tipo                   text not null,
  jurisdiccion           text,
  descripcion            text,
  importe                numeric(14,2) not null,
  constraint comprobante_compra_percepcion_tipo_check check (tipo in ('iva', 'iibb', 'otro')),
  constraint comprobante_compra_percepcion_jurisdiccion_check check (
    tipo <> 'iibb' or coalesce(btrim(jurisdiccion), '') <> ''
  ),
  constraint comprobante_compra_percepcion_importe_check check (importe > 0)
);

comment on table comprobante_compra_percepcion is 'Percepciones de un comprobante de compra (IVA, ingresos brutos y otros impuestos)';
comment on column comprobante_compra_percepcion.tipo is 'iva | iibb | otro';
comment on column comprobante_compra_percepcion.jurisdiccion is 'Provincia de la percepción de ingresos brutos (obligatoria en iibb)';
comment on column comprobante_compra_percepcion.descripcion is 'Detalle libre (ej. qué impuesto en otro)';

create index comprobante_compra_percepcion_comprobante_idx on comprobante_compra_percepcion (comprobante_compra_id);

-- ----- Totales -----------------------------------------------------------

-- Totales de un comprobante a partir de sus renglones y percepciones, según
-- la letra (ver el encabezado). La usa el trigger de la cabecera.
create or replace function public.fn_comprobante_compra_totales(p_id uuid, p_letra text)
returns table (
  neto_gravado numeric, no_gravado numeric, exento numeric, iva numeric,
  percepcion_iva numeric, percepcion_iibb numeric, otros_impuestos numeric, total numeric
)
language sql
stable
set search_path = ''
as $$
  with renglones as (
    select
      coalesce(sum(i.importe) filter (where p_letra in ('A', 'M') and i.alicuota_iva is not null and not i.exento), 0) as neto_gravado,
      coalesce(sum(i.importe) filter (where not i.exento and (p_letra not in ('A', 'M') or i.alicuota_iva is null)), 0) as no_gravado,
      coalesce(sum(i.importe) filter (where i.exento), 0) as exento,
      case when p_letra in ('A', 'M') then coalesce(sum(i.iva), 0) else 0 end as iva
    from public.comprobante_compra_item i
    where i.comprobante_compra_id = p_id
  ),
  percepciones as (
    select
      coalesce(sum(p.importe) filter (where p.tipo = 'iva'), 0) as percepcion_iva,
      coalesce(sum(p.importe) filter (where p.tipo = 'iibb'), 0) as percepcion_iibb,
      coalesce(sum(p.importe) filter (where p.tipo = 'otro'), 0) as otros_impuestos
    from public.comprobante_compra_percepcion p
    where p.comprobante_compra_id = p_id
  )
  select r.neto_gravado, r.no_gravado, r.exento, r.iva,
         p.percepcion_iva, p.percepcion_iibb, p.otros_impuestos,
         r.neto_gravado + r.no_gravado + r.exento + r.iva + p.percepcion_iva + p.percepcion_iibb + p.otros_impuestos
  from renglones r, percepciones p;
$$;

comment on function public.fn_comprobante_compra_totales(uuid, text) is
  'Totales de un comprobante de compra (neto gravado, no gravado, exento, IVA, percepciones y total) según la letra';

-- ----- Estado e inmutabilidad de la cabecera ------------------------------

-- Valida el alta y cada cambio:
--   - el alta es siempre borrador, sin fechas de confirmación ni anulación,
--     con los totales en cero (todavía no tiene renglones);
--   - en un borrador los totales se recalculan siempre; no se pasa a letra
--     B o C con renglones con alícuota (CP009) ni a otro proveedor con
--     renglones de artículos del anterior (CP008);
--   - borrador -> confirmado sólo desde confirmar_comprobante_compra
--     (marca la transacción con compras.confirmando = id);
--   - confirmado -> anulado sólo desde anular_comprobante_compra
--     (compras.anulando = id), sin cambiar nada más;
--   - un confirmado o un anulado no cambia.
create or replace function public.fn_comprobante_compra_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignorar text[] := array['estado', 'anulado_en', 'actualizado_en'];
  v_t record;
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' or new.confirmado_en is not null or new.anulado_en is not null then
      raise exception 'Un comprobante de compra se crea en borrador: se confirma con confirmar_comprobante_compra.'
        using errcode = 'CP002', hint = 'transicion_invalida';
    end if;
    new.neto_gravado := 0;
    new.no_gravado := 0;
    new.exento := 0;
    new.iva := 0;
    new.percepcion_iva := 0;
    new.percepcion_iibb := 0;
    new.otros_impuestos := 0;
    new.total := 0;
    return new;
  end if;

  if old.estado = 'anulado' then
    if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
      raise exception 'El comprobante está anulado: no se puede modificar.'
        using errcode = 'CP001', hint = 'comprobante_inmutable';
    end if;
    return new;
  end if;

  if old.estado = 'confirmado' then
    if new.estado = 'anulado' then
      if coalesce(current_setting('compras.anulando', true), '') <> new.id::text
        or (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar)
      then
        raise exception 'Un comprobante de compra se anula sólo con anular_comprobante_compra.'
          using errcode = 'CP002', hint = 'transicion_invalida';
      end if;
      new.anulado_en := coalesce(new.anulado_en, now());
      return new;
    end if;

    if new.estado <> 'confirmado' then
      raise exception 'Un comprobante confirmado sólo puede pasar a anulado.'
        using errcode = 'CP002', hint = 'transicion_invalida';
    end if;

    if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
      raise exception 'El comprobante está confirmado: no se puede modificar (se anula).'
        using errcode = 'CP001', hint = 'comprobante_inmutable';
    end if;
    return new;
  end if;

  -- old.estado = 'borrador'
  if new.estado = 'confirmado' then
    if coalesce(current_setting('compras.confirmando', true), '') <> new.id::text then
      raise exception 'Un comprobante de compra se confirma sólo con confirmar_comprobante_compra.'
        using errcode = 'CP002', hint = 'transicion_invalida';
    end if;
    -- Las reglas de la confirmación se repiten acá: la marca de la
    -- transacción se puede poner a mano, así que no alcanza como control.
    -- El total recalculado, no el de la fila: más abajo se pisa con éste.
    if (select t.total from public.fn_comprobante_compra_totales(new.id, new.letra) t) <= 0 then
      raise exception 'El total del comprobante tiene que ser mayor que cero.'
        using errcode = 'CP006', hint = 'total_no_positivo';
    end if;
    if exists (
      select 1
      from public.comprobante_compra_item i
      join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
      where i.comprobante_compra_id = new.id
        and (a.materia_prima_id is null or i.materia_prima_id is distinct from a.materia_prima_id)
    ) then
      raise exception 'Hay renglones con un artículo sin materia prima asociada.'
        using errcode = 'CP007', hint = 'articulo_sin_materia_prima';
    end if;
    new.confirmado_en := coalesce(new.confirmado_en, now());
  elsif new.estado <> 'borrador' then
    raise exception 'Un comprobante en borrador sólo puede pasar a confirmado (o borrarse).'
      using errcode = 'CP002', hint = 'transicion_invalida';
  end if;

  if new.letra in ('B', 'C') and new.letra is distinct from old.letra and exists (
    select 1 from public.comprobante_compra_item i
    where i.comprobante_compra_id = new.id and i.alicuota_iva is not null
  ) then
    raise exception 'En un comprobante % los renglones no discriminan IVA: no llevan alícuota.', new.letra
      using errcode = 'CP009', hint = 'alicuota_no_discriminada';
  end if;

  if new.proveedor_id is distinct from old.proveedor_id and exists (
    select 1
    from public.comprobante_compra_item i
    join public.proveedor_articulo a on a.id = i.proveedor_articulo_id
    where i.comprobante_compra_id = new.id and a.proveedor_id <> new.proveedor_id
  ) then
    raise exception 'El comprobante tiene artículos de otro proveedor.'
      using errcode = 'CP008', hint = 'articulo_de_otro_proveedor';
  end if;

  select * into v_t from public.fn_comprobante_compra_totales(new.id, new.letra);
  new.neto_gravado := v_t.neto_gravado;
  new.no_gravado := v_t.no_gravado;
  new.exento := v_t.exento;
  new.iva := v_t.iva;
  new.percepcion_iva := v_t.percepcion_iva;
  new.percepcion_iibb := v_t.percepcion_iibb;
  new.otros_impuestos := v_t.otros_impuestos;
  new.total := v_t.total;
  return new;
end;
$$;

create or replace function public.fn_comprobante_compra_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'El comprobante está %: no se puede borrar (un confirmado se anula).', old.estado
      using errcode = 'CP003', hint = 'borrado_no_permitido';
  end if;
  return old;
end;
$$;

create trigger trg_comprobante_compra_actualizado before update on comprobante_compra
  for each row execute function fn_set_actualizado_en();

create trigger trg_comprobante_compra_validar before insert or update on comprobante_compra
  for each row execute function public.fn_comprobante_compra_validar();

create trigger trg_comprobante_compra_borrar before delete on comprobante_compra
  for each row execute function public.fn_comprobante_compra_borrar();

-- ----- Renglones y percepciones ------------------------------------------

-- Renglones y percepciones cambian sólo mientras el comprobante está en
-- borrador. Si el comprobante ya no existe (borrado en cascada) no hay nada
-- que proteger. Sirve para las dos tablas: ambas tienen comprobante_compra_id.
create or replace function public.fn_comprobante_compra_hijo_bloqueo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.comprobante_compra_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.comprobante_compra_id, new.comprobante_compra_id];
  else
    v_ids := array[old.comprobante_compra_id];
  end if;

  if exists (
    select 1 from public.comprobante_compra c where c.id = any (v_ids) and c.estado <> 'borrador'
  ) then
    raise exception 'El comprobante está confirmado o anulado: sus renglones y percepciones no se pueden cambiar.'
      using errcode = 'CP001', hint = 'comprobante_inmutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Calcula importe e IVA del renglón y copia la materia prima del artículo.
-- El artículo tiene que ser del proveedor del comprobante (CP008); en las
-- letras B y C el renglón no lleva alícuota (CP009). Un artículo
-- inexistente lo rechaza la clave foránea.
create or replace function public.fn_comprobante_compra_item_calcular()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_c record;
  v_a record;
begin
  select c.proveedor_id, c.letra into v_c
  from public.comprobante_compra c
  where c.id = new.comprobante_compra_id;

  new.materia_prima_id := null;
  if new.proveedor_articulo_id is not null then
    select a.proveedor_id, a.materia_prima_id into v_a
    from public.proveedor_articulo a
    where a.id = new.proveedor_articulo_id;
    if found then
      if v_c.proveedor_id is not null and v_a.proveedor_id <> v_c.proveedor_id then
        raise exception 'El artículo es de otro proveedor.'
          using errcode = 'CP008', hint = 'articulo_de_otro_proveedor';
      end if;
      new.materia_prima_id := v_a.materia_prima_id;
    end if;
  end if;

  if v_c.letra in ('B', 'C') and new.alicuota_iva is not null then
    raise exception 'En un comprobante % los renglones no discriminan IVA: no llevan alícuota.', v_c.letra
      using errcode = 'CP009', hint = 'alicuota_no_discriminada';
  end if;

  new.importe := round(new.cantidad * new.precio_unitario * (1 - new.descuento_pct / 100), 2);
  new.iva := case
    when v_c.letra in ('A', 'M') and new.alicuota_iva is not null and not new.exento
      then round(new.importe * new.alicuota_iva / 100, 2)
    else 0
  end;
  return new;
end;
$$;

-- Después de cada cambio de renglones o percepciones, la cabecera recalcula
-- sus totales (el trigger de validación los toma de fn_comprobante_compra_totales).
create or replace function public.fn_comprobante_compra_hijo_totales()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.comprobante_compra_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.comprobante_compra_id, new.comprobante_compra_id];
  else
    v_ids := array[old.comprobante_compra_id];
  end if;

  update public.comprobante_compra c
  set actualizado_en = now()
  where c.id = any (v_ids)
    and c.estado = 'borrador';

  return null;
end;
$$;

create trigger trg_comprobante_compra_item_bloqueo before insert or update or delete on comprobante_compra_item
  for each row execute function public.fn_comprobante_compra_hijo_bloqueo();

create trigger trg_comprobante_compra_item_calcular before insert or update on comprobante_compra_item
  for each row execute function public.fn_comprobante_compra_item_calcular();

create trigger trg_comprobante_compra_item_totales after insert or update or delete on comprobante_compra_item
  for each row execute function public.fn_comprobante_compra_hijo_totales();

create trigger trg_comprobante_compra_percepcion_bloqueo before insert or update or delete on comprobante_compra_percepcion
  for each row execute function public.fn_comprobante_compra_hijo_bloqueo();

create trigger trg_comprobante_compra_percepcion_totales after insert or update or delete on comprobante_compra_percepcion
  for each row execute function public.fn_comprobante_compra_hijo_totales();

-- Un confirmado o anulado siempre tiene al menos un renglón. Trigger de
-- restricción diferido (como trg_remito_con_items): vale para cualquier
-- camino y no molesta al borrar y reinsertar en la misma transacción.
create or replace function public.fn_comprobante_compra_con_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.comprobante_compra c
    where c.id = old.comprobante_compra_id
      and c.estado in ('confirmado', 'anulado')
      and not exists (select 1 from public.comprobante_compra_item i where i.comprobante_compra_id = c.id)
  ) then
    raise exception 'Un comprobante confirmado tiene que tener al menos un renglón.'
      using errcode = 'CP005', hint = 'comprobante_sin_items';
  end if;
  return null;
end;
$$;

create constraint trigger trg_comprobante_compra_con_items
  after delete or update of comprobante_compra_id on comprobante_compra_item
  deferrable initially deferred
  for each row
  execute function public.fn_comprobante_compra_con_items();

revoke execute on function public.fn_comprobante_compra_validar() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_borrar() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_hijo_bloqueo() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_item_calcular() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_hijo_totales() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_compra_con_items() from anon, authenticated, public;
-- La llama el trigger de la cabecera con el rol de quien escribe: sólo lee.
revoke execute on function public.fn_comprobante_compra_totales(uuid, text) from public, anon;
grant execute on function public.fn_comprobante_compra_totales(uuid, text) to authenticated;

-- ----- Guardar -----------------------------------------------------------

-- p_comprobante: { proveedor_id, tipo, letra, punto_venta, numero, fecha,
--                  fecha_vencimiento, observaciones }
--   (fecha vacía: hoy en Argentina). Los totales que mande la app se ignoran.
-- p_items: [{ proveedor_articulo_id | articulo_nuevo, codigo_proveedor,
--             descripcion, unidad, cantidad, precio_unitario, descuento_pct,
--             alicuota_iva, exento }]
--   articulo_nuevo: { codigo, descripcion, unidad, factor_conversion,
--                     materia_prima_id }. Se busca en el catálogo del
--   proveedor por código (sin mayúsculas ni espacios en los bordes) o, sin
--   código, por descripción; si no está, se crea. Si estaba sin materia
--   prima y viene una, se la asocia. Sin artículo es un renglón libre.
--   Código, descripción y unidad del renglón: los que vengan, o los del
--   artículo. La materia prima sale siempre del artículo.
-- p_percepciones: [{ tipo, jurisdiccion, descripcion, importe }]
-- Crea un borrador (p_id vacío) o actualiza un borrador, y reemplaza sus
-- renglones y percepciones, en una sola transacción. No confirma.
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
        observaciones = p_comprobante->>'observaciones'
    where id = v_id;
  else
    insert into public.comprobante_compra (
      proveedor_id, tipo, letra, punto_venta, numero, fecha, fecha_vencimiento, observaciones
    )
    values (
      v_proveedor,
      p_comprobante->>'tipo',
      p_comprobante->>'letra',
      (p_comprobante->>'punto_venta')::integer,
      (p_comprobante->>'numero')::bigint,
      v_fecha,
      (p_comprobante->>'fecha_vencimiento')::date,
      p_comprobante->>'observaciones'
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
  'Crea o actualiza un comprobante de compra en borrador y reemplaza sus renglones y percepciones; da de alta en el catálogo los artículos nuevos. Devuelve el id';

-- ----- Confirmar ---------------------------------------------------------

-- Confirma un borrador: tiene que tener renglones, total mayor que cero y
-- todos sus artículos con materia prima. Antes, los renglones toman la
-- materia prima vigente de su artículo (se pudo asociar en el catálogo
-- después de guardar). El número repetido lo impide el índice único.
create or replace function public.confirmar_comprobante_compra(p_id uuid)
returns public.comprobante_compra
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.comprobante_compra;
  v_descripcion text;
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

  return v_c;
end;
$$;

comment on function public.confirmar_comprobante_compra(uuid) is
  'Confirma un comprobante de compra en borrador (con renglones, total mayor que cero y artículos con materia prima). Devuelve el comprobante';

-- ----- Anular ------------------------------------------------------------

-- Anula un comprobante confirmado; conserva sus datos y deja libre el
-- número para volver a cargarlo.
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
  'Anula un comprobante de compra confirmado (conserva los datos y libera el número). Devuelve el comprobante';

revoke execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.confirmar_comprobante_compra(uuid) from public, anon;
revoke execute on function public.anular_comprobante_compra(uuid) from public, anon;
grant execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.confirmar_comprobante_compra(uuid) to authenticated;
grant execute on function public.anular_comprobante_compra(uuid) to authenticated;

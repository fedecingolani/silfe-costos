-- =====================================================================
-- Silfe Costos - Puntos de venta fuera del emisor
-- 20261024000001_comprobantes.sql copió arca_emisor.punto_venta a la tabla
-- punto_venta y dejó la columna como obsoleta hasta mover la pantalla de
-- ARCA. La pantalla ya administra los puntos de venta: se borra la columna.
--
-- Antes de borrarla se copia otra vez (por si alguien la cambió desde la
-- pantalla vieja después de la migración anterior). Si no hay ningún punto
-- de venta, se crea el 7 electrónico, que es el que usa la empresa para la
-- factura electrónica (ver la spec de comprobantes de venta).
-- =====================================================================

insert into punto_venta (numero, nombre, electronico)
select punto_venta, 'Factura electrónica', true
from arca_emisor
where punto_venta is not null
on conflict (numero) do nothing;

insert into punto_venta (numero, nombre, electronico)
select 7, 'Factura electrónica', true
where not exists (select 1 from punto_venta);

alter table arca_emisor drop column punto_venta;

-- ----- Guardar un borrador en un solo paso --------------------------------

-- La pantalla de comprobantes guarda la cabecera y reemplaza todos los
-- ítems. Con dos pedidos separados, un error en los ítems dejaría la
-- cabecera nueva con los ítems viejos (o sin ítems): esta función hace
-- todo en una transacción.
--
--   p_id          null para crear; si no, el borrador o rechazado a guardar.
--   p_comprobante punto_venta, clase, letra, tipo_arca, fecha,
--                 fecha_vencimiento_pago, cliente_id, lista_precio_id,
--                 condicion_pago, observaciones, neto, iva, total.
--   p_items       [{producto_id, codigo, descripcion, observaciones, unidad,
--                 cantidad, precio_unitario, descuento_pct, alicuota_iva,
--                 importe, iva}], en orden.
--
-- El ambiente no lo elige la pantalla: al crear, en un punto de venta
-- electrónico, es el ambiente activo del emisor; al actualizar se conserva
-- (o se toma el activo si pasó a un punto de venta electrónico). Un
-- rechazado vuelve a borrador y pierde los mensajes de ARCA, que eran del
-- intento anterior. Errores: CM006 si no existe (P0002, el código estándar,
-- PostgREST lo devuelve como un 500 sin cuerpo), CM004 si ya no es un
-- borrador ni un rechazado, CM005 si el punto de venta no existe; el resto,
-- los de las restricciones y triggers de las tablas.
create or replace function public.guardar_borrador_comprobante(
  p_id uuid,
  p_comprobante jsonb,
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
  v_ambiente text;
  v_electronico boolean;
  v_punto_venta integer := (p_comprobante->>'punto_venta')::integer;
begin
  select pv.electronico into v_electronico
  from public.punto_venta pv
  where pv.numero = v_punto_venta;
  if v_electronico is null then
    raise exception 'El punto de venta % no existe.', v_punto_venta
      using errcode = 'CM005', hint = 'punto_venta_inconsistente';
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

  if not v_electronico then
    v_ambiente := null;
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
      p_comprobante->>'clase',
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
        clase = p_comprobante->>'clase',
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

  return v_id;
end;
$$;

comment on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb) is
  'Crea o actualiza un borrador (o corrige un rechazado) y reemplaza sus ítems en una sola transacción';

revoke execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_borrador_comprobante(uuid, jsonb, jsonb) to authenticated;

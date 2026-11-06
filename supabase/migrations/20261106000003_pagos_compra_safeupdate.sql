-- =====================================================================
-- Confirmar una orden de pago desde la app.
--
-- confirmar_orden_pago actualizaba el contador de una sola fila sin
-- WHERE. Las sesiones de PostgREST cargan pg-safeupdate, que rechaza
-- todo UPDATE sin WHERE ("UPDATE requires a WHERE clause"), así que la
-- confirmación fallaba siempre desde la app aunque pasara en pgTAP.
-- Se redefine la función (última versión: 20261106000001) filtrando la
-- fila del contador por su clave (`where id`, que siempre es true).
-- =====================================================================

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
  where n.id
  for update;

  update public.orden_pago_numeracion n set ultimo_numero = v_numero where n.id;
  update public.orden_pago set estado = 'confirmado', numero = v_numero where id = p_id;
  return v_numero;
end;
$$;

comment on function public.confirmar_orden_pago(uuid) is
  'Confirma una orden de pago en borrador: le asigna el número siguiente, entrega sus cheques de terceros y la deja inmutable. Devuelve el número';

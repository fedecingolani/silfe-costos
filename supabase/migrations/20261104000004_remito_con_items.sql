-- Un remito emitido o anulado siempre tiene al menos un ítem.
--
-- emitir_remito y fn_remito_validar lo exigen al emitir (RM005), pero
-- guardar_remito borra y vuelve a insertar los ítems de un emitido: con una
-- lista vacía quedaba un remito numerado sin renglones. El control es un
-- trigger de restricción diferido, así vale para cualquier camino (función o
-- SQL directo) y no molesta al borrar y reinsertar dentro de la misma
-- transacción.

create or replace function fn_remito_con_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.remito r
    where r.id = old.remito_id
      and r.estado in ('emitido', 'anulado')
      and not exists (select 1 from public.remito_item ri where ri.remito_id = r.id)
  ) then
    raise exception 'Un remito emitido tiene que tener al menos un ítem'
      using errcode = 'RM005', hint = 'remito_sin_items';
  end if;
  return null;
end;
$$;

comment on function fn_remito_con_items() is
  'Al cerrar la transacción, rechaza dejar sin ítems un remito emitido o anulado';

create constraint trigger trg_remito_con_items
  after delete on remito_item
  deferrable initially deferred
  for each row
  execute function fn_remito_con_items();

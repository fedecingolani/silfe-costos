-- =====================================================================
-- Silfe Costos - RLS de las listas de precios
-- A diferencia del resto del esquema, las listas son inmutables: los
-- usuarios autenticados sólo leen. Para crear una lista se usa
-- crear_lista_precio (security definer); nadie puede modificarla ni
-- borrarla desde la API.
-- =====================================================================

alter table public.lista_precio enable row level security;
alter table public.lista_precio_item enable row level security;

create policy "lista_precio_select_autenticado" on public.lista_precio
  for select to authenticated using (true);

create policy "lista_precio_item_select_autenticado" on public.lista_precio_item
  for select to authenticated using (true);

-- Sin políticas de insert, update ni delete. Además se quitan los
-- permisos que Supabase otorga por defecto a las tablas nuevas, para que
-- un intento de escritura falle con error en lugar de no afectar filas.
revoke all on public.lista_precio, public.lista_precio_item from anon, authenticated;
grant select on public.lista_precio, public.lista_precio_item to authenticated;

-- La vista de partida es de sólo lectura y hereda el RLS de sus tablas.
revoke all on public.v_lista_precio_base from anon;
revoke insert, update, delete on public.v_lista_precio_base from authenticated;
grant select on public.v_lista_precio_base to authenticated;

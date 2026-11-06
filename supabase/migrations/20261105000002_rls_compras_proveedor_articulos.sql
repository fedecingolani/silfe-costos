-- =====================================================================
-- Charoli Gestión - RLS del catálogo de artículos del proveedor
-- Mismo patrón que 20261104000002_rls_remitos.sql: acceso completo para
-- authenticated y nada para anon.
-- =====================================================================

alter table public.proveedor_articulo enable row level security;

create policy "proveedor_articulo_select_autenticado" on public.proveedor_articulo
  for select to authenticated using (true);

create policy "proveedor_articulo_insert_autenticado" on public.proveedor_articulo
  for insert to authenticated with check (true);

create policy "proveedor_articulo_update_autenticado" on public.proveedor_articulo
  for update to authenticated using (true) with check (true);

create policy "proveedor_articulo_delete_autenticado" on public.proveedor_articulo
  for delete to authenticated using (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.proveedor_articulo from anon;
grant select, insert, update, delete on public.proveedor_articulo to authenticated;

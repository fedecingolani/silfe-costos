-- =====================================================================
-- Silfe Costos - RLS de proveedor_contacto
-- Mismo patrón que 20260901000006_rls_clientes.sql.
-- =====================================================================

alter table public.proveedor_contacto enable row level security;

create policy "proveedor_contacto_select_autenticado" on public.proveedor_contacto
  for select to authenticated using (true);

create policy "proveedor_contacto_insert_autenticado" on public.proveedor_contacto
  for insert to authenticated with check (true);

create policy "proveedor_contacto_update_autenticado" on public.proveedor_contacto
  for update to authenticated using (true) with check (true);

create policy "proveedor_contacto_delete_autenticado" on public.proveedor_contacto
  for delete to authenticated using (true);

grant select, insert, update, delete on proveedor_contacto to authenticated;

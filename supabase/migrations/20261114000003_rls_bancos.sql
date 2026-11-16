-- =====================================================================
-- Charoli Gestión - RLS de los bancos
-- Mismo patrón que 20261112000004_rls_finanzas_transferencias.sql: acceso
-- completo para authenticated y nada para anon.
-- =====================================================================

alter table public.banco enable row level security;

create policy "banco_select_autenticado" on public.banco
  for select to authenticated using (true);

create policy "banco_insert_autenticado" on public.banco
  for insert to authenticated with check (true);

create policy "banco_update_autenticado" on public.banco
  for update to authenticated using (true) with check (true);

create policy "banco_delete_autenticado" on public.banco
  for delete to authenticated using (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.banco from anon;
grant select, insert, update, delete on public.banco to authenticated;

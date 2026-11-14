-- =====================================================================
-- Charoli Gestión - RLS de las transferencias entre cuentas de fondos
-- Mismo patrón que 20261111000002_rls_finanzas_cuentas.sql: acceso
-- completo para authenticated y nada para anon. Que una transferencia no
-- se edite ni se borre (sólo se anula) no depende de la RLS: lo impone el
-- trigger de 20261112000003_finanzas_transferencias.sql.
-- =====================================================================

alter table public.transferencia_fondos enable row level security;

create policy "transferencia_fondos_select_autenticado" on public.transferencia_fondos
  for select to authenticated using (true);

create policy "transferencia_fondos_insert_autenticado" on public.transferencia_fondos
  for insert to authenticated with check (true);

create policy "transferencia_fondos_update_autenticado" on public.transferencia_fondos
  for update to authenticated using (true) with check (true);

create policy "transferencia_fondos_delete_autenticado" on public.transferencia_fondos
  for delete to authenticated using (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.transferencia_fondos from anon;
grant select, insert, update, delete on public.transferencia_fondos to authenticated;

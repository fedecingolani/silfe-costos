-- =====================================================================
-- Silfe Costos - RLS de la configuración de ARCA
-- Mismo patrón que 20261019000002_rls_crm_ficha_cliente.sql. arca_emisor
-- es una fila única, como parametro_costeo: no tiene políticas de alta ni
-- de baja. Se revoca todo a anon: los privilegios por defecto de Supabase
-- le darían TRUNCATE, REFERENCES y TRIGGER sobre las tablas nuevas.
-- =====================================================================

alter table public.arca_emisor enable row level security;
alter table public.arca_credencial enable row level security;

-- ----- Emisor (fila única: sólo se lee y se edita) -----------------------

create policy "arca_emisor_select_autenticado" on public.arca_emisor
  for select to authenticated using (true);

create policy "arca_emisor_update_autenticado" on public.arca_emisor
  for update to authenticated using (true) with check (true);

-- ----- Credenciales ------------------------------------------------------

create policy "arca_credencial_select_autenticado" on public.arca_credencial
  for select to authenticated using (true);

create policy "arca_credencial_insert_autenticado" on public.arca_credencial
  for insert to authenticated with check (true);

create policy "arca_credencial_update_autenticado" on public.arca_credencial
  for update to authenticated using (true) with check (true);

create policy "arca_credencial_delete_autenticado" on public.arca_credencial
  for delete to authenticated using (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.arca_emisor, public.arca_credencial from anon;
grant select, insert, update, delete on arca_emisor, arca_credencial to authenticated;

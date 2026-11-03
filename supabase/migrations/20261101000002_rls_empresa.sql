-- =====================================================================
-- Charoli Gestión - RLS de la identidad de la empresa
-- Mismo patrón que 20261023000002_rls_arca_configuracion.sql. empresa es
-- una fila única: no tiene políticas de alta ni de baja. Se revoca todo a
-- anon: los privilegios por defecto de Supabase le darían TRUNCATE,
-- REFERENCES y TRIGGER sobre las tablas nuevas.
-- =====================================================================

alter table public.empresa enable row level security;

-- ----- Empresa (fila única: sólo se lee y se edita) ----------------------

create policy "empresa_select_autenticado" on public.empresa
  for select to authenticated using (true);

create policy "empresa_update_autenticado" on public.empresa
  for update to authenticated using (true) with check (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.empresa from anon;
revoke all on public.empresa from authenticated;
grant select, update on public.empresa to authenticated;

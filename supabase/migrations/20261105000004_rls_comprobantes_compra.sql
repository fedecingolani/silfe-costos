-- =====================================================================
-- Charoli Gestión - RLS de los comprobantes de compra
-- Mismo patrón que 20261104000002_rls_remitos.sql: acceso completo para
-- authenticated y nada para anon. La inmutabilidad de los confirmados y
-- anulados no depende de la RLS: la imponen los triggers de
-- 20261105000003_comprobantes_compra.sql para cualquier rol.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['comprobante_compra', 'comprobante_compra_item', 'comprobante_compra_percepcion'];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      create policy "%1$s_select_autenticado" on public.%1$I
        for select to authenticated using (true)
    $f$, t);

    execute format($f$
      create policy "%1$s_insert_autenticado" on public.%1$I
        for insert to authenticated with check (true)
    $f$, t);

    execute format($f$
      create policy "%1$s_update_autenticado" on public.%1$I
        for update to authenticated using (true) with check (true)
    $f$, t);

    execute format($f$
      create policy "%1$s_delete_autenticado" on public.%1$I
        for delete to authenticated using (true)
    $f$, t);
  end loop;
end;
$$;

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.comprobante_compra, public.comprobante_compra_item, public.comprobante_compra_percepcion from anon;
grant select, insert, update, delete
  on public.comprobante_compra, public.comprobante_compra_item, public.comprobante_compra_percepcion
  to authenticated;

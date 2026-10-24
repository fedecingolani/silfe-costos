-- =====================================================================
-- Silfe Costos - RLS de los presupuestos de venta
-- Mismo patrón que 20261024000002_rls_comprobantes.sql: acceso completo
-- para authenticated y nada para anon. La inmutabilidad de los
-- presupuestos convertidos no depende de la RLS: la imponen los triggers
-- de 20261030000001_presupuestos.sql para cualquier rol.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['presupuesto', 'presupuesto_item'];
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

revoke all on public.presupuesto, public.presupuesto_item from anon;
grant select, insert, update, delete on public.presupuesto, public.presupuesto_item to authenticated;

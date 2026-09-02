-- =====================================================================
-- Silfe Costos - RLS del módulo de clientes
-- Mismo patrón que 20260901000003_rls.sql, aplicado a las tablas nuevas.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['zona','cliente','cliente_contacto'];
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

grant select, insert, update, delete on zona, cliente, cliente_contacto to authenticated;

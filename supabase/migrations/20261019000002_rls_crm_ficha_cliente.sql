-- =====================================================================
-- Silfe Costos - RLS de la ficha completa del cliente
-- Mismo patrón que 20260901000006_rls_clientes.sql, aplicado a las tablas
-- nuevas. Como en 20261018000002_rls_revocar_anon.sql, se revoca todo a
-- anon: los privilegios por defecto de Supabase le darían TRUNCATE,
-- REFERENCES y TRIGGER sobre las tablas nuevas.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['transporte','cliente_sucursal'];
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

revoke all on public.transporte, public.cliente_sucursal from anon;
grant select, insert, update, delete on transporte, cliente_sucursal to authenticated;

-- La función corre con los permisos de quien la llama (security invoker):
-- alcanza con que la pueda ejecutar un usuario autenticado.
revoke execute on function public.marcar_sucursal_principal(uuid) from public, anon;
grant execute on function public.marcar_sucursal_principal(uuid) to authenticated;

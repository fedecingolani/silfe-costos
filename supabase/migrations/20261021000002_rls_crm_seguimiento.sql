-- =====================================================================
-- Silfe Costos - RLS del seguimiento de clientes
-- Mismo patrón que 20261019000002_rls_crm_ficha_cliente.sql: acceso
-- completo para authenticated y nada para anon. Se revoca todo a anon de
-- forma explícita porque los privilegios por defecto de Supabase se lo
-- darían sobre la tabla y la vista nuevas.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['cliente_interaccion'];
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

revoke all on public.cliente_interaccion, public.v_cliente_seguimiento from anon;
grant select, insert, update, delete on public.cliente_interaccion to authenticated;
-- La vista es security_invoker: aplica la RLS de cliente, zona e
-- interacciones de quien consulta. Sólo se lee.
revoke insert, update, delete, truncate, references, trigger on public.v_cliente_seguimiento from authenticated;
grant select on public.v_cliente_seguimiento to authenticated;

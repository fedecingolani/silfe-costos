-- =====================================================================
-- Charoli Gestión - RLS de las cuentas de fondos y sus ajustes
-- Mismo patrón que 20261106000002_rls_pagos_compra.sql: acceso completo
-- para authenticated y nada para anon. La inmutabilidad de los ajustes
-- (sólo se anulan, no se borran) y el tipo fijo de la cuenta no dependen
-- de la RLS: los imponen los triggers de
-- 20261111000001_finanzas_cuentas.sql.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['cuenta_fondos', 'ajuste_fondos'];
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

revoke all on public.cuenta_fondos, public.ajuste_fondos from anon;
grant select, insert, update, delete on public.cuenta_fondos, public.ajuste_fondos to authenticated;

-- Las vistas son security_invoker: aplican la RLS de quien consulta.
revoke all on public.v_movimiento_fondos, public.v_cuenta_fondos_saldo from anon;
grant select on public.v_movimiento_fondos, public.v_cuenta_fondos_saldo to authenticated;

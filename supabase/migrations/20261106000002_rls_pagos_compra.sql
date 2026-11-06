-- =====================================================================
-- Charoli Gestión - RLS de las órdenes de pago
-- Mismo patrón que 20261105000004_rls_comprobantes_compra.sql: acceso
-- completo para authenticated y nada para anon. La inmutabilidad de las
-- órdenes confirmadas y anuladas, sus medios e imputaciones no depende de
-- la RLS: la imponen los triggers de 20261106000001_pagos_compra.sql.
--
-- El contador (orden_pago_numeracion) es de sólo lectura para
-- authenticated, como recibo_punto_venta desde 20261028000001: lo avanza
-- únicamente confirmar_orden_pago (security definer).
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array['orden_pago', 'orden_pago_medio', 'imputacion_compra'];
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

alter table public.orden_pago_numeracion enable row level security;

create policy "orden_pago_numeracion_select_autenticado" on public.orden_pago_numeracion
  for select to authenticated using (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.orden_pago_numeracion, public.orden_pago, public.orden_pago_medio, public.imputacion_compra from anon;
revoke insert, update, delete, truncate on public.orden_pago_numeracion from authenticated;
grant select on public.orden_pago_numeracion to authenticated;
grant select, insert, update, delete on public.orden_pago, public.orden_pago_medio, public.imputacion_compra to authenticated;

-- Las vistas son security_invoker: aplican la RLS de quien consulta.
revoke all on public.v_comprobante_compra_saldo, public.v_proveedor_saldo_a_favor from anon;
grant select on public.v_comprobante_compra_saldo, public.v_proveedor_saldo_a_favor to authenticated;

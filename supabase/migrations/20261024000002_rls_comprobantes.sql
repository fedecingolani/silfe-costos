-- =====================================================================
-- Silfe Costos - RLS de los comprobantes de venta
-- Mismo patrón que 20261023000002_rls_arca_configuracion.sql: acceso
-- completo para authenticated y nada para anon. La inmutabilidad de los
-- comprobantes autorizados no depende de la RLS: la imponen los triggers
-- de 20261024000001_comprobantes.sql para cualquier rol.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array[
    'punto_venta', 'comprobante', 'comprobante_item', 'comprobante_asociado', 'comprobante_numeracion_bloqueo'
  ];
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

revoke all on public.punto_venta, public.comprobante, public.comprobante_item,
  public.comprobante_asociado, public.comprobante_numeracion_bloqueo from anon;
grant select, insert, update, delete on public.punto_venta, public.comprobante, public.comprobante_item,
  public.comprobante_asociado, public.comprobante_numeracion_bloqueo to authenticated;

-- Las funciones de bloqueo corren con los permisos de quien las llama
-- (security invoker): sólo authenticated las ejecuta.
revoke execute on function public.tomar_bloqueo_numeracion(text, integer, integer, interval) from public, anon;
revoke execute on function public.liberar_bloqueo_numeracion(text, integer, integer, timestamptz) from public, anon;
grant execute on function public.tomar_bloqueo_numeracion(text, integer, integer, interval) to authenticated;
grant execute on function public.liberar_bloqueo_numeracion(text, integer, integer, timestamptz) to authenticated;

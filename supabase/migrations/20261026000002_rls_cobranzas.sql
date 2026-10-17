-- =====================================================================
-- Silfe Costos - RLS de cobranzas
-- Mismo patrón que 20261024000002_rls_comprobantes.sql: acceso completo
-- para authenticated y nada para anon. La inmutabilidad de los recibos
-- emitidos, sus medios e imputaciones y el historial de cheques no depende
-- de la RLS: la imponen los triggers de 20261026000001_cobranzas.sql.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array[
    'recibo_punto_venta', 'recibo', 'recibo_medio', 'cheque', 'cheque_estado', 'imputacion'
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

revoke all on public.recibo_punto_venta, public.recibo, public.recibo_medio, public.cheque,
  public.cheque_estado, public.imputacion from anon;
grant select, insert, update, delete on public.recibo_punto_venta, public.recibo, public.recibo_medio,
  public.cheque, public.cheque_estado, public.imputacion to authenticated;

-- Las vistas son security_invoker: aplican la RLS de quien consulta.
revoke all on public.v_comprobante_saldo, public.v_cliente_saldo_a_favor, public.v_cuenta_corriente,
  public.v_cliente_saldo from anon;
grant select on public.v_comprobante_saldo, public.v_cliente_saldo_a_favor, public.v_cuenta_corriente,
  public.v_cliente_saldo to authenticated;

-- Funciones de triggers: no se llaman directamente.
revoke execute on function public.fn_recibo_validar() from anon, authenticated, public;
revoke execute on function public.fn_recibo_anulado() from anon, authenticated, public;
revoke execute on function public.fn_recibo_borrar() from anon, authenticated, public;
revoke execute on function public.fn_recibo_medio_validar() from anon, authenticated, public;
revoke execute on function public.fn_cheque_validar() from anon, authenticated, public;
revoke execute on function public.fn_cheque_historial() from anon, authenticated, public;
revoke execute on function public.fn_cheque_estado_inmutable() from anon, authenticated, public;
revoke execute on function public.fn_imputacion_validar() from anon, authenticated, public;

-- Ayudas que usan los triggers y las vistas (security invoker): sólo authenticated.
revoke execute on function public.fn_recibo_validar_contado(public.recibo) from public, anon;
revoke execute on function public.fn_es_debito_cc(text, text, text) from public, anon;
revoke execute on function public.fn_es_nota_credito_cc(text, text, text) from public, anon;
revoke execute on function public.fn_imputado_debito(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_recibo_validar_contado(public.recibo) to authenticated;
grant execute on function public.fn_es_debito_cc(text, text, text) to authenticated;
grant execute on function public.fn_es_nota_credito_cc(text, text, text) to authenticated;
grant execute on function public.fn_imputado_debito(uuid, uuid, uuid) to authenticated;

-- Emisión y anulación (security invoker): sólo authenticated.
revoke execute on function public.emitir_recibo(uuid) from public, anon;
revoke execute on function public.anular_recibo(uuid, text) from public, anon;
grant execute on function public.emitir_recibo(uuid) to authenticated;
grant execute on function public.anular_recibo(uuid, text) to authenticated;

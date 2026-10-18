-- =====================================================================
-- Silfe Costos - Cobranzas: resumen de cuenta corriente por cliente
-- (Fase 8, Ventas → Cuentas corrientes)
--
-- v_cliente_cuenta_resumen: una fila por cliente con algo en su cuenta
-- corriente (saldo distinto de cero, débitos pendientes o saldo a favor),
-- con los datos para buscarlo (razón social, CUIT, código) y lo que
-- muestra el listado general:
--   - saldo (positivo: debe; negativo: a favor), deuda pendiente y
--     saldo a favor, de v_cliente_saldo (saldo = pendientes − a favor);
--   - fecha del débito pendiente más viejo y cantidad de pendientes, de
--     v_comprobante_saldo.
-- Un cliente con deuda y a favor a la vez (un recibo a cuenta posterior a
-- la factura) aparece aunque su saldo neto sea cero: tiene algo que
-- imputar.
-- Como las demás vistas de cobranzas: security invoker, sin homologación
-- ni recibos anulados (ya los excluyen las vistas de base).
-- =====================================================================

create view v_cliente_cuenta_resumen
with (security_invoker = true) as
select
  cl.id as cliente_id,
  cl.razon_social,
  cl.cuit,
  cl.cuit_digitos,
  cl.codigo_legado,
  s.saldo,
  s.deuda_pendiente,
  s.saldo_a_favor,
  s.pendiente_mas_viejo,
  coalesce(p.cantidad, 0) as pendientes
from v_cliente_saldo s
join cliente cl on cl.id = s.cliente_id
left join (
  select cliente_id, count(*) as cantidad from v_comprobante_saldo where saldo > 0 group by cliente_id
) p on p.cliente_id = s.cliente_id
where s.saldo <> 0 or s.deuda_pendiente <> 0 or s.saldo_a_favor <> 0;

comment on view v_cliente_cuenta_resumen is
  'Clientes con saldo, pendientes o saldo a favor: saldo, deuda, a favor, deuda más vieja y cantidad de pendientes';

revoke all on public.v_cliente_cuenta_resumen from anon;
grant select on public.v_cliente_cuenta_resumen to authenticated;

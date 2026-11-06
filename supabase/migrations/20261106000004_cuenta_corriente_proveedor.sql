-- =====================================================================
-- Charoli Gestión - Cuenta corriente de proveedores (Compras)
--
-- Es la cuenta corriente de clientes al revés (v_cuenta_corriente y
-- v_cliente_saldo de 20261026000001_cobranzas.sql, y
-- v_cliente_cuenta_resumen de 20261029000001): las facturas y notas de
-- débito de compra confirmadas suman deuda con el proveedor, y las notas
-- de crédito de compra y las órdenes de pago confirmadas la restan. Saldo
-- positivo: le debemos. Negativo: tenemos a favor.
--
-- Las columnas se llaman debito y credito (no debe y haber) con el sentido
-- que ya usa 20261106000001_pagos_compra.sql: débitos son facturas y notas
-- de débito; créditos, órdenes de pago y notas de crédito.
--
-- Vistas (security invoker, sin borradores ni anulados):
--   - v_proveedor_cuenta_corriente: movimientos con saldo acumulado.
--   - v_proveedor_saldo: saldo por proveedor, deuda pendiente (débitos con
--     saldo, de v_comprobante_compra_saldo), saldo a favor (de
--     v_proveedor_saldo_a_favor) y fecha del pendiente más viejo.
--     saldo = débitos − créditos = deuda pendiente − saldo a favor.
--   - v_proveedor_cuenta_resumen: proveedores con algo en la cuenta, para
--     el listado de Compras → Cuentas corrientes.
--
-- aplicar_saldo_a_favor_compra(p_comprobante_compra_id): aplica a mano el
-- saldo a favor del proveedor a un débito pendiente, con la misma regla
-- que la aplicación automática al confirmar (fn_comprobante_compra_
-- aplicar_creditos): del crédito más viejo al más nuevo, hasta cubrir el
-- débito o agotarlos. Sirve para lo que quedó a favor después de cargar el
-- débito (una nota de crédito suelta o una orden que pagó de más). Las
-- imputaciones se marcan automatica = true, como las de la aplicación al
-- confirmar: es la única forma de imputar el saldo de una orden ya
-- confirmada. Como en ventas, no hay "desaplicar": las imputaciones de una
-- nota de crédito se deshacen anulándola, y las de una orden, anulando la
-- orden.
--
-- Errores nuevos (los anteriores, en 20261106000001):
--   OP007 debito_invalido       (no es factura o ND de compra confirmada)
--   OP018 sin_saldo_a_favor     (el proveedor no tiene créditos disponibles)
--   OP019 debito_sin_saldo      (el débito ya está cancelado)
-- =====================================================================

-- ----- Movimientos ----------------------------------------------------------

create view v_proveedor_cuenta_corriente
with (security_invoker = true) as
with movimientos as (
  select c.proveedor_id, c.fecha, c.creado_en, c.id as movimiento_id, c.tipo,
         c.id as comprobante_compra_id, null::uuid as orden_pago_id,
         public.fn_numero_comprobante_compra(c.tipo, c.letra, c.punto_venta, c.numero) as numero_texto,
         case when c.tipo = 'nota_credito' then 0 else c.total end as debito,
         case when c.tipo = 'nota_credito' then c.total else 0 end as credito
  from comprobante_compra c
  where public.fn_es_debito_compra(c.tipo, c.estado)
     or public.fn_es_nota_credito_compra(c.tipo, c.estado)
  union all
  select o.proveedor_id, o.fecha, o.creado_en, o.id, 'orden_pago', null, o.id, o.numero_texto, 0, o.total
  from orden_pago o
  where o.estado = 'confirmado'
)
select proveedor_id, fecha, creado_en, tipo, comprobante_compra_id, orden_pago_id, numero_texto, debito, credito,
       sum(debito - credito) over (
         partition by proveedor_id order by fecha, creado_en, movimiento_id
         rows between unbounded preceding and current row
       ) as saldo
from movimientos
order by proveedor_id, fecha, creado_en, movimiento_id;

comment on view v_proveedor_cuenta_corriente is
  'Movimientos de la cuenta corriente del proveedor (facturas, ND, NC y órdenes de pago confirmadas) con saldo acumulado. Positivo: le debemos';

-- ----- Saldo por proveedor ----------------------------------------------------

create view v_proveedor_saldo
with (security_invoker = true) as
select
  pr.id as proveedor_id,
  coalesce(m.debito, 0) as debito,
  coalesce(m.credito, 0) as credito,
  coalesce(m.debito, 0) - coalesce(m.credito, 0) as saldo,
  coalesce(p.pendiente, 0) as deuda_pendiente,
  coalesce(f.a_favor, 0) as saldo_a_favor,
  p.pendiente_mas_viejo
from proveedor pr
left join (
  select proveedor_id, sum(debito) as debito, sum(credito) as credito
  from v_proveedor_cuenta_corriente
  group by proveedor_id
) m on m.proveedor_id = pr.id
left join (
  select proveedor_id, sum(saldo) as pendiente, min(fecha) as pendiente_mas_viejo
  from v_comprobante_compra_saldo
  where saldo > 0
  group by proveedor_id
) p on p.proveedor_id = pr.id
left join (
  select proveedor_id, sum(disponible) as a_favor from v_proveedor_saldo_a_favor group by proveedor_id
) f on f.proveedor_id = pr.id;

comment on view v_proveedor_saldo is
  'Saldo de la cuenta corriente por proveedor (positivo: le debemos), deuda pendiente, saldo a favor y fecha del pendiente más viejo';

-- ----- Resumen para el listado ------------------------------------------------

-- Un proveedor con deuda y a favor a la vez aparece aunque el neto sea
-- cero: tiene algo que aplicar.
create view v_proveedor_cuenta_resumen
with (security_invoker = true) as
select
  pr.id as proveedor_id,
  pr.nombre,
  pr.cuit,
  pr.activo,
  s.saldo,
  s.deuda_pendiente,
  s.saldo_a_favor,
  s.pendiente_mas_viejo,
  coalesce(p.cantidad, 0) as pendientes
from v_proveedor_saldo s
join proveedor pr on pr.id = s.proveedor_id
left join (
  select proveedor_id, count(*) as cantidad from v_comprobante_compra_saldo where saldo > 0 group by proveedor_id
) p on p.proveedor_id = s.proveedor_id
where s.saldo <> 0 or s.deuda_pendiente <> 0 or s.saldo_a_favor <> 0;

comment on view v_proveedor_cuenta_resumen is
  'Proveedores con saldo, pendientes o saldo a favor: saldo, deuda, a favor, deuda más vieja y cantidad de pendientes';

-- ----- Aplicar el saldo a favor a un débito -----------------------------------

create or replace function public.aplicar_saldo_a_favor_compra(p_comprobante_compra_id uuid)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deb record;
  v_restante numeric;
  v_importe numeric;
  v_aplicado numeric := 0;
  v_fila record;
begin
  select c.id, c.tipo, c.estado, c.proveedor_id, c.total into v_deb
  from public.comprobante_compra c
  where c.id = p_comprobante_compra_id;
  if not found or not public.fn_es_debito_compra(v_deb.tipo, v_deb.estado) then
    raise exception 'Sólo se aplica saldo a favor a facturas y notas de débito de compra confirmadas.'
      using errcode = 'OP007', hint = 'debito_invalido';
  end if;

  -- El mismo candado que la aplicación al confirmar: serializa con ella.
  perform pg_advisory_xact_lock(hashtextextended('saldo_a_favor_compra:' || v_deb.proveedor_id::text, 0));

  v_restante := v_deb.total - public.fn_imputado_debito_compra(v_deb.id, null, null);
  if v_restante <= 0 then
    raise exception 'El comprobante ya no tiene saldo pendiente.'
      using errcode = 'OP019', hint = 'debito_sin_saldo';
  end if;

  for v_fila in
    select f.orden_pago_id, f.nota_credito_id, f.disponible
    from public.v_proveedor_saldo_a_favor f
    where f.proveedor_id = v_deb.proveedor_id
    order by f.fecha, f.creado_en, coalesce(f.orden_pago_id, f.nota_credito_id)
  loop
    exit when v_restante <= 0;
    v_importe := least(v_restante, v_fila.disponible);
    insert into public.imputacion_compra (orden_pago_id, nota_credito_id, comprobante_compra_id, importe, automatica)
    values (v_fila.orden_pago_id, v_fila.nota_credito_id, v_deb.id, v_importe, true);
    v_restante := v_restante - v_importe;
    v_aplicado := v_aplicado + v_importe;
  end loop;

  if v_aplicado = 0 then
    raise exception 'El proveedor no tiene saldo a favor para aplicar.'
      using errcode = 'OP018', hint = 'sin_saldo_a_favor';
  end if;
  return v_aplicado;
end;
$$;

comment on function public.aplicar_saldo_a_favor_compra(uuid) is
  'Aplica el saldo a favor del proveedor (órdenes de pago y NC) a un débito pendiente, del crédito más viejo al más nuevo. Devuelve lo aplicado';

-- ----- Permisos ---------------------------------------------------------------

-- Las vistas son security_invoker: aplican la RLS de quien consulta.
revoke all on public.v_proveedor_cuenta_corriente, public.v_proveedor_saldo, public.v_proveedor_cuenta_resumen from anon;
grant select on public.v_proveedor_cuenta_corriente, public.v_proveedor_saldo, public.v_proveedor_cuenta_resumen
  to authenticated;

revoke execute on function public.aplicar_saldo_a_favor_compra(uuid) from public, anon;
grant execute on function public.aplicar_saldo_a_favor_compra(uuid) to authenticated;

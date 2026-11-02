-- =====================================================================
-- Silfe Costos - Borrar comprobantes X emitidos
--
-- Un comprobante X no es fiscal (no tiene CAE ni se informa a ARCA): un
-- error de carga se corrige borrándolo, aunque ya esté autorizado.
-- Reglas:
--   - sólo un X autorizado; los A y B autorizados siguen sin borrarse
--     (CM001: se anulan con una nota de crédito) y los demás estados
--     siguen como antes (CM003);
--   - lo bloquea cualquier comprobante que dependa de él (CM010):
--       * un recibo que le imputa a mano (imputacion.automatica = false);
--       * un recibo de contado de ese X (recibo.comprobante_contado_id),
--         en cualquier estado;
--       * una nota asociada a ese X (comprobante_asociado.asociado_id);
--       * la nota de débito de un cheque rechazado (cheque.nd_comprobante_id);
--     a futuro, cualquier clave foránea on delete restrict hacia
--     comprobante sigue siendo la red de seguridad (23503);
--   - sus imputaciones automáticas se deshacen y el saldo vuelve a quedar
--     a favor del cliente: las del saldo a favor aplicado a ese X
--     (comprobante_id = X y automatica) y, si es una nota de crédito,
--     todas las suyas (nota_credito_id = X). fn_imputacion_validar sólo
--     deja borrarlas con la marca de la transacción comprobante.borrando
--     (mismo patrón que presupuesto.convirtiendo);
--   - un presupuesto convertido en ese X vuelve a abierto (ya lo hace el
--     on delete set null de presupuesto.comprobante_id);
--   - sus ítems y asociados caen en cascada: fn_comprobante_hijo_bloqueo
--     no encuentra al comprobante ya borrado y los deja pasar;
--   - la numeración X es máximo + 1: si se borra el último, su número se
--     reutiliza.
--
-- Reemplaza fn_comprobante_borrar (20261024000001) y
-- fn_imputacion_validar (20261026000001) con las mismas reglas de antes
-- más éstas. Error nuevo:
--   CM010 comprobante_con_asociados (X con comprobantes que dependen de él)
-- =====================================================================

-- ----- Borrado del comprobante -------------------------------------------------

create or replace function public.fn_comprobante_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'autorizado' and old.letra = 'X' then
    if exists (
      select 1 from public.imputacion i
      where i.comprobante_id = old.id and not i.automatica
    ) or exists (
      select 1 from public.recibo r where r.comprobante_contado_id = old.id
    ) then
      raise exception 'El comprobante tiene cobranzas: no se puede borrar. Anulá o borrá antes los recibos que lo cobran.'
        using errcode = 'CM010', hint = 'comprobante_con_asociados';
    end if;
    if exists (select 1 from public.comprobante_asociado a where a.asociado_id = old.id) then
      raise exception 'El comprobante tiene notas asociadas: no se puede borrar. Borrá antes esas notas.'
        using errcode = 'CM010', hint = 'comprobante_con_asociados';
    end if;
    if exists (select 1 from public.cheque ch where ch.nd_comprobante_id = old.id) then
      raise exception 'Es la nota de débito de un cheque rechazado: no se puede borrar.'
        using errcode = 'CM010', hint = 'comprobante_con_asociados';
    end if;

    -- Deshace las imputaciones automáticas: el saldo vuelve a quedar a favor.
    perform set_config('comprobante.borrando', old.id::text, true);
    delete from public.imputacion i
    where (i.comprobante_id = old.id and i.automatica)
       or i.nota_credito_id = old.id;
    perform set_config('comprobante.borrando', '', true);
    return old;
  end if;

  if old.estado = 'autorizado' then
    raise exception 'El comprobante está autorizado: no se puede borrar. Para anularlo, emití una nota de crédito.'
      using errcode = 'CM001', hint = 'comprobante_autorizado_inmutable';
  end if;
  if old.estado not in ('borrador', 'rechazado') then
    raise exception 'Sólo se borran borradores y rechazados (el comprobante está en %).', old.estado
      using errcode = 'CM003', hint = 'borrado_no_permitido';
  end if;
  return old;
end;
$$;

revoke execute on function public.fn_comprobante_borrar() from anon, authenticated, public;

-- ----- Imputaciones ------------------------------------------------------------------

-- Igual que en 20261026000001, más: al borrar un X autorizado
-- (fn_comprobante_borrar marca la transacción con su id), sus
-- imputaciones automáticas y las de la nota de crédito se borran.
create or replace function public.fn_imputacion_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estado text;
  v_deb record;
  v_recibo record;
  v_nc record;
  v_cliente uuid;
  v_total_origen numeric;
  v_imputado_origen numeric;
  v_borrando text;
begin
  if tg_op = 'DELETE' then
    v_borrando := coalesce(current_setting('comprobante.borrando', true), '');
    if v_borrando <> ''
      and v_borrando in (old.comprobante_id::text, coalesce(old.nota_credito_id::text, ''))
    then
      return old;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.nota_credito_id is not null then
      raise exception 'Las imputaciones de una nota de crédito no se modifican ni se borran.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    select r.estado into v_estado from public.recibo r where r.id = old.recibo_id;
    if tg_op = 'DELETE' then
      -- Borrador, anulación (el trigger del recibo las borra) o cascada.
      if v_estado is null or v_estado in ('borrador', 'anulado') then
        return old;
      end if;
      raise exception 'El recibo está emitido: sus imputaciones no se pueden cambiar. Para deshacerlas, anulá el recibo.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'El recibo está %: sus imputaciones no se pueden cambiar.', v_estado
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if new.recibo_id is distinct from old.recibo_id or new.nota_credito_id is distinct from old.nota_credito_id then
      raise exception 'Una imputación no cambia de origen.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
  end if;

  -- Sin origen o con dos, la restricción imputacion_origen_check lo informa.
  if num_nonnulls(new.recibo_id, new.nota_credito_id) <> 1 then
    return new;
  end if;

  -- El débito, bloqueado mientras se controla su saldo.
  select c.clase, c.estado, c.ambiente, c.cliente_id, c.condicion_pago, c.total into v_deb
  from public.comprobante c
  where c.id = new.comprobante_id
  for update;
  if not found or not public.fn_es_debito_cc(v_deb.clase, v_deb.estado, v_deb.ambiente) then
    raise exception 'Sólo se imputan facturas y notas de débito autorizadas de producción o de puntos de venta no electrónicos.'
      using errcode = 'CB007', hint = 'debito_invalido';
  end if;

  if new.recibo_id is not null then
    select r.estado, r.cliente_id, r.total, r.comprobante_contado_id into v_recibo
    from public.recibo r
    where r.id = new.recibo_id
    for update;
    if v_recibo.estado = 'anulado' then
      raise exception 'El recibo está anulado: no imputa.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if v_recibo.estado = 'emitido' and not new.automatica then
      raise exception 'El recibo está emitido: sólo se le agrega la aplicación automática de su saldo a favor.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if v_recibo.comprobante_contado_id is not null and v_recibo.comprobante_contado_id <> new.comprobante_id then
      raise exception 'El pago de contado sólo se imputa a su factura.'
        using errcode = 'CB015', hint = 'contado_invalido';
    end if;
    v_cliente := v_recibo.cliente_id;
    v_total_origen := v_recibo.total;
    select coalesce(sum(i.importe), 0) into v_imputado_origen
    from public.imputacion i
    where i.recibo_id = new.recibo_id and i.id is distinct from new.id;
  else
    select c.clase, c.estado, c.ambiente, c.cliente_id, c.total into v_nc
    from public.comprobante c
    where c.id = new.nota_credito_id
    for update;
    if not found or not public.fn_es_nota_credito_cc(v_nc.clase, v_nc.estado, v_nc.ambiente) then
      raise exception 'El origen tiene que ser una nota de crédito autorizada de producción o de un punto de venta no electrónico.'
        using errcode = 'CB016', hint = 'credito_invalido';
    end if;
    v_cliente := v_nc.cliente_id;
    v_total_origen := v_nc.total;
    select coalesce(sum(i.importe), 0) into v_imputado_origen
    from public.imputacion i
    where i.nota_credito_id = new.nota_credito_id and i.id is distinct from new.id;
  end if;

  if v_cliente <> v_deb.cliente_id then
    raise exception 'El crédito y el comprobante son de clientes distintos.'
      using errcode = 'CB008', hint = 'cliente_distinto';
  end if;

  if new.automatica and v_deb.condicion_pago = 'contado' then
    raise exception 'Una factura de contado no consume saldo a favor.'
      using errcode = 'CB015', hint = 'contado_invalido';
  end if;

  if v_imputado_origen + new.importe > v_total_origen then
    raise exception 'Las imputaciones ($ %) superan el total del crédito ($ %).', v_imputado_origen + new.importe, v_total_origen
      using errcode = 'CB005', hint = 'imputacion_excede_credito';
  end if;

  if public.fn_imputado_debito(new.comprobante_id, new.recibo_id, new.id) + new.importe > v_deb.total then
    raise exception 'La imputación supera el saldo pendiente del comprobante ($ %).',
      v_deb.total - public.fn_imputado_debito(new.comprobante_id, new.recibo_id, new.id)
      using errcode = 'CB006', hint = 'imputacion_excede_saldo';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_imputacion_validar() from anon, authenticated, public;

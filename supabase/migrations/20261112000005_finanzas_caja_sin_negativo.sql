-- =====================================================================
-- Charoli Gestión - Finanzas: una caja nunca queda en negativo
--
-- Un banco puede quedar en negativo (descubierto); una caja no, en ninguna
-- fecha. Se rechaza toda escritura que baje el saldo de una caja si,
-- después de ella, el saldo acumulado de v_movimiento_fondos (mismo orden:
-- fecha, creado_en, origen_id, origen) queda < 0 en algún movimiento con
-- fecha igual o posterior a la del cambio. Así se rechaza también un
-- egreso con fecha pasada que deja negativo un día posterior aunque hoy
-- alcance, y uno con fecha futura.
--
-- Escrituras que bajan el saldo de una caja (las demás sólo lo suben o
-- no tocan cajas, y no se controlan):
--   - ajuste_fondos: alta de un egreso; anulación de un ingreso.
--   - transferencia_fondos: alta (pata de egreso en la cuenta origen);
--     anulación (se va la pata de ingreso de la cuenta destino).
--   - orden_pago: confirmación (el efectivo sale de una caja; la
--     transferencia y el cheque propio, de bancos).
--   - recibo: anulación de uno emitido (se va el efectivo que entró).
-- Los cheques sólo se depositan en bancos y su rechazo debita el mismo
-- banco: no tocan cajas.
--
-- Datos anteriores a la regla: la migración no corrige cajas que ya estén
-- en negativo. Un ingreso siempre se acepta (no se controla), aunque la
-- caja siga en negativo; un egreso se rechaza mientras quede algún día
-- negativo desde su fecha, y se acepta una vez corregido ese tramo aunque
-- un día anterior siga en negativo. Es la regla estricta "nada que baje el
-- saldo puede dejarlo negativo desde su fecha": la alternativa "rechazar
-- sólo si el mínimo empeora" dejaría sumar egresos mientras la caja siga
-- más arriba que su peor día histórico, o sea, seguir en negativo.
--
-- Dónde corre: triggers AFTER ... FOR EACH ROW, que ven la fila nueva (y
-- las demás filas de la misma sentencia, porque los AFTER de fila corren
-- al final de la sentencia). Cada trigger tiene un WHEN que deja pasar
-- sólo lo que baja un saldo; fn_validar_caja_sin_negativo descarta las
-- cuentas que no son cajas con una lectura por clave, así que los
-- movimientos sólo de bancos no bloquean ni leen la vista.
--
-- Concurrencia: dos egresos simultáneos en la misma caja podrían pasar el
-- control cada uno sin ver al otro. fn_validar_caja_sin_negativo toma un
-- advisory lock de transacción por caja (en orden de id, para no trabarse
-- entre dos escrituras de varias cajas) y recién después lee la vista: en
-- READ COMMITTED esa lectura ya ve lo que confirmó la transacción que tenía
-- el lock. Se usa un advisory lock y no "for update" sobre cuenta_fondos
-- porque los triggers BEFORE ya toman "for share" de la cuenta: subir a
-- "for update" en el AFTER haría que dos escrituras concurrentes se
-- esperen una a la otra (deadlock) en lugar de ponerse en fila.
--
-- Errores (SQLSTATE propio, estable; el HINT repite el motivo como clave):
--   FN011 caja_negativa  'La caja "<nombre>" quedaría en $ -1.500,00 el
--                         12/11/2026.' El primer movimiento, desde la
--                         fecha del cambio, en que el saldo queda < 0.
-- =====================================================================

-- ----- Control ----------------------------------------------------------------

-- Security invoker: lee v_movimiento_fondos (security invoker) con los
-- permisos de quien escribe; authenticated lee todas las tablas de la
-- vista. Si otra rol (service_role) empieza a escribir movimientos, hay
-- que darle execute y lectura de esas tablas.
create or replace function public.fn_validar_caja_sin_negativo(p_cuenta_ids uuid[], p_desde date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_caja record;
  v_punto record;
begin
  -- Primero los locks de todas las cajas, en orden; después los controles.
  for v_caja in
    select c.id from public.cuenta_fondos c
    where c.id = any(p_cuenta_ids) and c.tipo = 'caja'
    order by c.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('caja_sin_negativo:' || v_caja.id::text, 0));
  end loop;

  for v_caja in
    select c.id, c.nombre from public.cuenta_fondos c
    where c.id = any(p_cuenta_ids) and c.tipo = 'caja'
    order by c.id
  loop
    -- El saldo se acumula sobre toda la historia de la caja; se mira desde p_desde.
    select m.fecha, m.saldo into v_punto
    from public.v_movimiento_fondos m
    where m.cuenta_id = v_caja.id
      and m.fecha >= p_desde
      and m.saldo < 0
    order by m.fecha, m.creado_en, m.origen_id, m.origen
    limit 1;
    if found then
      raise exception 'La caja "%" quedaría en $ % el %.', v_caja.nombre,
        translate(to_char(v_punto.saldo, 'FM999,999,999,990.00'), ',.', '.,'),
        to_char(v_punto.fecha, 'DD/MM/YYYY')
        using errcode = 'FN011', hint = 'caja_negativa';
    end if;
  end loop;
end;
$$;

comment on function public.fn_validar_caja_sin_negativo(uuid[], date) is
  'Rechaza (FN011) si alguna de las cajas indicadas queda con saldo acumulado negativo desde la fecha dada. Ignora los bancos. Toma un advisory lock por caja hasta el fin de la transacción';

revoke execute on function public.fn_validar_caja_sin_negativo(uuid[], date) from public, anon;
grant execute on function public.fn_validar_caja_sin_negativo(uuid[], date) to authenticated;

-- ----- Ajustes ------------------------------------------------------------------

create or replace function public.fn_ajuste_fondos_caja_sin_negativo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.fn_validar_caja_sin_negativo(array[new.cuenta_id], new.fecha);
  return null;
end;
$$;

create trigger trg_ajuste_fondos_caja_egreso after insert on ajuste_fondos
  for each row when (new.tipo = 'egreso')
  execute function public.fn_ajuste_fondos_caja_sin_negativo();

create trigger trg_ajuste_fondos_caja_anulacion after update on ajuste_fondos
  for each row when (old.estado = 'vigente' and new.estado = 'anulado' and new.tipo = 'ingreso')
  execute function public.fn_ajuste_fondos_caja_sin_negativo();

-- ----- Transferencias -------------------------------------------------------------

create or replace function public.fn_transferencia_fondos_caja_sin_negativo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.fn_validar_caja_sin_negativo(array[new.cuenta_origen_id], new.fecha);
  else
    perform public.fn_validar_caja_sin_negativo(array[new.cuenta_destino_id], new.fecha);
  end if;
  return null;
end;
$$;

create trigger trg_transferencia_fondos_caja_alta after insert on transferencia_fondos
  for each row execute function public.fn_transferencia_fondos_caja_sin_negativo();

create trigger trg_transferencia_fondos_caja_anulacion after update on transferencia_fondos
  for each row when (old.estado = 'vigente' and new.estado = 'anulado')
  execute function public.fn_transferencia_fondos_caja_sin_negativo();

-- ----- Órdenes de pago --------------------------------------------------------------

-- Al confirmar. El efectivo sale en la fecha de la orden; los demás medios
-- van a bancos, que fn_validar_caja_sin_negativo ignora.
create or replace function public.fn_orden_pago_caja_sin_negativo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.fn_validar_caja_sin_negativo(
    array(select distinct m.cuenta_id from public.orden_pago_medio m
          where m.orden_pago_id = new.id and m.cuenta_id is not null),
    new.fecha);
  return null;
end;
$$;

create trigger trg_orden_pago_caja_sin_negativo after update on orden_pago
  for each row when (old.estado = 'borrador' and new.estado = 'confirmado')
  execute function public.fn_orden_pago_caja_sin_negativo();

-- ----- Recibos ------------------------------------------------------------------------

-- Al anular uno emitido: se va el efectivo que entró a la caja en la fecha del recibo.
create or replace function public.fn_recibo_caja_sin_negativo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.fn_validar_caja_sin_negativo(
    array(select distinct m.cuenta_id from public.recibo_medio m
          where m.recibo_id = new.id and m.cuenta_id is not null),
    new.fecha);
  return null;
end;
$$;

create trigger trg_recibo_caja_sin_negativo after update on recibo
  for each row when (old.estado = 'emitido' and new.estado = 'anulado')
  execute function public.fn_recibo_caja_sin_negativo();

revoke execute on function
  public.fn_ajuste_fondos_caja_sin_negativo(),
  public.fn_transferencia_fondos_caja_sin_negativo(),
  public.fn_orden_pago_caja_sin_negativo(),
  public.fn_recibo_caja_sin_negativo()
  from public, anon, authenticated;

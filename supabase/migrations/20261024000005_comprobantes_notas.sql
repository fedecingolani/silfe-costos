-- =====================================================================
-- Silfe Costos - Comprobantes: IVA por alícuota autorizado
--
-- comprobante.iva_detalle guarda el array Iva tal como se envió a ARCA en
-- FECAESolicitar: [{id, alicuota, base, importe}] (id es el código de
-- alícuota de ARCA). Se escribe en el mismo update que pasa el comprobante
-- a "verificando", junto con el número enviado, así que el PDF imprime lo
-- que ARCA autorizó en lugar de recalcularlo de los ítems. Vacío en los
-- comprobantes anteriores a esta migración (el PDF lo recalcula).
--
-- Mientras se verifica no cambia (CM004, como el resto de los datos
-- enviados) y en un autorizado no cambia nada (CM001). Reemplaza
-- fn_comprobante_validar (20261024000003) con las mismas reglas más ésta.
-- Mismos códigos de error:
--   CM001 comprobante_autorizado_inmutable
--   CM002 transicion_invalida
--   CM004 comprobante_bloqueado
--   CM005 punto_venta_inconsistente
-- =====================================================================

alter table comprobante
  add column iva_detalle jsonb,
  add constraint comprobante_iva_detalle_check check (iva_detalle is null or jsonb_typeof(iva_detalle) = 'array');

comment on column comprobante.iva_detalle is
  'IVA por alícuota enviado a ARCA: [{id, alicuota, base, importe}]. Se fija al pasar a verificando; vacío en los anteriores';

create or replace function public.fn_comprobante_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_electronico boolean;
begin
  if tg_op = 'UPDATE' and old.estado = 'autorizado' then
    raise exception 'El comprobante está autorizado: no se puede modificar. Para corregirlo, emití una nota de crédito.'
      using errcode = 'CM001', hint = 'comprobante_autorizado_inmutable';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Un comprobante se crea en borrador (se recibió "%").', new.estado
        using errcode = 'CM002', hint = 'transicion_invalida';
    end if;
    new.fecha_vencimiento_pago := coalesce(new.fecha_vencimiento_pago, new.fecha);
  end if;

  if tg_op = 'UPDATE' and old.estado = 'verificando' and (
    new.punto_venta is distinct from old.punto_venta
    or new.ambiente is distinct from old.ambiente
    or new.clase is distinct from old.clase
    or new.letra is distinct from old.letra
    or new.tipo_arca is distinct from old.tipo_arca
    or new.cliente_id is distinct from old.cliente_id
    or new.fecha is distinct from old.fecha
    or new.neto is distinct from old.neto
    or new.iva is distinct from old.iva
    or new.total is distinct from old.total
    or new.receptor_razon_social is distinct from old.receptor_razon_social
    or new.receptor_doc_tipo is distinct from old.receptor_doc_tipo
    or new.receptor_doc_nro is distinct from old.receptor_doc_nro
    or new.receptor_condicion_iva is distinct from old.receptor_condicion_iva
    or new.receptor_domicilio is distinct from old.receptor_domicilio
    or new.receptor_provincia is distinct from old.receptor_provincia
    or new.iva_detalle is distinct from old.iva_detalle
  ) then
    raise exception 'El comprobante se está verificando con ARCA: sus datos no se pueden cambiar.'
      using errcode = 'CM004', hint = 'comprobante_bloqueado';
  end if;

  if tg_op = 'UPDATE'
    and new.intento_numero is distinct from old.intento_numero
    and old.estado <> 'verificando'
    and new.estado <> 'verificando'
  then
    raise exception 'El número enviado a ARCA sólo cambia mientras el comprobante se verifica.'
      using errcode = 'CM002', hint = 'transicion_invalida';
  end if;

  select pv.electronico into v_electronico
  from public.punto_venta pv
  where pv.numero = new.punto_venta;

  -- Sin fila, la clave foránea informa que el punto de venta no existe.
  if v_electronico is not null then
    if v_electronico and new.ambiente is null then
      raise exception 'El punto de venta % es electrónico: el comprobante necesita el ambiente de ARCA.', new.punto_venta
        using errcode = 'CM005', hint = 'punto_venta_inconsistente';
    end if;
    if not v_electronico and new.ambiente is not null then
      raise exception 'El punto de venta % no es electrónico: el comprobante no lleva ambiente de ARCA.', new.punto_venta
        using errcode = 'CM005', hint = 'punto_venta_inconsistente';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador' and new.estado = 'verificando' and v_electronico)
      or (old.estado = 'verificando' and new.estado in ('autorizado', 'rechazado', 'borrador'))
      or (old.estado = 'rechazado' and new.estado = 'borrador')
      or (old.estado = 'borrador' and new.estado = 'autorizado' and not v_electronico)
    ) then
      raise exception 'Un comprobante no puede pasar de % a %.', old.estado, new.estado
        using errcode = 'CM002', hint = 'transicion_invalida';
    end if;

    if old.estado = 'verificando' and new.estado = 'autorizado'
      and new.numero is distinct from old.intento_numero
    then
      raise exception 'El comprobante se autoriza con el número enviado a ARCA (%), no con %.', old.intento_numero, new.numero
        using errcode = 'CM002', hint = 'transicion_invalida';
    end if;
  end if;

  if new.estado = 'autorizado' and v_electronico and (new.cae is null or new.cae_vencimiento is null) then
    raise exception 'Un comprobante electrónico autorizado necesita el CAE y su vencimiento.'
      using errcode = 'CM005', hint = 'punto_venta_inconsistente';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_comprobante_validar() from anon, authenticated, public;

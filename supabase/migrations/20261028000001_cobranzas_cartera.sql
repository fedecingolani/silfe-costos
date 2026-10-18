-- =====================================================================
-- Silfe Costos - Cobranzas: contador de recibos protegido (Fase 8, Ventas)
--
-- Contador de recibos (recibo_punto_venta.ultimo_numero):
--   La RLS de 20261026000002_rls_cobranzas.sql le daba a authenticated
--   insert, update y delete sobre recibo_punto_venta: cualquier sesión
--   podía mover ultimo_numero y romper la numeración sin huecos (o
--   habilitar un número repetido). Desde acá authenticated sólo lee la
--   tabla; los puntos de venta de recibos los crea o activa el
--   administrador (postgres / service_role) desde una migración o el
--   dashboard.
--
--   emitir_recibo pasa a security definer para poder avanzar el contador.
--   Es seguro porque:
--   - tiene search_path vacío y nombres calificados (sin secuestro de
--     objetos);
--   - hace sólo lo mínimo: bloquea el recibo en borrador, bloquea el
--     contador de su punto de venta, lo avanza en 1 y emite ese recibo
--     con ese número. No recibe el número ni el punto de venta desde
--     afuera;
--   - los triggers del recibo (fn_recibo_validar) siguen controlando la
--     emisión entera (medios, total, imputaciones, contado, número = el
--     recién tomado): si algo falla se deshace todo, contador incluido;
--   - auth.uid() lee el JWT de la sesión, no el rol: la auditoría no
--     cambia;
--   - authenticated ya tenía acceso completo a recibo (RLS "using
--     (true)"): el definer no le da acceso a filas que no viera.
--   No se usa un ayudante definer separado ("tomar número"): habría que
--   darle execute a authenticated y podría quemar números sin emitir,
--   que es justo el hueco que se quiere cerrar.
-- =====================================================================

-- ----- Contador de recibos: sólo lectura para authenticated ---------------------

drop policy if exists "recibo_punto_venta_insert_autenticado" on public.recibo_punto_venta;
drop policy if exists "recibo_punto_venta_update_autenticado" on public.recibo_punto_venta;
drop policy if exists "recibo_punto_venta_delete_autenticado" on public.recibo_punto_venta;

revoke insert, update, delete, truncate on public.recibo_punto_venta from authenticated;

alter function public.emitir_recibo(uuid) security definer;

comment on function public.emitir_recibo(uuid) is
  'Emite un recibo en borrador: le asigna el número siguiente de su punto de venta y lo deja inmutable. '
  'Security definer: es la única vía para avanzar recibo_punto_venta.ultimo_numero. Devuelve el número';

-- =====================================================================
-- Cartera de cheques y rechazo con nota de débito obligatoria
--
-- Cartera (v_cheque_cartera): los cheques de recibos emitidos, sin los
-- anulados (su recibo se anuló). Los de un borrador todavía no entraron.
--
-- Rechazo (rechazar_cheque): en una sola transacción crea el borrador de
-- la nota de débito al cliente (con guardar_borrador_comprobante, las
-- mismas reglas que cualquier borrador) y pasa el cheque a rechazado con
-- esa ND. La ND se arma acá, con los datos de la base, y no llega armada
-- desde la pantalla:
--   - ítem "Cheque rechazado N° … – Banco …" por el importe, no gravado;
--   - si hay gastos bancarios, un segundo ítem gravado al 21%;
--   - asociada a las facturas que canceló el recibo del cheque (su letra;
--     si son de letras distintas, error); si el recibo fue a cuenta, al
--     período del 1° del mes del recibo a la fecha del recibo (letra del
--     cliente);
--   - cuenta corriente, fecha de hoy, punto de venta electrónico activo
--     más bajo; el ambiente lo pone guardar_borrador_comprobante.
-- Es el mismo armado que armarNotaDebitoRechazo (src/lib/cobranzas/
-- cheques.ts), que la pantalla usa para mostrar antes qué se va a crear.
--
-- "Obliga": un cheque rechazado siempre tiene su ND (cheque_rechazado_check,
-- CB018) y esa ND no se puede borrar ni cambiar de cliente o clase
-- (trg_comprobante_nd_cheque, CB020). Mientras es borrador, el cheque está
-- "rechazado – ND pendiente"; al autorizarse, es un débito más.
--
-- Errores nuevos:
--   CB020 nd_cheque_rechazado  (borrar o cambiar de cliente la ND de un rechazo)
--   CB021 cheque_inexistente
--   CB022 gastos_invalidos
-- =====================================================================

-- ----- Cartera ----------------------------------------------------------------

create view v_cheque_cartera
with (security_invoker = true) as
select
  ch.id,
  ch.recibo_id,
  ch.cliente_id,
  ch.tipo,
  ch.banco,
  ch.numero,
  ch.fecha_emision,
  ch.fecha_pago,
  ch.librador,
  ch.librador_cuit,
  ch.importe,
  ch.estado,
  ch.estado_fecha,
  ch.entregado_a,
  ch.nd_comprobante_id,
  r.numero_texto as recibo_numero_texto,
  r.fecha as recibo_fecha,
  cl.razon_social,
  cl.cuit,
  cl.cuit_digitos,
  cl.codigo_legado,
  nd.estado as nd_estado,
  case when nd.numero is not null then
    nd.letra || '-' || lpad(nd.punto_venta::text, 5, '0') || '-' || lpad(nd.numero::text, 8, '0')
  end as nd_numero_texto
from cheque ch
join recibo r on r.id = ch.recibo_id and r.estado = 'emitido'
join cliente cl on cl.id = ch.cliente_id
left join comprobante nd on nd.id = ch.nd_comprobante_id
where ch.estado <> 'anulado';

comment on view v_cheque_cartera is
  'Cartera de cheques: los de recibos emitidos (sin borradores ni anulados), con cliente, recibo y la ND del rechazo';

-- ----- La ND de un rechazo no se borra ----------------------------------------

create or replace function public.fn_comprobante_nd_cheque()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cheque record;
begin
  select ch.numero, ch.banco into v_cheque
  from public.cheque ch
  where ch.nd_comprobante_id = old.id
  limit 1;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Es la nota de débito del cheque rechazado N° % (%): no se puede borrar. Revisala y autorizala.',
      v_cheque.numero, v_cheque.banco
      using errcode = 'CB020', hint = 'nd_cheque_rechazado';
  end if;
  if new.cliente_id is distinct from old.cliente_id or new.clase is distinct from old.clase then
    raise exception 'Es la nota de débito del cheque rechazado N° % (%): no cambia de cliente ni de tipo.',
      v_cheque.numero, v_cheque.banco
      using errcode = 'CB020', hint = 'nd_cheque_rechazado';
  end if;
  return new;
end;
$$;

create trigger trg_comprobante_nd_cheque before delete or update of cliente_id, clase on comprobante
  for each row execute function public.fn_comprobante_nd_cheque();

-- ----- Rechazo ------------------------------------------------------------------

-- p_fecha: fecha del rechazo (null: hoy). p_gastos: null o
-- { importe, descripcion } (gastos bancarios con IVA 21%; importe 0 = sin gastos).
create or replace function public.rechazar_cheque(
  p_cheque_id uuid,
  p_fecha date,
  p_observacion text,
  p_gastos jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_cheque record;
  v_recibo record;
  v_condicion text;
  v_gasto numeric := 0;
  v_gasto_descripcion text;
  v_iva numeric := 0;
  v_facturas integer;
  v_letras text[];
  v_letra text;
  v_asociados jsonb;
  v_desde date;
  v_hasta date;
  v_pv integer;
  v_items jsonb;
  v_nd uuid;
begin
  select ch.id, ch.recibo_id, ch.cliente_id, ch.numero, ch.banco, ch.importe, ch.estado into v_cheque
  from public.cheque ch
  where ch.id = p_cheque_id
  for update;
  if not found then
    raise exception 'No se encontró el cheque.'
      using errcode = 'CB021', hint = 'cheque_inexistente';
  end if;
  select r.estado, r.fecha into v_recibo from public.recibo r where r.id = v_cheque.recibo_id;
  if v_recibo.estado <> 'emitido' or v_cheque.estado not in ('en_cartera', 'depositado', 'entregado') then
    raise exception 'Un cheque % (recibo %) no se puede rechazar.', v_cheque.estado, v_recibo.estado
      using errcode = 'CB009', hint = 'cheque_transicion_invalida';
  end if;

  -- Gastos bancarios
  if p_gastos is not null and jsonb_typeof(p_gastos) <> 'null' then
    if jsonb_typeof(p_gastos) <> 'object' or jsonb_typeof(coalesce(p_gastos->'importe', 'null'::jsonb)) not in ('number', 'null') then
      raise exception 'Los gastos bancarios no son válidos.'
        using errcode = 'CB022', hint = 'gastos_invalidos';
    end if;
    v_gasto := coalesce((p_gastos->>'importe')::numeric, 0);
    v_gasto_descripcion := nullif(btrim(p_gastos->>'descripcion'), '');
    if v_gasto < 0 or v_gasto <> round(v_gasto, 2) then
      raise exception 'El importe de los gastos bancarios tiene que ser positivo, con hasta 2 decimales.'
        using errcode = 'CB022', hint = 'gastos_invalidos';
    end if;
    if v_gasto > 0 and v_gasto_descripcion is null then
      raise exception 'Completá la descripción de los gastos bancarios.'
        using errcode = 'CB022', hint = 'gastos_invalidos';
    end if;
  end if;

  -- Asociación: las facturas que canceló el recibo, o el período del recibo.
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object('asociado_id', f.id) order by f.fecha, f.numero, f.id), '[]'::jsonb),
         array_agg(distinct f.letra order by f.letra) filter (where f.letra is not null)
    into v_facturas, v_asociados, v_letras
  from (
    select distinct c.id, c.fecha, c.numero, c.letra
    from public.imputacion i
    join public.comprobante c on c.id = i.comprobante_id
    where i.recibo_id = v_cheque.recibo_id and c.clase = 'factura'
  ) f;

  if v_facturas > 0 then
    if v_letras is null then
      raise exception 'Las facturas que canceló el recibo del cheque no tienen letra: no se puede armar la nota de débito.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    if array_length(v_letras, 1) > 1 then
      raise exception 'El recibo del cheque canceló facturas %: la nota de débito lleva una sola letra.',
        array_to_string(v_letras, ' y ')
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    v_letra := v_letras[1];
  else
    select cl.condicion_iva into v_condicion from public.cliente cl where cl.id = v_cheque.cliente_id;
    v_letra := case v_condicion
      when 'Responsable Inscripto' then 'A'
      when 'Monotributista' then 'A'
      when 'Exento' then 'B'
      when 'Consumidor Final' then 'B'
    end;
    if v_letra is null then
      raise exception 'Completá la condición frente al IVA del cliente.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
    v_desde := date_trunc('month', v_recibo.fecha)::date;
    v_hasta := v_recibo.fecha;
    if v_hasta > v_hoy then
      raise exception 'Período asociado: el hasta no puede ser posterior a la fecha de la nota.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
  end if;

  select min(pv.numero) into v_pv from public.punto_venta pv where pv.activo and pv.electronico;
  if v_pv is null then
    raise exception 'No hay ningún punto de venta electrónico activo.'
      using errcode = 'CB018', hint = 'nd_invalida';
  end if;

  -- Ítems: el capital no gravado y, si hay, los gastos al 21%.
  v_iva := round(v_gasto * 0.21, 2);
  v_items := jsonb_build_array(jsonb_build_object(
    'producto_id', null, 'codigo', null, 'observaciones', null, 'unidad', null,
    'descripcion', format('Cheque rechazado N° %s – %s', v_cheque.numero, v_cheque.banco),
    'cantidad', 1, 'precio_unitario', v_cheque.importe, 'descuento_pct', 0,
    'gravado', false, 'alicuota_iva', null, 'importe', v_cheque.importe, 'iva', 0
  ));
  if v_gasto > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'producto_id', null, 'codigo', null, 'observaciones', null, 'unidad', null,
      'descripcion', v_gasto_descripcion,
      'cantidad', 1, 'precio_unitario', v_gasto, 'descuento_pct', 0,
      'gravado', true, 'alicuota_iva', 21, 'importe', v_gasto, 'iva', v_iva
    ));
  end if;

  v_nd := public.guardar_borrador_comprobante(
    null,
    jsonb_build_object(
      'punto_venta', v_pv,
      'clase', 'nota_debito',
      'letra', v_letra,
      'tipo_arca', case v_letra when 'A' then 2 else 7 end,
      'fecha', v_hoy,
      'fecha_vencimiento_pago', v_hoy,
      'cliente_id', v_cheque.cliente_id,
      'lista_precio_id', null,
      'condicion_pago', 'cuenta_corriente',
      'observaciones', null,
      'periodo_asoc_desde', v_desde,
      'periodo_asoc_hasta', v_hasta,
      'neto', v_gasto,
      'no_gravado', v_cheque.importe,
      'iva', v_iva,
      'total', v_gasto + v_cheque.importe + v_iva
    ),
    v_items,
    v_asociados
  );

  -- El cambio de estado (y su historial, por trigger) en la misma transacción.
  update public.cheque
  set estado = 'rechazado',
      nd_comprobante_id = v_nd,
      estado_fecha = coalesce(p_fecha, v_hoy),
      estado_observacion = nullif(btrim(p_observacion), '')
  where id = v_cheque.id;

  return v_nd;
end;
$$;

comment on function public.rechazar_cheque(uuid, date, text, jsonb) is
  'Rechaza un cheque de la cartera: crea el borrador de la nota de débito al cliente y deja el cheque rechazado con ella, en una transacción. Devuelve el id de la ND';

-- ----- Permisos -------------------------------------------------------------------

revoke all on public.v_cheque_cartera from anon;
grant select on public.v_cheque_cartera to authenticated;

revoke execute on function public.fn_comprobante_nd_cheque() from anon, authenticated, public;

revoke execute on function public.rechazar_cheque(uuid, date, text, jsonb) from public, anon;
grant execute on function public.rechazar_cheque(uuid, date, text, jsonb) to authenticated;

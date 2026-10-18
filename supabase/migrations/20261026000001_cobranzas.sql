-- =====================================================================
-- Silfe Costos - Cobranzas, cartera de cheques y cuenta corriente
-- (Fase 8, Ventas)
--
-- Recibos con sus medios de pago (efectivo, transferencia, cheque, e-cheq
-- y retenciones), cheques con su historial de estados, imputaciones de
-- recibos y notas de crédito a facturas y notas de débito, y las vistas de
-- saldo y cuenta corriente.
--
-- Ciclo de vida del recibo:
--   borrador -> emitido -> anulado
-- Un borrador se edita y se borra libremente (con sus medios, cheques e
-- imputaciones). Al emitirlo (emitir_recibo) toma número y queda inmutable,
-- con sus medios e imputaciones. Sólo se le agregan imputaciones
-- automáticas (la aplicación de su saldo a favor). Se corrige anulándolo
-- (anular_recibo): se deshacen todas sus imputaciones y sus cheques salen
-- de la cartera (estado "anulado"). Las reglas viven en triggers, así que
-- valen también para SQL directo.
--
-- Numeración: tabla recibo_punto_venta (se crea el 1). El contador
-- ultimo_numero se toma con select ... for update dentro de la misma
-- transacción que emite: sin huecos (si la emisión falla, se deshace el
-- contador) y sin carreras. El trigger exige que el número emitido sea el
-- recién tomado del contador. Formato R-00001-00000001.
--
-- Débitos (cuenta corriente): facturas y notas de débito autorizadas de
-- producción o de puntos de venta no electrónicos (ambiente vacío). Los de
-- homologación son de prueba: no reciben imputaciones ni aparecen en las
-- vistas.
-- Créditos: recibos emitidos y notas de crédito autorizadas (producción o
-- no electrónicas). Lo no imputado de un crédito es saldo a favor. Una
-- nota de crédito cuenta siempre por su total en el haber: lo que se
-- imputa (a su asociado u otro débito) baja el saldo de ese débito, y el
-- resto queda a favor.
--
-- Una imputación cuenta (vigente) si sale de un recibo emitido o de una
-- nota de crédito. Las de un borrador no cancelan nada todavía, pero sí
-- cuentan para el tope del propio recibo.
--
-- Errores (SQLSTATE propio, estable; el HINT repite el motivo como clave):
--   CB001 recibo_inmutable           (recibo emitido/anulado, sus medios e imputaciones)
--   CB002 transicion_invalida        (estado del recibo)
--   CB003 recibo_sin_medios
--   CB004 total_distinto_medios
--   CB005 imputacion_excede_credito  (más que el total del recibo o la nota de crédito)
--   CB006 imputacion_excede_saldo    (más que el saldo pendiente del débito)
--   CB007 debito_invalido
--   CB008 cliente_distinto
--   CB009 cheque_transicion_invalida
--   CB010 cheque_fuera_de_cartera    (no se anula un recibo con cheques movidos)
--   CB011 historial_inmutable
--   CB012 medio_invalido
--   CB013 recibo_inexistente
--   CB014 numeracion_invalida
--   CB015 contado_invalido
--   CB016 credito_invalido           (origen nota de crédito)
--   CB017 cheque_bloqueado
--   CB018 nd_invalida                (nota de débito del rechazo)
--   CB019 motivo_requerido
-- =====================================================================

-- ----- Punto de venta de recibos y su contador -----------------------------

create table recibo_punto_venta (
  numero         integer primary key,
  nombre         text,
  activo         boolean not null default true,
  ultimo_numero  bigint not null default 0,
  creado_en      timestamptz not null default now(),
  constraint recibo_punto_venta_numero_check check (numero between 1 and 99999),
  constraint recibo_punto_venta_ultimo_check check (ultimo_numero >= 0)
);

comment on table recibo_punto_venta is
  'Puntos de venta propios de los recibos (numeración interna, sin ARCA). El contador se toma al emitir';
comment on column recibo_punto_venta.ultimo_numero is
  'Último número emitido. emitir_recibo lo toma con select ... for update en la misma transacción';

insert into recibo_punto_venta (numero, nombre) values (1, 'Recibos') on conflict (numero) do nothing;

-- ----- Recibo ----------------------------------------------------------------

create table recibo (
  id                      uuid primary key default gen_random_uuid(),
  punto_venta             integer not null default 1 references recibo_punto_venta(numero),
  numero                  bigint,
  numero_texto            text generated always as (
    case when numero is null then null
      else 'R-' || lpad(punto_venta::text, 5, '0') || '-' || lpad(numero::text, 8, '0') end
  ) stored,
  fecha                   date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  cliente_id              uuid not null references cliente(id) on delete restrict,
  total                   numeric(14,2) not null default 0,
  estado                  text not null default 'borrador',
  motivo_anulacion        text,
  comprobante_contado_id  uuid references comprobante(id) on delete restrict,
  observaciones           text,
  creado_por              uuid default auth.uid(),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),
  emitido_en              timestamptz,
  anulado_en              timestamptz,
  constraint recibo_estado_check check (estado in ('borrador', 'emitido', 'anulado')),
  constraint recibo_total_check check (total >= 0),
  constraint recibo_numero_check check ((numero is null) = (estado = 'borrador') and (numero is null or numero > 0)),
  constraint recibo_anulado_check check (
    estado <> 'anulado' or (motivo_anulacion is not null and btrim(motivo_anulacion) <> '' and anulado_en is not null)
  )
);

comment on table recibo is
  'Recibos de cobranza (cuenta corriente o pago de una factura de contado). Un emitido no se modifica: se anula';
comment on column recibo.numero is 'Número dentro del punto de venta de recibos. Vacío en borrador';
comment on column recibo.numero_texto is 'Número para mostrar: R-00001-00000001';
comment on column recibo.total is 'Suma de los medios de pago (se exige al emitir)';
comment on column recibo.estado is 'borrador | emitido | anulado';
comment on column recibo.comprobante_contado_id is
  'Pago de una factura o nota de débito de contado: una única imputación por su total exacto';

create unique index recibo_numero_unico on recibo (punto_venta, numero) where numero is not null;
create unique index recibo_contado_unico on recibo (comprobante_contado_id) where estado = 'emitido';
create index recibo_cliente_idx on recibo (cliente_id);
create index recibo_fecha_idx on recibo (fecha desc);

create trigger trg_recibo_actualizado before update on recibo
  for each row execute function fn_set_actualizado_en();

-- ----- Cheques -----------------------------------------------------------------

create table cheque (
  id                  uuid primary key default gen_random_uuid(),
  recibo_id           uuid not null references recibo(id) on delete cascade,
  cliente_id          uuid not null references cliente(id) on delete restrict,
  tipo                text not null,
  banco               text not null,
  numero              text not null,
  fecha_emision       date,
  fecha_pago          date not null,
  librador            text,
  librador_cuit       text,
  importe             numeric(14,2) not null,
  estado              text not null default 'en_cartera',
  estado_fecha        date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  estado_observacion  text,
  entregado_a         text,
  nd_comprobante_id   uuid references comprobante(id) on delete restrict,
  creado_en           timestamptz not null default now(),
  constraint cheque_tipo_check check (tipo in ('fisico', 'echeq')),
  constraint cheque_estado_check check (estado in ('en_cartera', 'depositado', 'entregado', 'rechazado', 'anulado')),
  constraint cheque_banco_check check (btrim(banco) <> ''),
  constraint cheque_numero_check check (btrim(numero) <> ''),
  constraint cheque_importe_check check (importe > 0),
  constraint cheque_librador_cuit_check check (librador_cuit ~ '^\d{11}$'),
  constraint cheque_entregado_check check (estado <> 'entregado' or (entregado_a is not null and btrim(entregado_a) <> '')),
  constraint cheque_rechazado_check check ((estado = 'rechazado') = (nd_comprobante_id is not null))
);

comment on table cheque is
  'Cartera de cheques recibidos. Sólo estados, sin contabilidad bancaria. Cuenta en la cartera cuando su recibo está emitido';
comment on column cheque.estado is
  'en_cartera -> depositado | entregado | rechazado; depositado -> rechazado; entregado -> rechazado. anulado: su recibo se anuló';
comment on column cheque.estado_fecha is 'Fecha del último cambio de estado (va al historial)';
comment on column cheque.estado_observacion is 'Observación del último cambio de estado (va al historial)';
comment on column cheque.entregado_a is 'A quién se entregó (texto libre: proveedor). Obligatorio si está entregado';
comment on column cheque.nd_comprobante_id is 'Nota de débito al cliente por el rechazo. Obligatoria si está rechazado';

create index cheque_recibo_idx on cheque (recibo_id);
create index cheque_cliente_idx on cheque (cliente_id);
create index cheque_estado_idx on cheque (estado, fecha_pago);
create index cheque_nd_idx on cheque (nd_comprobante_id);

create table cheque_estado (
  id           bigint generated always as identity primary key,
  cheque_id    uuid not null references cheque(id) on delete cascade,
  estado       text not null,
  fecha        date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  observacion  text,
  creado_por   uuid default auth.uid(),
  creado_en    timestamptz not null default now(),
  constraint cheque_estado_estado_check check (estado in ('en_cartera', 'depositado', 'entregado', 'rechazado', 'anulado'))
);

comment on table cheque_estado is
  'Historial de estados de cada cheque. Lo escribe el trigger del cheque; no se modifica ni se borra';

create index cheque_estado_cheque_idx on cheque_estado (cheque_id, id);

-- ----- Medios de pago ----------------------------------------------------------

create table recibo_medio (
  id                      uuid primary key default gen_random_uuid(),
  recibo_id               uuid not null references recibo(id) on delete cascade,
  orden                   integer not null default 0,
  tipo                    text not null,
  importe                 numeric(14,2) not null,
  banco                   text,
  referencia              text,
  cheque_id               uuid unique references cheque(id),
  retencion_tipo          text,
  retencion_jurisdiccion  text,
  certificado             text,
  fecha_retencion         date,
  constraint recibo_medio_tipo_check check (tipo in ('efectivo', 'transferencia', 'cheque', 'echeq', 'retencion')),
  constraint recibo_medio_importe_check check (importe > 0),
  constraint recibo_medio_cheque_check check ((tipo in ('cheque', 'echeq')) = (cheque_id is not null)),
  constraint recibo_medio_retencion_check check (
    (tipo = 'retencion'
      and retencion_tipo in ('iibb', 'ganancias', 'iva', 'suss')
      and certificado is not null and btrim(certificado) <> ''
      and fecha_retencion is not null
      and (retencion_tipo <> 'iibb' or (retencion_jurisdiccion is not null and btrim(retencion_jurisdiccion) <> '')))
    or
    (tipo <> 'retencion'
      and retencion_tipo is null and retencion_jurisdiccion is null and certificado is null and fecha_retencion is null)
  )
);

comment on table recibo_medio is 'Medios de pago de un recibo. El total del recibo es su suma';
comment on column recibo_medio.banco is 'Transferencia: banco o cuenta destino';
comment on column recibo_medio.referencia is 'Transferencia: referencia de la operación';
comment on column recibo_medio.cheque_id is 'Cheque o e-cheq: el cheque que entra a la cartera (mismo importe)';
comment on column recibo_medio.retencion_tipo is 'Retención: iibb | ganancias | iva | suss';
comment on column recibo_medio.retencion_jurisdiccion is 'Retención de IIBB: jurisdicción (obligatoria)';

create index recibo_medio_recibo_idx on recibo_medio (recibo_id, orden);

-- ----- Imputaciones -------------------------------------------------------------

create table imputacion (
  id               uuid primary key default gen_random_uuid(),
  recibo_id        uuid references recibo(id) on delete cascade,
  nota_credito_id  uuid references comprobante(id) on delete restrict,
  comprobante_id   uuid not null references comprobante(id) on delete restrict,
  importe          numeric(14,2) not null,
  fecha            date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  automatica       boolean not null default false,
  creado_por       uuid default auth.uid(),
  creado_en        timestamptz not null default now(),
  constraint imputacion_origen_check check (num_nonnulls(recibo_id, nota_credito_id) = 1),
  constraint imputacion_importe_check check (importe > 0)
);

comment on table imputacion is
  'Cancelación de un débito (factura o nota de débito) con un recibo o una nota de crédito';
comment on column imputacion.automatica is 'true: aplicación automática de saldo a favor (o de una nota de crédito)';

create unique index imputacion_recibo_unica on imputacion (recibo_id, comprobante_id) where recibo_id is not null;
create unique index imputacion_nc_unica on imputacion (nota_credito_id, comprobante_id) where nota_credito_id is not null;
create index imputacion_comprobante_idx on imputacion (comprobante_id);

-- ----- Ayudas ----------------------------------------------------------------------

-- Débito de cuenta corriente: factura o nota de débito autorizada, de
-- producción o de un punto de venta no electrónico.
create or replace function public.fn_es_debito_cc(p_clase text, p_estado text, p_ambiente text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_clase in ('factura', 'nota_debito') and p_estado = 'autorizado'
    and (p_ambiente is null or p_ambiente = 'produccion');
$$;

create or replace function public.fn_es_nota_credito_cc(p_clase text, p_estado text, p_ambiente text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_clase = 'nota_credito' and p_estado = 'autorizado'
    and (p_ambiente is null or p_ambiente = 'produccion');
$$;

-- Lo imputado a un débito por imputaciones vigentes (recibo emitido o nota
-- de crédito), más las del recibo p_recibo aunque sea borrador, sin contar
-- la imputación p_excluir.
create or replace function public.fn_imputado_debito(p_comprobante uuid, p_recibo uuid, p_excluir uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(i.importe), 0)
  from public.imputacion i
  left join public.recibo r on r.id = i.recibo_id
  where i.comprobante_id = p_comprobante
    and i.id is distinct from p_excluir
    and (i.nota_credito_id is not null or r.estado = 'emitido' or i.recibo_id = p_recibo);
$$;

-- ----- Recibo: estado, emisión e inmutabilidad -------------------------------------

create or replace function public.fn_recibo_validar_contado(p_recibo public.recibo)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_c record;
begin
  if p_recibo.comprobante_contado_id is null then
    return;
  end if;
  select c.clase, c.estado, c.ambiente, c.cliente_id, c.condicion_pago, c.total into v_c
  from public.comprobante c
  where c.id = p_recibo.comprobante_contado_id;
  if not found or not public.fn_es_debito_cc(v_c.clase, v_c.estado, v_c.ambiente) then
    raise exception 'El pago de contado es de una factura o nota de débito autorizada de producción.'
      using errcode = 'CB007', hint = 'debito_invalido';
  end if;
  if v_c.cliente_id <> p_recibo.cliente_id then
    raise exception 'El recibo y la factura de contado son de clientes distintos.'
      using errcode = 'CB008', hint = 'cliente_distinto';
  end if;
  if v_c.condicion_pago <> 'contado' then
    raise exception 'El comprobante es de cuenta corriente: su pago se registra con una cobranza, no como pago de contado.'
      using errcode = 'CB015', hint = 'contado_invalido';
  end if;
end;
$$;

create or replace function public.fn_recibo_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ultimo bigint;
  v_suma numeric;
  v_cantidad integer;
  v_fila record;
  v_contado record;
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Un recibo se crea en borrador (se recibió "%").', new.estado
        using errcode = 'CB002', hint = 'transicion_invalida';
    end if;
    perform public.fn_recibo_validar_contado(new);
    return new;
  end if;

  -- UPDATE
  if old.estado = 'anulado' then
    raise exception 'El recibo está anulado: no se puede modificar.'
      using errcode = 'CB001', hint = 'recibo_inmutable';
  end if;

  if old.estado = 'emitido' then
    if new.estado = 'emitido' then
      raise exception 'El recibo está emitido: no se puede modificar. Si se cargó mal, anulalo.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if new.estado <> 'anulado' then
      raise exception 'Un recibo no puede pasar de % a %.', old.estado, new.estado
        using errcode = 'CB002', hint = 'transicion_invalida';
    end if;
    if new.punto_venta is distinct from old.punto_venta
      or new.numero is distinct from old.numero
      or new.fecha is distinct from old.fecha
      or new.cliente_id is distinct from old.cliente_id
      or new.total is distinct from old.total
      or new.comprobante_contado_id is distinct from old.comprobante_contado_id
      or new.observaciones is distinct from old.observaciones
      or new.emitido_en is distinct from old.emitido_en
      or new.creado_por is distinct from old.creado_por
      or new.creado_en is distinct from old.creado_en
    then
      raise exception 'Al anular un recibo sólo se registra el motivo.'
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if new.motivo_anulacion is null or btrim(new.motivo_anulacion) = '' then
      raise exception 'Para anular el recibo, indicá el motivo.'
        using errcode = 'CB019', hint = 'motivo_requerido';
    end if;
    if exists (select 1 from public.cheque ch where ch.recibo_id = new.id and ch.estado <> 'en_cartera') then
      raise exception 'El recibo tiene cheques que ya salieron de la cartera (depositados, entregados o rechazados): no se puede anular.'
        using errcode = 'CB010', hint = 'cheque_fuera_de_cartera';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_en := now();
    return new;
  end if;

  -- Desde borrador
  if new.estado = 'anulado' then
    raise exception 'Un recibo en borrador no se anula: se borra.'
      using errcode = 'CB002', hint = 'transicion_invalida';
  end if;

  perform public.fn_recibo_validar_contado(new);

  if new.estado = 'borrador' then
    return new;
  end if;

  -- borrador -> emitido
  select p.ultimo_numero into v_ultimo
  from public.recibo_punto_venta p
  where p.numero = new.punto_venta;
  if new.numero is null or v_ultimo is null or new.numero <> v_ultimo then
    raise exception 'El número del recibo lo asigna emitir_recibo.'
      using errcode = 'CB014', hint = 'numeracion_invalida';
  end if;

  select count(*), coalesce(sum(m.importe), 0) into v_cantidad, v_suma
  from public.recibo_medio m
  where m.recibo_id = new.id;
  if v_cantidad = 0 then
    raise exception 'El recibo no tiene medios de pago: cargá al menos uno.'
      using errcode = 'CB003', hint = 'recibo_sin_medios';
  end if;
  if v_suma <> new.total then
    raise exception 'El total del recibo ($ %) no coincide con la suma de sus medios de pago ($ %).', new.total, v_suma
      using errcode = 'CB004', hint = 'total_distinto_medios';
  end if;

  -- Cheques: cada uno con su medio, del mismo importe, tipo y cliente.
  if exists (
    select 1
    from public.cheque ch
    left join public.recibo_medio m on m.cheque_id = ch.id and m.recibo_id = new.id
    where ch.recibo_id = new.id
      and (m.id is null or m.importe <> ch.importe
        or (m.tipo = 'cheque' and ch.tipo <> 'fisico') or (m.tipo = 'echeq' and ch.tipo <> 'echeq'))
  ) then
    raise exception 'Cada cheque del recibo tiene que estar en un medio de pago de su mismo tipo e importe.'
      using errcode = 'CB012', hint = 'medio_invalido';
  end if;
  if exists (select 1 from public.cheque ch where ch.recibo_id = new.id and ch.cliente_id <> new.cliente_id) then
    raise exception 'Los cheques del recibo son de otro cliente.'
      using errcode = 'CB008', hint = 'cliente_distinto';
  end if;

  -- Imputaciones: del mismo cliente, sin superar el total ni el saldo de cada débito.
  if (select coalesce(sum(i.importe), 0) from public.imputacion i where i.recibo_id = new.id) > new.total then
    raise exception 'Las imputaciones superan el total del recibo ($ %).', new.total
      using errcode = 'CB005', hint = 'imputacion_excede_credito';
  end if;
  for v_fila in
    select c.id, c.cliente_id, c.total, c.letra, c.punto_venta, c.numero
    from public.imputacion i
    join public.comprobante c on c.id = i.comprobante_id
    where i.recibo_id = new.id
    order by c.id
    for update of c
  loop
    if v_fila.cliente_id <> new.cliente_id then
      raise exception 'El recibo imputa a un comprobante de otro cliente.'
        using errcode = 'CB008', hint = 'cliente_distinto';
    end if;
    if public.fn_imputado_debito(v_fila.id, new.id, null) > v_fila.total then
      raise exception 'Las imputaciones superan el saldo pendiente de %-%-%.',
        v_fila.letra, lpad(v_fila.punto_venta::text, 5, '0'), lpad(v_fila.numero::text, 8, '0')
        using errcode = 'CB006', hint = 'imputacion_excede_saldo';
    end if;
  end loop;

  -- Pago de contado: por el total exacto, con una única imputación a su comprobante.
  if new.comprobante_contado_id is not null then
    select c.total into v_contado from public.comprobante c where c.id = new.comprobante_contado_id;
    if new.total <> v_contado.total
      or (select count(*) from public.imputacion i where i.recibo_id = new.id) <> 1
      or not exists (
        select 1 from public.imputacion i
        where i.recibo_id = new.id and i.comprobante_id = new.comprobante_contado_id and i.importe = v_contado.total
      )
    then
      raise exception 'El pago de una factura de contado es por su total exacto ($ %), imputado a esa factura.', v_contado.total
        using errcode = 'CB015', hint = 'contado_invalido';
    end if;
  end if;

  new.emitido_en := now();
  return new;
end;
$$;

-- Al anular: se deshacen sus imputaciones (los débitos vuelven a quedar
-- pendientes) y sus cheques, todos en cartera, pasan a "anulado".
create or replace function public.fn_recibo_anulado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.imputacion where recibo_id = new.id;
  update public.cheque
  set estado = 'anulado',
      estado_fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date,
      estado_observacion = 'Recibo anulado: ' || new.motivo_anulacion
  where recibo_id = new.id and estado = 'en_cartera';
  return null;
end;
$$;

create or replace function public.fn_recibo_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'El recibo está %: no se puede borrar. Si se cargó mal, anulalo.', old.estado
      using errcode = 'CB001', hint = 'recibo_inmutable';
  end if;
  return old;
end;
$$;

create trigger trg_recibo_validar before insert or update on recibo
  for each row execute function public.fn_recibo_validar();

create trigger trg_recibo_anulado after update on recibo
  for each row when (old.estado = 'emitido' and new.estado = 'anulado')
  execute function public.fn_recibo_anulado();

create trigger trg_recibo_borrar before delete on recibo
  for each row execute function public.fn_recibo_borrar();

-- ----- Medios: sólo en borrador ------------------------------------------------------

create or replace function public.fn_recibo_medio_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estado text;
  v_cheque record;
begin
  select r.estado into v_estado
  from public.recibo r
  where r.id = case when tg_op = 'DELETE' then old.recibo_id else new.recibo_id end;

  if tg_op = 'UPDATE' and new.recibo_id is distinct from old.recibo_id then
    raise exception 'Un medio de pago no cambia de recibo.'
      using errcode = 'CB012', hint = 'medio_invalido';
  end if;

  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'El recibo está %: sus medios de pago no se pueden cambiar.', v_estado
      using errcode = 'CB001', hint = 'recibo_inmutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.cheque_id is not null then
    select ch.recibo_id, ch.tipo, ch.importe into v_cheque from public.cheque ch where ch.id = new.cheque_id;
    if not found or v_cheque.recibo_id <> new.recibo_id
      or v_cheque.importe <> new.importe
      or (new.tipo = 'cheque' and v_cheque.tipo <> 'fisico')
      or (new.tipo = 'echeq' and v_cheque.tipo <> 'echeq')
    then
      raise exception 'El medio de pago tiene que llevar un cheque del mismo recibo, tipo (físico o e-cheq) e importe.'
        using errcode = 'CB012', hint = 'medio_invalido';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_recibo_medio_validar before insert or update or delete on recibo_medio
  for each row execute function public.fn_recibo_medio_validar();

-- ----- Cheques: alta, datos y transiciones -------------------------------------------

create or replace function public.fn_cheque_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recibo record;
  v_nd record;
begin
  select r.estado, r.cliente_id into v_recibo
  from public.recibo r
  where r.id = case when tg_op = 'DELETE' then old.recibo_id else new.recibo_id end;

  if tg_op = 'DELETE' then
    if v_recibo.estado is null or v_recibo.estado = 'borrador' then
      return old;
    end if;
    raise exception 'El cheque es de un recibo %: no se puede borrar.', v_recibo.estado
      using errcode = 'CB001', hint = 'recibo_inmutable';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'en_cartera' then
      raise exception 'Un cheque entra a la cartera en estado en_cartera.'
        using errcode = 'CB009', hint = 'cheque_transicion_invalida';
    end if;
    if v_recibo.estado <> 'borrador' then
      raise exception 'El recibo está %: no se le agregan cheques.', v_recibo.estado
        using errcode = 'CB001', hint = 'recibo_inmutable';
    end if;
    if new.cliente_id <> v_recibo.cliente_id then
      raise exception 'El cheque tiene que ser del cliente del recibo.'
        using errcode = 'CB008', hint = 'cliente_distinto';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.recibo_id is distinct from old.recibo_id then
    raise exception 'Un cheque no cambia de recibo.'
      using errcode = 'CB017', hint = 'cheque_bloqueado';
  end if;

  if v_recibo.estado = 'borrador' then
    if new.estado is distinct from old.estado then
      raise exception 'El cheque entra a la cartera cuando se emite el recibo: hasta entonces no cambia de estado.'
        using errcode = 'CB009', hint = 'cheque_transicion_invalida';
    end if;
    if new.cliente_id <> v_recibo.cliente_id then
      raise exception 'El cheque tiene que ser del cliente del recibo.'
        using errcode = 'CB008', hint = 'cliente_distinto';
    end if;
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'en_cartera' and new.estado in ('depositado', 'entregado', 'rechazado') and v_recibo.estado = 'emitido')
      or (old.estado in ('depositado', 'entregado') and new.estado = 'rechazado' and v_recibo.estado = 'emitido')
      or (old.estado = 'en_cartera' and new.estado = 'anulado' and v_recibo.estado = 'anulado')
    ) then
      raise exception 'Un cheque no puede pasar de % a %.', old.estado, new.estado
        using errcode = 'CB009', hint = 'cheque_transicion_invalida';
    end if;
  end if;

  if new.tipo is distinct from old.tipo
    or new.banco is distinct from old.banco
    or new.numero is distinct from old.numero
    or new.fecha_emision is distinct from old.fecha_emision
    or new.fecha_pago is distinct from old.fecha_pago
    or new.librador is distinct from old.librador
    or new.librador_cuit is distinct from old.librador_cuit
    or new.importe is distinct from old.importe
    or new.cliente_id is distinct from old.cliente_id
    or (old.nd_comprobante_id is not null and new.nd_comprobante_id is distinct from old.nd_comprobante_id)
  then
    raise exception 'El cheque es de un recibo emitido: sus datos no se pueden cambiar, sólo su estado.'
      using errcode = 'CB017', hint = 'cheque_bloqueado';
  end if;

  if new.nd_comprobante_id is not null and new.nd_comprobante_id is distinct from old.nd_comprobante_id then
    select c.clase, c.cliente_id into v_nd from public.comprobante c where c.id = new.nd_comprobante_id;
    if not found or v_nd.clase <> 'nota_debito' or v_nd.cliente_id <> new.cliente_id then
      raise exception 'El rechazo se vincula a una nota de débito al cliente del cheque.'
        using errcode = 'CB018', hint = 'nd_invalida';
    end if;
  end if;

  return new;
end;
$$;

-- Cada alta y cambio de estado queda en el historial.
create or replace function public.fn_cheque_historial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into public.cheque_estado (cheque_id, estado, fecha, observacion)
    values (new.id, new.estado, new.estado_fecha, new.estado_observacion);
  end if;
  return null;
end;
$$;

create trigger trg_cheque_validar before insert or update or delete on cheque
  for each row execute function public.fn_cheque_validar();

create trigger trg_cheque_historial after insert or update on cheque
  for each row execute function public.fn_cheque_historial();

-- Historial: sólo altas que reflejan el estado actual del cheque. Se borra
-- únicamente en cascada con su cheque (borrador).
create or replace function public.fn_cheque_estado_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.cheque ch where ch.id = new.cheque_id and ch.estado = new.estado) then
      return new;
    end if;
    raise exception 'El historial lo escribe el cambio de estado del cheque.'
      using errcode = 'CB011', hint = 'historial_inmutable';
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.cheque ch where ch.id = old.cheque_id) then
    return old;
  end if;
  raise exception 'El historial de un cheque no se modifica ni se borra.'
    using errcode = 'CB011', hint = 'historial_inmutable';
end;
$$;

create trigger trg_cheque_estado_inmutable before insert or update or delete on cheque_estado
  for each row execute function public.fn_cheque_estado_inmutable();

-- ----- Imputaciones ------------------------------------------------------------------

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
begin
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

create trigger trg_imputacion_validar before insert or update or delete on imputacion
  for each row execute function public.fn_imputacion_validar();

-- ----- Emisión y anulación -----------------------------------------------------------

-- Asigna el número en la misma transacción: bloquea el contador del punto
-- de venta (select ... for update), lo avanza y emite. Si alguna regla de
-- la emisión falla, se deshace todo, contador incluido: no quedan huecos.
create or replace function public.emitir_recibo(p_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estado text;
  v_pv integer;
  v_activo boolean;
  v_numero bigint;
begin
  select r.estado, r.punto_venta into v_estado, v_pv
  from public.recibo r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el recibo.'
      using errcode = 'CB013', hint = 'recibo_inexistente';
  end if;
  if v_estado <> 'borrador' then
    raise exception 'El recibo ya está %.', v_estado
      using errcode = 'CB002', hint = 'transicion_invalida';
  end if;

  select p.ultimo_numero + 1, p.activo into v_numero, v_activo
  from public.recibo_punto_venta p
  where p.numero = v_pv
  for update;
  if not v_activo then
    raise exception 'El punto de venta de recibos % no está activo.', v_pv
      using errcode = 'CB014', hint = 'numeracion_invalida';
  end if;

  update public.recibo_punto_venta set ultimo_numero = v_numero where numero = v_pv;
  update public.recibo set estado = 'emitido', numero = v_numero where id = p_id;
  return v_numero;
end;
$$;

comment on function public.emitir_recibo(uuid) is
  'Emite un recibo en borrador: le asigna el número siguiente de su punto de venta y lo deja inmutable. Devuelve el número';

create or replace function public.anular_recibo(p_id uuid, p_motivo text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estado text;
begin
  select r.estado into v_estado
  from public.recibo r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'No se encontró el recibo.'
      using errcode = 'CB013', hint = 'recibo_inexistente';
  end if;
  if v_estado <> 'emitido' then
    raise exception 'Sólo se anula un recibo emitido (está %).', v_estado
      using errcode = 'CB002', hint = 'transicion_invalida';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Para anular el recibo, indicá el motivo.'
      using errcode = 'CB019', hint = 'motivo_requerido';
  end if;
  update public.recibo set estado = 'anulado', motivo_anulacion = p_motivo where id = p_id;
end;
$$;

comment on function public.anular_recibo(uuid, text) is
  'Anula un recibo emitido con sus cheques en cartera: deshace sus imputaciones y saca sus cheques de la cartera';

-- ----- Vistas --------------------------------------------------------------------------

-- Saldo de cada débito de cuenta corriente.
create view v_comprobante_saldo
with (security_invoker = true) as
with imputado as (
  select i.comprobante_id, sum(i.importe) as imputado
  from imputacion i
  left join recibo r on r.id = i.recibo_id
  where i.nota_credito_id is not null or r.estado = 'emitido'
  group by i.comprobante_id
)
select
  c.id as comprobante_id,
  c.cliente_id,
  c.clase,
  c.letra,
  c.punto_venta,
  c.numero,
  c.letra || '-' || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0') as numero_texto,
  c.fecha,
  c.fecha_vencimiento_pago,
  c.condicion_pago,
  c.total,
  coalesce(im.imputado, 0) as imputado,
  c.total - coalesce(im.imputado, 0) as saldo,
  case
    when c.total - coalesce(im.imputado, 0) <= 0 then 'cancelado'
    when coalesce(im.imputado, 0) = 0 then 'pendiente'
    else 'parcial'
  end as estado_pago
from comprobante c
left join imputado im on im.comprobante_id = c.id
where public.fn_es_debito_cc(c.clase, c.estado, c.ambiente);

comment on view v_comprobante_saldo is
  'Débitos de cuenta corriente (producción o no electrónicos) con lo imputado, el saldo y el estado de pago';

-- Créditos con algo sin imputar: recibos emitidos y notas de crédito.
create view v_cliente_saldo_a_favor
with (security_invoker = true) as
with creditos as (
  select 'recibo'::text as origen, r.id as recibo_id, null::uuid as nota_credito_id, r.cliente_id, r.fecha,
         r.creado_en, r.numero_texto, r.total,
         (select coalesce(sum(i.importe), 0) from imputacion i where i.recibo_id = r.id) as imputado
  from recibo r
  where r.estado = 'emitido'
  union all
  select 'nota_credito', null, c.id, c.cliente_id, c.fecha, c.creado_en,
         c.letra || '-' || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0'), c.total,
         (select coalesce(sum(i.importe), 0) from imputacion i where i.nota_credito_id = c.id)
  from comprobante c
  where public.fn_es_nota_credito_cc(c.clase, c.estado, c.ambiente)
)
select origen, recibo_id, nota_credito_id, cliente_id, fecha, creado_en, numero_texto, total, imputado,
       total - imputado as disponible
from creditos
where total - imputado > 0;

comment on view v_cliente_saldo_a_favor is
  'Saldo a favor por crédito (recibo emitido o nota de crédito) con lo no imputado. Se aplica del más viejo al más nuevo';

-- Movimientos con debe, haber y saldo acumulado por cliente.
create view v_cuenta_corriente
with (security_invoker = true) as
with movimientos as (
  select c.cliente_id, c.fecha, c.creado_en, c.id as movimiento_id, c.clase as tipo,
         c.id as comprobante_id, null::uuid as recibo_id,
         c.letra || '-' || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0') as numero_texto,
         c.condicion_pago,
         case when c.clase = 'nota_credito' then 0 else c.total end as debe,
         case when c.clase = 'nota_credito' then c.total else 0 end as haber
  from comprobante c
  where public.fn_es_debito_cc(c.clase, c.estado, c.ambiente)
     or public.fn_es_nota_credito_cc(c.clase, c.estado, c.ambiente)
  union all
  select r.cliente_id, r.fecha, r.creado_en, r.id, 'recibo', null, r.id, r.numero_texto, null, 0, r.total
  from recibo r
  where r.estado = 'emitido'
)
select cliente_id, fecha, creado_en, tipo, comprobante_id, recibo_id, numero_texto, condicion_pago, debe, haber,
       sum(debe - haber) over (
         partition by cliente_id order by fecha, creado_en, movimiento_id
         rows between unbounded preceding and current row
       ) as saldo
from movimientos
order by cliente_id, fecha, creado_en, movimiento_id;

comment on view v_cuenta_corriente is
  'Movimientos de cuenta corriente (facturas, ND, NC y recibos emitidos) con saldo acumulado. Sin homologación ni anulados';

-- Saldo por cliente: saldo = debe − haber = pendientes − a favor.
create view v_cliente_saldo
with (security_invoker = true) as
select
  cl.id as cliente_id,
  coalesce(m.debe, 0) as debe,
  coalesce(m.haber, 0) as haber,
  coalesce(m.debe, 0) - coalesce(m.haber, 0) as saldo,
  coalesce(p.pendiente, 0) as deuda_pendiente,
  coalesce(f.a_favor, 0) as saldo_a_favor,
  p.pendiente_mas_viejo
from cliente cl
left join (
  select cliente_id, sum(debe) as debe, sum(haber) as haber from v_cuenta_corriente group by cliente_id
) m on m.cliente_id = cl.id
left join (
  select cliente_id, sum(saldo) as pendiente, min(fecha) as pendiente_mas_viejo
  from v_comprobante_saldo where saldo > 0 group by cliente_id
) p on p.cliente_id = cl.id
left join (
  select cliente_id, sum(disponible) as a_favor from v_cliente_saldo_a_favor group by cliente_id
) f on f.cliente_id = cl.id;

comment on view v_cliente_saldo is
  'Saldo de cuenta corriente por cliente (positivo: debe), deuda pendiente, saldo a favor y fecha del pendiente más viejo';

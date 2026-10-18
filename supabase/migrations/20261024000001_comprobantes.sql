-- =====================================================================
-- Silfe Costos - Comprobantes de venta (Fase 8, Ventas)
-- Facturas, notas de crédito y notas de débito, letras A y B, con sus
-- ítems y comprobantes asociados. El ciclo de vida es:
--
--   borrador -> verificando -> autorizado | rechazado | borrador
--   rechazado -> borrador
--   borrador -> autorizado (sólo en puntos de venta no electrónicos)
--
-- Un comprobante autorizado es un documento fiscal: no se modifica ni se
-- borra, ni sus ítems ni sus asociados (se corrige con una nota de
-- crédito). Lo controlan triggers, así que vale también para SQL directo.
--
-- Errores de los triggers (SQLSTATE propio, estable para que la app los
-- traduzca; el HINT repite el motivo en forma de clave):
--   CM001 comprobante_autorizado_inmutable
--   CM002 transicion_invalida
--   CM003 borrado_no_permitido
--   CM004 comprobante_bloqueado (ítems / asociados)
--   CM005 punto_venta_inconsistente (ambiente o CAE según el punto de venta)
-- =====================================================================

-- ----- Puntos de venta ---------------------------------------------------

create table punto_venta (
  numero       integer primary key,
  nombre       text,
  electronico  boolean not null,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  constraint punto_venta_numero_check check (numero between 1 and 99999)
);

comment on table punto_venta is
  'Puntos de venta de la empresa. Los electrónicos numeran y autorizan en ARCA (CAE)';
comment on column punto_venta.numero is 'Número del punto de venta (1 a 99999)';
comment on column punto_venta.electronico is
  'true: el número lo da ARCA (último autorizado + 1) y se pide CAE. false: numeración propia, sin ARCA';
comment on column punto_venta.activo is 'Un punto de venta inactivo no se ofrece para comprobantes nuevos';

-- El punto de venta configurado en ARCA pasa a esta tabla.
insert into punto_venta (numero, nombre, electronico)
select punto_venta, 'Factura electrónica', true
from arca_emisor
where punto_venta is not null
on conflict (numero) do nothing;

comment on column arca_emisor.punto_venta is
  'Obsoleta: los puntos de venta están en la tabla punto_venta. Se mantiene hasta mover la pantalla de ARCA';

-- ----- Datos del emisor para el PDF --------------------------------------

alter table arca_emisor
  add column domicilio_comercial  text,
  add column ingresos_brutos      text,
  add column inicio_actividades   date;

comment on column arca_emisor.domicilio_comercial is 'Domicilio comercial que se imprime en los comprobantes';
comment on column arca_emisor.ingresos_brutos is 'Número de inscripción en Ingresos Brutos, para el comprobante';
comment on column arca_emisor.inicio_actividades is 'Fecha de inicio de actividades, para el comprobante';

-- ----- Comprobante -------------------------------------------------------

create table comprobante (
  id                      uuid primary key default gen_random_uuid(),
  punto_venta             integer not null references punto_venta(numero),
  ambiente                text,
  estado                  text not null default 'borrador',
  clase                   text not null,
  letra                   text,
  tipo_arca               integer,
  numero                  bigint,
  fecha                   date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  fecha_vencimiento_pago  date not null,
  cliente_id              uuid not null references cliente(id) on delete restrict,
  lista_precio_id         uuid references lista_precio(id) on delete set null,
  condicion_pago          text not null default 'cuenta_corriente',
  observaciones           text,
  moneda                  text not null default 'PES',
  receptor_razon_social   text,
  receptor_doc_tipo       integer,
  receptor_doc_nro        text,
  receptor_condicion_iva  text,
  receptor_domicilio      text,
  receptor_provincia      text,
  neto                    numeric(14,2) not null default 0,
  iva                     numeric(14,2) not null default 0,
  total                   numeric(14,2) not null default 0,
  cae                     text,
  cae_vencimiento         date,
  arca_resultado          text,
  arca_observaciones      jsonb,
  arca_errores            jsonb,
  intento_numero          bigint,
  creado_por              uuid default auth.uid(),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),
  autorizado_en           timestamptz,
  constraint comprobante_ambiente_check check (ambiente in ('homologacion', 'produccion')),
  constraint comprobante_estado_check check (estado in ('borrador', 'verificando', 'autorizado', 'rechazado')),
  constraint comprobante_clase_check check (clase in ('factura', 'nota_credito', 'nota_debito')),
  constraint comprobante_letra_check check (letra in ('A', 'B')),
  -- Códigos de ARCA: A = 1 / 2 / 3 y B = 6 / 7 / 8 (factura / débito / crédito).
  constraint comprobante_tipo_arca_check check (
    tipo_arca is null or (letra, clase, tipo_arca) in (
      ('A', 'factura', 1), ('A', 'nota_debito', 2), ('A', 'nota_credito', 3),
      ('B', 'factura', 6), ('B', 'nota_debito', 7), ('B', 'nota_credito', 8)
    )
  ),
  -- El número se asigna sólo al autorizar; mientras se verifica, el número
  -- enviado a ARCA queda en intento_numero.
  constraint comprobante_numero_check check (numero is null or (numero > 0 and estado = 'autorizado')),
  constraint comprobante_autorizado_check check (
    estado <> 'autorizado' or (numero is not null and letra is not null and tipo_arca is not null)
  ),
  constraint comprobante_verificando_check check (
    estado <> 'verificando' or (intento_numero is not null and letra is not null and tipo_arca is not null)
  ),
  constraint comprobante_intento_numero_check check (intento_numero > 0),
  constraint comprobante_vencimiento_check check (fecha_vencimiento_pago >= fecha),
  constraint comprobante_condicion_pago_check check (condicion_pago in ('cuenta_corriente', 'contado')),
  constraint comprobante_moneda_check check (moneda ~ '^[A-Z0-9]{3}$'),
  constraint comprobante_receptor_doc_tipo_check check (receptor_doc_tipo in (80, 96, 99)),
  constraint comprobante_receptor_condicion_iva_check check (
    receptor_condicion_iva in ('Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final')
  ),
  constraint comprobante_arca_resultado_check check (arca_resultado in ('A', 'R', 'P'))
);

comment on table comprobante is
  'Comprobantes de venta (factura, nota de crédito y de débito). Un autorizado no se modifica ni se borra';
comment on column comprobante.ambiente is
  'Ambiente de ARCA en que se emite. Obligatorio en puntos de venta electrónicos, vacío en los demás';
comment on column comprobante.estado is
  'borrador | verificando (enviado a ARCA, esperando confirmar) | autorizado | rechazado';
comment on column comprobante.clase is 'factura | nota_credito | nota_debito: la elige el usuario';
comment on column comprobante.letra is 'A o B según la condición IVA del receptor (emisor Responsable Inscripto)';
comment on column comprobante.tipo_arca is
  'Código de comprobante de ARCA: 1/2/3 (A: factura/débito/crédito) y 6/7/8 (B)';
comment on column comprobante.numero is 'Número del comprobante. Vacío hasta que se autoriza';
comment on column comprobante.fecha is 'Fecha del comprobante (por defecto hoy en Argentina)';
comment on column comprobante.fecha_vencimiento_pago is
  'Vencimiento del cobro. Por defecto la fecha del comprobante. Se imprime; no va a ARCA en concepto Productos';
comment on column comprobante.lista_precio_id is 'Lista de precios de la que salen los precios propuestos';
comment on column comprobante.condicion_pago is 'cuenta_corriente (por defecto) o contado';
comment on column comprobante.moneda is 'Código de moneda de ARCA. Por ahora sólo pesos (PES)';
comment on column comprobante.receptor_razon_social is
  'Copia de los datos del cliente al autorizar: si después cambia la ficha, el comprobante no cambia';
comment on column comprobante.receptor_doc_tipo is 'Tipo de documento del receptor en ARCA: 80 CUIT, 96 DNI, 99 sin identificar';
comment on column comprobante.receptor_doc_nro is 'Número de documento del receptor, sólo dígitos (0 si no se identifica)';
comment on column comprobante.receptor_condicion_iva is 'Condición frente al IVA del receptor al autorizar';
comment on column comprobante.neto is 'Importe neto gravado (suma de los importes de los ítems)';
comment on column comprobante.iva is 'IVA total: suma por alícuota, cada una redondeada a 2 decimales';
comment on column comprobante.total is 'neto + iva';
comment on column comprobante.cae is 'Código de autorización electrónico de ARCA';
comment on column comprobante.cae_vencimiento is 'Vencimiento del CAE';
comment on column comprobante.arca_resultado is 'Resultado de FECAESolicitar: A aprobado, R rechazado, P parcial';
comment on column comprobante.arca_observaciones is 'Observaciones de ARCA tal como llegaron: [{code, msg}]';
comment on column comprobante.arca_errores is 'Errores de ARCA tal como llegaron: [{code, msg}]';
comment on column comprobante.intento_numero is
  'Número enviado a ARCA mientras el comprobante está en verificación. Si la respuesta se pierde, se consulta con FECompConsultar antes de reintentar';
comment on column comprobante.creado_por is 'Usuario que creó el comprobante (auth.uid()). Sin FK: los usuarios se manejan desde Auth';
comment on column comprobante.autorizado_en is 'Momento en que quedó autorizado';

-- Numeración única por ambiente, punto de venta y tipo. NULLS NOT DISTINCT:
-- los no electrónicos (ambiente vacío) también se numeran sin repetir.
create unique index comprobante_numero_unico
  on comprobante (ambiente, punto_venta, tipo_arca, numero) nulls not distinct
  where numero is not null;

create index comprobante_cliente_idx on comprobante (cliente_id);
create index comprobante_fecha_idx on comprobante (fecha desc);
create index comprobante_estado_idx on comprobante (estado);
create index comprobante_lista_precio_idx on comprobante (lista_precio_id);

create trigger trg_comprobante_actualizado before update on comprobante
  for each row execute function fn_set_actualizado_en();

-- ----- Ítems -------------------------------------------------------------

create table comprobante_item (
  id               uuid primary key default gen_random_uuid(),
  comprobante_id   uuid not null references comprobante(id) on delete cascade,
  orden            integer not null default 0,
  producto_id      uuid references producto(id) on delete restrict,
  codigo           text,
  descripcion      text not null,
  observaciones    text,
  unidad           text,
  cantidad         numeric(14,4) not null,
  precio_unitario  numeric(18,4) not null default 0,
  descuento_pct    numeric(5,2) not null default 0,
  alicuota_iva     numeric(5,2) not null,
  importe          numeric(14,2) not null default 0,
  iva              numeric(14,2) not null default 0,
  constraint comprobante_item_descripcion_check check (btrim(descripcion) <> ''),
  constraint comprobante_item_cantidad_check check (cantidad > 0),
  constraint comprobante_item_precio_check check (precio_unitario >= 0),
  constraint comprobante_item_descuento_check check (descuento_pct between 0 and 100),
  constraint comprobante_item_alicuota_check check (alicuota_iva in (0, 2.5, 5, 10.5, 21, 27))
);

comment on table comprobante_item is 'Renglones de un comprobante: un producto del catálogo o un ítem libre';
comment on column comprobante_item.producto_id is 'Producto del catálogo. Vacío en un ítem libre';
comment on column comprobante_item.codigo is 'Copia del código del producto al cargarlo';
comment on column comprobante_item.observaciones is 'Texto que se imprime debajo de la descripción';
comment on column comprobante_item.precio_unitario is 'Precio unitario sin IVA, con 4 decimales';
comment on column comprobante_item.descuento_pct is 'Descuento del renglón en %';
comment on column comprobante_item.alicuota_iva is 'Alícuota de IVA en %: 0, 2.5, 5, 10.5, 21 o 27';
comment on column comprobante_item.importe is 'cantidad × precio × (1 − descuento), redondeado a 2 decimales (sin IVA)';
comment on column comprobante_item.iva is 'IVA del renglón, redondeado a 2 decimales (informativo: ARCA recibe el IVA por alícuota)';

create index comprobante_item_comprobante_idx on comprobante_item (comprobante_id, orden);
create index comprobante_item_producto_idx on comprobante_item (producto_id);

-- ----- Comprobantes asociados (notas de crédito y débito) ----------------

create table comprobante_asociado (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references comprobante(id) on delete cascade,
  asociado_id     uuid references comprobante(id) on delete restrict,
  tipo_arca       integer,
  punto_venta     integer,
  numero          bigint,
  fecha           date,
  cuit            text,
  -- O apunta a un comprobante de la base, o lleva a mano todos los datos
  -- de uno emitido con el sistema anterior.
  constraint comprobante_asociado_forma_check check (
    (asociado_id is not null
      and tipo_arca is null and punto_venta is null and numero is null and fecha is null and cuit is null)
    or
    (asociado_id is null
      and tipo_arca is not null and punto_venta is not null and numero is not null
      and fecha is not null and cuit is not null)
  ),
  constraint comprobante_asociado_distinto_check check (asociado_id <> comprobante_id),
  constraint comprobante_asociado_tipo_check check (tipo_arca in (1, 2, 3, 6, 7, 8)),
  constraint comprobante_asociado_punto_venta_check check (punto_venta between 1 and 99999),
  constraint comprobante_asociado_numero_check check (numero > 0),
  constraint comprobante_asociado_cuit_check check (cuit ~ '^\d{11}$')
);

comment on table comprobante_asociado is
  'Comprobantes a los que refiere una nota de crédito o débito (CbtesAsoc de ARCA)';
comment on column comprobante_asociado.asociado_id is 'Comprobante de la base. Vacío si se cargó a mano';
comment on column comprobante_asociado.tipo_arca is 'Carga manual: código de ARCA del comprobante asociado';
comment on column comprobante_asociado.punto_venta is 'Carga manual: punto de venta del comprobante asociado';
comment on column comprobante_asociado.numero is 'Carga manual: número del comprobante asociado';
comment on column comprobante_asociado.fecha is 'Carga manual: fecha del comprobante asociado';
comment on column comprobante_asociado.cuit is 'Carga manual: CUIT del emisor del comprobante asociado, 11 dígitos';

create index comprobante_asociado_comprobante_idx on comprobante_asociado (comprobante_id);
create index comprobante_asociado_asociado_idx on comprobante_asociado (asociado_id);

-- ----- Estado e inmutabilidad del comprobante ----------------------------

-- Valida el alta y cada cambio: el alta es siempre en borrador, un
-- autorizado no cambia más, las transiciones son las del ciclo de vida, y
-- el ambiente y el CAE dependen de si el punto de venta es electrónico.
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
  end if;

  if new.estado = 'autorizado' and v_electronico and (new.cae is null or new.cae_vencimiento is null) then
    raise exception 'Un comprobante electrónico autorizado necesita el CAE y su vencimiento.'
      using errcode = 'CM005', hint = 'punto_venta_inconsistente';
  end if;

  return new;
end;
$$;

create or replace function public.fn_comprobante_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger trg_comprobante_validar before insert or update on comprobante
  for each row execute function public.fn_comprobante_validar();

create trigger trg_comprobante_borrar before delete on comprobante
  for each row execute function public.fn_comprobante_borrar();

-- Ítems y asociados sólo cambian mientras el comprobante es un borrador o
-- un rechazado. Si el comprobante ya no existe (borrado en cascada de un
-- borrador) no hay nada que proteger.
create or replace function public.fn_comprobante_hijo_bloqueo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_estado text;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.comprobante_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.comprobante_id, new.comprobante_id];
  else
    v_ids := array[old.comprobante_id];
  end if;

  select c.estado into v_estado
  from public.comprobante c
  where c.id = any (v_ids) and c.estado not in ('borrador', 'rechazado')
  limit 1;

  if v_estado is not null then
    raise exception 'El comprobante está %: sus ítems y comprobantes asociados no se pueden cambiar.', v_estado
      using errcode = 'CM004', hint = 'comprobante_bloqueado';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_comprobante_item_bloqueo before insert or update or delete on comprobante_item
  for each row execute function public.fn_comprobante_hijo_bloqueo();

create trigger trg_comprobante_asociado_bloqueo before insert or update or delete on comprobante_asociado
  for each row execute function public.fn_comprobante_hijo_bloqueo();

revoke execute on function public.fn_comprobante_validar() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_borrar() from anon, authenticated, public;
revoke execute on function public.fn_comprobante_hijo_bloqueo() from anon, authenticated, public;

-- ----- Bloqueo de numeración ---------------------------------------------

-- Mismo patrón que el ticket de WSAA (arca_credencial.ta_bloqueado_hasta):
-- un bloqueo corto con vencimiento, para que dos autorizaciones simultáneas
-- del mismo punto de venta y tipo no pidan el mismo número a ARCA. Se toma
-- con una función porque la fila puede no existir todavía: el insert con
-- on conflict hace el alta o la toma condicional en un solo paso atómico.
-- Sólo para puntos de venta electrónicos: los no electrónicos numeran
-- dentro de la misma transacción que los emite.
create table comprobante_numeracion_bloqueo (
  ambiente         text not null,
  punto_venta      integer not null references punto_venta(numero) on delete cascade,
  tipo_arca        integer not null,
  bloqueado_hasta  timestamptz,
  primary key (ambiente, punto_venta, tipo_arca),
  constraint comprobante_numeracion_bloqueo_ambiente_check check (ambiente in ('homologacion', 'produccion')),
  constraint comprobante_numeracion_bloqueo_tipo_check check (tipo_arca in (1, 2, 3, 6, 7, 8))
);

comment on table comprobante_numeracion_bloqueo is
  'Bloqueo corto por ambiente, punto de venta y tipo mientras se numera y autoriza un comprobante en ARCA';
comment on column comprobante_numeracion_bloqueo.bloqueado_hasta is
  'Vencimiento del bloqueo. Libre si es nulo o ya pasó. Vence solo si quien lo tomó no lo libera';

-- Devuelve el vencimiento del bloqueo tomado (es la "llave" para
-- liberarlo) o null si otro pedido lo tiene vigente.
create or replace function public.tomar_bloqueo_numeracion(
  p_ambiente text,
  p_punto_venta integer,
  p_tipo_arca integer,
  p_duracion interval default interval '2 minutes'
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ahora timestamptz := clock_timestamp();
  v_hasta timestamptz;
begin
  insert into public.comprobante_numeracion_bloqueo as b (ambiente, punto_venta, tipo_arca, bloqueado_hasta)
  values (p_ambiente, p_punto_venta, p_tipo_arca, v_ahora + p_duracion)
  on conflict (ambiente, punto_venta, tipo_arca) do update
    set bloqueado_hasta = excluded.bloqueado_hasta
    where b.bloqueado_hasta is null or b.bloqueado_hasta < v_ahora
  returning b.bloqueado_hasta into v_hasta;
  return v_hasta;
end;
$$;

-- Libera el bloqueo sólo si sigue siendo el que se tomó (misma llave).
create or replace function public.liberar_bloqueo_numeracion(
  p_ambiente text,
  p_punto_venta integer,
  p_tipo_arca integer,
  p_hasta timestamptz
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.comprobante_numeracion_bloqueo
  set bloqueado_hasta = null
  where ambiente = p_ambiente
    and punto_venta = p_punto_venta
    and tipo_arca = p_tipo_arca
    and bloqueado_hasta = p_hasta;
$$;

comment on function public.tomar_bloqueo_numeracion(text, integer, integer, interval) is
  'Toma el bloqueo de numeración si está libre o vencido. Devuelve su vencimiento (llave para liberarlo) o null si está tomado';
comment on function public.liberar_bloqueo_numeracion(text, integer, integer, timestamptz) is
  'Libera el bloqueo de numeración sólo si sigue siendo el tomado con esa llave';

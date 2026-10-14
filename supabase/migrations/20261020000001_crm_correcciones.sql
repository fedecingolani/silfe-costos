-- =====================================================================
-- Silfe Costos - Correcciones de la ficha del cliente (Fase 6, CRM)
-- 1. CUIT normalizado a dígitos, para buscarlo con o sin guiones.
-- 2. marcar_sucursal_principal bloquea la fila del cliente, para que dos
--    llamadas simultáneas sobre el mismo cliente se hagan de a una.
-- 3. guardar_sucursal: alta o edición de una sucursal y, si es la
--    principal, desmarcar la anterior, todo en una sola transacción.
-- =====================================================================

-- ----- CUIT normalizado ------------------------------------------------

alter table cliente
  add column cuit_digitos text
    generated always as (nullif(regexp_replace(coalesce(cuit, ''), '\D', '', 'g'), '')) stored;

comment on column cliente.cuit_digitos is
  'Sólo los dígitos del CUIT (columna generada), para buscarlo con o sin guiones';

create index cliente_cuit_digitos_idx on cliente (cuit_digitos);

-- ----- Sucursal principal, serializada por cliente ----------------------

-- Misma firma, permisos y search_path que en 20261019000001. Antes de tocar
-- la principal bloquea la fila del cliente: una segunda llamada sobre el
-- mismo cliente espera a que termine la primera, en lugar de chocar contra
-- el índice único parcial.
create or replace function public.marcar_sucursal_principal(p_sucursal_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cliente_id uuid;
begin
  select cliente_id into v_cliente_id
  from public.cliente_sucursal
  where id = p_sucursal_id;

  if v_cliente_id is null then
    raise exception 'No existe la sucursal %', p_sucursal_id
      using errcode = 'no_data_found';
  end if;

  perform 1
  from public.cliente
  where id = v_cliente_id
  for update;

  update public.cliente_sucursal
     set principal = false
   where cliente_id = v_cliente_id and principal and id <> p_sucursal_id;

  update public.cliente_sucursal
     set principal = true
   where id = p_sucursal_id;
end;
$$;

comment on function public.marcar_sucursal_principal(uuid) is
  'Marca una sucursal como la principal de su cliente y desmarca la anterior, '
  'con la fila del cliente bloqueada';

-- ----- Alta y edición atómica de sucursales -----------------------------

-- p_id null da de alta; si no, edita la sucursal p_id, que tiene que ser de
-- p_cliente_id. p_datos trae los campos del formulario; los que faltan quedan
-- vacíos, salvo recibe_entregas (true), principal (false) y orden (0).
-- Todo pasa en la transacción de la llamada: si algo falla, no queda nada a
-- medias (ni la principal anterior desmarcada).
create or replace function public.guardar_sucursal(p_id uuid, p_cliente_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_principal boolean := coalesce((p_datos ->> 'principal')::boolean, false);
begin
  perform 1
  from public.cliente
  where id = p_cliente_id
  for update;

  if not found then
    raise exception 'No existe el cliente %', p_cliente_id
      using errcode = 'no_data_found';
  end if;

  if v_principal then
    update public.cliente_sucursal
       set principal = false
     where cliente_id = p_cliente_id and principal and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.cliente_sucursal (
      cliente_id, nombre, direccion, localidad, provincia, codigo_postal, telefono,
      observaciones, recibe_entregas, principal, transporte_id, orden
    ) values (
      p_cliente_id,
      p_datos ->> 'nombre',
      p_datos ->> 'direccion',
      p_datos ->> 'localidad',
      p_datos ->> 'provincia',
      p_datos ->> 'codigo_postal',
      p_datos ->> 'telefono',
      p_datos ->> 'observaciones',
      coalesce((p_datos ->> 'recibe_entregas')::boolean, true),
      v_principal,
      (p_datos ->> 'transporte_id')::uuid,
      coalesce((p_datos ->> 'orden')::int, 0)
    )
    returning id into v_id;
  else
    update public.cliente_sucursal
       set nombre          = p_datos ->> 'nombre',
           direccion       = p_datos ->> 'direccion',
           localidad       = p_datos ->> 'localidad',
           provincia       = p_datos ->> 'provincia',
           codigo_postal   = p_datos ->> 'codigo_postal',
           telefono        = p_datos ->> 'telefono',
           observaciones   = p_datos ->> 'observaciones',
           recibe_entregas = coalesce((p_datos ->> 'recibe_entregas')::boolean, true),
           principal       = v_principal,
           transporte_id   = (p_datos ->> 'transporte_id')::uuid,
           orden           = coalesce((p_datos ->> 'orden')::int, 0)
     where id = p_id and cliente_id = p_cliente_id
    returning id into v_id;

    if v_id is null then
      raise exception 'No existe la sucursal % del cliente %', p_id, p_cliente_id
        using errcode = 'no_data_found';
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.guardar_sucursal(uuid, uuid, jsonb) is
  'Da de alta o edita una sucursal y, si es la principal, desmarca la anterior, '
  'en una sola transacción y con la fila del cliente bloqueada';

-- Corre con los permisos de quien la llama (security invoker), como
-- marcar_sucursal_principal: alcanza con que la ejecute un autenticado.
revoke execute on function public.guardar_sucursal(uuid, uuid, jsonb) from public, anon;
grant execute on function public.guardar_sucursal(uuid, uuid, jsonb) to authenticated;

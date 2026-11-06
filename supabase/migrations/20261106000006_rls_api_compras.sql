-- =====================================================================
-- Charoli Gestión - RLS y permisos de la API de compras
--
-- api_clave: mismo patrón que el resto (20261106000002_rls_pagos_compra.sql):
-- acceso completo para authenticated (la pantalla de Configuración →
-- Integraciones crea, lista y revoca claves) y nada para anon.
--
-- service_role: las rutas /api/v1/* no tienen sesión de usuario; validan
-- la clave y escriben con la service-role key (secreto del Worker
-- SUPABASE_SERVICE_ROLE_KEY). service_role saltea la RLS, pero igual
-- necesita los permisos de tabla y de función, y los privilegios por
-- defecto del esquema public no se los dan a las tablas y funciones de
-- este proyecto (las migraciones otorgan todo explícitamente a
-- authenticated). Se otorga sólo lo que usa la API:
--   - api_clave: buscar la clave por hash y anotar el último uso;
--   - proveedor: buscar por CUIT y dar de alta;
--   - comprobante_compra: buscar el duplicado;
--   - guardar_comprobante_compra es security invoker: lo que toca ella, sus
--     triggers y fn_compras_articulo corre con los permisos de quien la
--     llama. Cabecera, renglones y percepciones; el catálogo del proveedor
--     (busca o da de alta el artículo); los remitos de compra (los bloquea
--     con FOR UPDATE, que pide UPDATE, aunque la API no manda remitos); y
--     fn_comprobante_compra_totales (la usan los triggers de totales).
-- Probado con `set role service_role` contra la base local.
-- =====================================================================

alter table public.api_clave enable row level security;

create policy "api_clave_select_autenticado" on public.api_clave
  for select to authenticated using (true);

create policy "api_clave_insert_autenticado" on public.api_clave
  for insert to authenticated with check (true);

create policy "api_clave_update_autenticado" on public.api_clave
  for update to authenticated using (true) with check (true);

create policy "api_clave_delete_autenticado" on public.api_clave
  for delete to authenticated using (true);

-- ----- Permisos por rol --------------------------------------------------

revoke all on public.api_clave from anon;
grant select, insert, update, delete on public.api_clave to authenticated;

grant select, update (ultimo_uso_en) on public.api_clave to service_role;
grant select, insert on public.proveedor to service_role;
grant select, insert, update on public.comprobante_compra to service_role;
grant select, insert, delete on public.comprobante_compra_item, public.comprobante_compra_percepcion to service_role;
grant select, insert, update on public.proveedor_articulo to service_role;
grant select, update on public.remito_compra to service_role;
grant select on public.remito_compra_item to service_role;

grant execute on function public.guardar_comprobante_compra(uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.fn_compras_articulo(uuid, jsonb) to service_role;
grant execute on function public.fn_comprobante_compra_totales(uuid, text) to service_role;

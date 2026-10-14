-- =====================================================================
-- Silfe Costos - Sin permisos de anon en clientes y contactos
-- 20260901000003 revocó todo a anon sobre las tablas que existían en ese
-- momento. Las tablas creadas después (zona, cliente, cliente_contacto y
-- proveedor_contacto) heredaron de los privilegios por defecto de Supabase
-- TRUNCATE, REFERENCES y TRIGGER para anon. La RLS ya impide leerlas, pero
-- anon no necesita ningún permiso sobre datos de clientes y contactos.
-- Revocar es idempotente: se puede volver a correr sin error.
-- =====================================================================

revoke all on public.cliente, public.cliente_contacto, public.proveedor_contacto, public.zona from anon;

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

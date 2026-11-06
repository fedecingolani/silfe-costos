/**
 * Cliente de Supabase con la service-role key, para las rutas de la API
 * (/api/v1/*), que no tienen sesión de usuario: validan su clave de API y
 * escriben con este cliente. Sólo para el servidor; no lee ni escribe
 * cookies ni guarda sesión.
 *
 * La key es el secreto SUPABASE_SERVICE_ROLE_KEY, que se lee como
 * ARCA_CLAVE_CIFRADO (src/lib/arca/secreto.ts):
 * - en el Worker (producción y `npm run preview`) es un secreto cargado con
 *   `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`; OpenNext lo expone en
 *   getCloudflareContext().env y en process.env;
 * - en `next dev`, initOpenNextCloudflareForDev (next.config.ts) lo lee de
 *   `.dev.vars` y lo deja en getCloudflareContext().env. process.env queda
 *   como respaldo.
 *
 * service_role saltea la RLS: los permisos que tiene sobre tablas y
 * funciones están en 20261106000006_rls_api_compras.sql.
 */
import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const NOMBRE_SECRETO_SERVICIO = "SUPABASE_SERVICE_ROLE_KEY";

export const MENSAJE_SIN_SECRETO_SERVICIO =
  "Falta configurar el secreto SUPABASE_SERVICE_ROLE_KEY en el servidor. Sin él la API no funciona. " +
  "En local va en .dev.vars; en producción, con `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.";

/** Falta configuración del servidor (secreto o URL de Supabase). */
export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfiguracion";
  }
}

function leerSecreto(): string | null {
  let valor: unknown;
  try {
    valor = (getCloudflareContext().env as Record<string, unknown>)[NOMBRE_SECRETO_SERVICIO];
  } catch {
    // Fuera de un pedido (o sin el contexto de Cloudflare) se usa process.env.
  }
  if (typeof valor !== "string" || valor.trim() === "") valor = process.env[NOMBRE_SECRETO_SERVICIO];
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** Cliente con la service-role key. Lanza ErrorConfiguracion si falta el secreto o la URL. */
export function crearClienteServicio(): SupabaseClient {
  const clave = leerSecreto();
  if (!clave) throw new ErrorConfiguracion(MENSAJE_SIN_SECRETO_SERVICIO);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new ErrorConfiguracion("Falta configurar NEXT_PUBLIC_SUPABASE_URL en el servidor.");
  return createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

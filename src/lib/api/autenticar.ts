/**
 * Autenticación de las rutas /api/v1/*: `Authorization: Bearer <clave>`.
 * El middleware las deja pasar sin sesión; cada ruta llama a autenticar()
 * antes de hacer nada.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteServicio, ErrorConfiguracion } from "@/lib/supabase/servicio";
import { esFormatoClave, hashClave, leerBearer } from "./clave";
import { CODIGOS_ERROR, errorApi, errorInterno } from "./respuestas";

export type ClaveAutenticada = { id: string; nombre: string };

export type ResultadoAutenticacion =
  | { ok: true; clave: ClaveAutenticada; supabase: SupabaseClient }
  | { ok: false; respuesta: Response };

const NO_AUTORIZADO = "Falta la clave de API o no es válida.";

function noAutorizado(): { ok: false; respuesta: Response } {
  return { ok: false, respuesta: errorApi(401, CODIGOS_ERROR.NO_AUTORIZADO, NO_AUTORIZADO) };
}

/**
 * Valida la clave (formato, hash en api_clave y que no esté revocada) y
 * devuelve el cliente service-role para el resto del pedido. Anota el
 * último uso sin hacer fallar el pedido si no puede.
 */
export async function autenticar(request: Request): Promise<ResultadoAutenticacion> {
  const clave = leerBearer(request.headers.get("authorization"));
  if (!clave || !esFormatoClave(clave)) return noAutorizado();

  let supabase: SupabaseClient;
  try {
    supabase = crearClienteServicio();
  } catch (e) {
    if (e instanceof ErrorConfiguracion) console.error(`[api] ${e.message}`);
    else console.error("[api] No se pudo crear el cliente de Supabase", e);
    return { ok: false, respuesta: errorInterno() };
  }

  const hash = await hashClave(clave);
  const { data, error } = await supabase
    .from("api_clave")
    .select("id, nombre")
    .eq("hash", hash)
    .is("revocada_en", null)
    .maybeSingle();
  if (error) {
    console.error("[api] No se pudo validar la clave", error);
    return { ok: false, respuesta: errorInterno() };
  }
  if (!data) return noAutorizado();

  const { error: errorUso } = await supabase
    .from("api_clave")
    .update({ ultimo_uso_en: new Date().toISOString() })
    .eq("id", data.id);
  if (errorUso) console.error("[api] No se pudo anotar el último uso de la clave", errorUso);

  return { ok: true, clave: { id: data.id as string, nombre: data.nombre as string }, supabase };
}

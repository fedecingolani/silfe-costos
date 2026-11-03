import type { SupabaseClient } from "@supabase/supabase-js";
import { deBase64, type TipoLogo } from "./validacion";

/** Logo de la empresa guardado en `empresa`. */
export type LogoEmpresa = { bytes: Uint8Array; tipo: TipoLogo };

/**
 * Lee el logo de la tabla `empresa`. Nunca falla: sin logo cargado, o ante
 * cualquier error, devuelve null y el PDF (o el menú) sale sin logo.
 */
export async function leerLogoEmpresa(cliente: SupabaseClient): Promise<LogoEmpresa | null> {
  try {
    const { data, error } = await cliente
      .from("empresa")
      .select("logo_base64, logo_tipo")
      .eq("id", true)
      .maybeSingle();
    if (error) {
      console.warn(`No se pudo leer el logo de la empresa: ${error.message}`);
      return null;
    }
    const fila = data as { logo_base64: string | null; logo_tipo: TipoLogo | null } | null;
    if (!fila?.logo_base64 || !fila.logo_tipo) return null;
    return { bytes: deBase64(fila.logo_base64), tipo: fila.logo_tipo };
  } catch (error) {
    console.warn("No se pudo leer el logo de la empresa:", error);
    return null;
  }
}

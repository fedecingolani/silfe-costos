import type { SupabaseClient } from "@supabase/supabase-js";
import { deBase64, type TipoLogo } from "./validacion";

/** Nombre de fantasía y contacto de la empresa para el encabezado de los PDF; vacíos si no están cargados. */
export type IdentidadPdf = { nombreFantasia: string; contacto: string };

export const SIN_IDENTIDAD_PDF: IdentidadPdf = { nombreFantasia: "", contacto: "" };

/** Columnas de `empresa` que usan los PDF: el logo y la identidad, en una sola consulta. */
export const COLUMNAS_EMPRESA_PDF = "logo_base64, logo_tipo, nombre_fantasia, telefono, email, web";

export type FilaEmpresaPdf = {
  logo_base64?: string | null;
  logo_tipo?: TipoLogo | string | null;
  nombre_fantasia: string | null;
  telefono: string | null;
  email: string | null;
  web: string | null;
};

/** Identidad para el PDF: el contacto en una línea, "Tel. … · email · web", sin los datos vacíos. */
export function identidadDelPdf(fila: FilaEmpresaPdf | null): IdentidadPdf {
  if (!fila) return SIN_IDENTIDAD_PDF;
  const telefono = fila.telefono?.trim();
  const contacto = [telefono ? `Tel. ${telefono}` : "", fila.email?.trim(), fila.web?.trim()]
    .filter(Boolean)
    .join(" · ");
  return { nombreFantasia: fila.nombre_fantasia?.trim() ?? "", contacto };
}

/**
 * Lee de `empresa` el logo y la identidad para un PDF. Nunca falla: ante un
 * error, el PDF sale como sin empresa cargada (sin logo, nombre ni contacto),
 * y un logo ilegible no se lleva el nombre ni el contacto.
 */
export async function leerEmpresaPdf(
  cliente: SupabaseClient,
): Promise<{ logo: Uint8Array | null; identidad: IdentidadPdf }> {
  try {
    const { data, error } = await cliente.from("empresa").select(COLUMNAS_EMPRESA_PDF).eq("id", true).maybeSingle();
    if (error) {
      console.warn(`No se pudo leer la empresa para el PDF: ${error.message}`);
      return { logo: null, identidad: SIN_IDENTIDAD_PDF };
    }
    const fila = data as FilaEmpresaPdf | null;
    return { logo: logoDeFila(fila), identidad: identidadDelPdf(fila) };
  } catch (error) {
    console.warn("No se pudo leer la empresa para el PDF:", error);
    return { logo: null, identidad: SIN_IDENTIDAD_PDF };
  }
}

function logoDeFila(fila: FilaEmpresaPdf | null): Uint8Array | null {
  if (!fila?.logo_base64 || !fila.logo_tipo) return null;
  try {
    return deBase64(fila.logo_base64);
  } catch (error) {
    console.warn("No se pudo leer el logo de la empresa:", error);
    return null;
  }
}

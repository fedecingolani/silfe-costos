import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { esColorHex } from "./validacion";
import { nombreVisible, urlLogo, type IdentidadEmpresa } from "./identidad";

const SIN_IDENTIDAD: IdentidadEmpresa = { nombre: null, color: null, logo: null };

/**
 * Identidad de la empresa para el menú, una vez por pedido. Nunca falla: ante
 * un error la app se muestra sólo con el nombre del producto y el verde por defecto.
 * No lee el logo (base64): sólo si hay uno, para armar su URL.
 */
export const leerIdentidadEmpresa = cache(async (): Promise<IdentidadEmpresa> => {
  try {
    const supabase = await createClient();
    const [empresa, emisor] = await Promise.all([
      supabase.from("empresa").select("nombre_fantasia, color_marca, logo_tipo, actualizado_en").eq("id", true).maybeSingle(),
      supabase.from("arca_emisor").select("razon_social").eq("id", true).maybeSingle(),
    ]);
    if (empresa.error) console.warn(`No se pudo leer la empresa: ${empresa.error.message}`);
    if (emisor.error) console.warn(`No se pudo leer la razón social: ${emisor.error.message}`);
    const e = empresa.data as {
      nombre_fantasia: string | null;
      color_marca: string | null;
      logo_tipo: string | null;
      actualizado_en: string;
    } | null;
    const razonSocial = (emisor.data as { razon_social: string | null } | null)?.razon_social ?? null;
    return {
      nombre: nombreVisible(e?.nombre_fantasia ?? null, razonSocial),
      color: esColorHex(e?.color_marca) ? e.color_marca : null,
      logo: e?.logo_tipo ? urlLogo(e.actualizado_en) : null,
    };
  } catch (error) {
    console.warn("No se pudo leer la identidad de la empresa:", error);
    return SIN_IDENTIDAD;
  }
});

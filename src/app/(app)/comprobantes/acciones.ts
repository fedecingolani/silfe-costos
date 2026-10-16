"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MENSAJE_SIN_SECRETO, leerClaveCifrado } from "@/lib/arca/secreto";
import type { FetchArca } from "@/lib/arca/wsaa";
import { autorizar } from "@/lib/comprobantes/autorizar";
import { repositorioComprobantes, serviciosArca } from "@/lib/comprobantes/autorizar-supabase";

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones devuelven el mensaje en lugar de lanzarlo. Ninguna devuelve la
// clave privada, el token ni el sign.

export type EstadoAccionComprobante = { error?: string; ok?: string };

const RUTA = "/comprobantes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fetchArca: FetchArca = (url, init) => fetch(url, init);

/**
 * Autoriza el comprobante en ARCA (CAE). Si quedó en verificación por una
 * respuesta perdida, primero lo reconcilia con ARCA.
 */
export async function autorizarComprobante(id: string): Promise<EstadoAccionComprobante> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const claveCifrado = leerClaveCifrado();
  if (!claveCifrado) return { error: MENSAJE_SIN_SECRETO };

  const supabase = await createClient();
  const resultado = await autorizar(id, {
    repositorio: repositorioComprobantes(supabase),
    arca: serviciosArca(supabase, fetchArca, claveCifrado),
  });

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return resultado.error ? { error: resultado.error } : { ok: resultado.ok };
}

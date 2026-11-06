"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generarClave, hashClave, prefijoClave } from "@/lib/api/clave";
import { validarNombreClave } from "@/lib/api/integraciones";

/**
 * Estado del formulario de alta (useActionState). `clave` es la clave
 * completa: viaja sólo en esta respuesta y se muestra una vez. No se guarda
 * ni se registra en ningún lado; en la base queda el hash.
 */
export type EstadoNuevaClave = { error?: string; clave?: string; nombre?: string } | undefined;

export type EstadoAccionClave = { error?: string; ok?: string } | undefined;

const RUTA = "/configuracion/integraciones";

export async function crearClave(_estado: EstadoNuevaClave, formData: FormData): Promise<EstadoNuevaClave> {
  const valor = formData.get("nombre");
  const validacion = validarNombreClave(typeof valor === "string" ? valor : null);
  if ("error" in validacion) return { error: validacion.error };

  const clave = generarClave();
  const supabase = await createClient();
  const { error } = await supabase.from("api_clave").insert({
    nombre: validacion.nombre,
    prefijo: prefijoClave(clave),
    hash: await hashClave(clave),
  });
  if (error) return { error: `No se pudo crear la clave: ${error.message}` };

  revalidatePath(RUTA);
  return { clave, nombre: validacion.nombre };
}

export async function revocarClave(id: string): Promise<EstadoAccionClave> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_clave")
    .update({ revocada_en: new Date().toISOString() })
    .eq("id", id)
    .is("revocada_en", null)
    .select("id");
  if (error) return { error: `No se pudo revocar la clave: ${error.message}` };
  if ((data ?? []).length !== 1) return { error: "No se pudo revocar la clave: ya estaba revocada o no existe." };

  revalidatePath(RUTA);
  return { ok: "Clave revocada. Las integraciones que la usen van a recibir 401." };
}

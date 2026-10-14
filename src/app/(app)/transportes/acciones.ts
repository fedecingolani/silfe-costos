"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aTexto } from "@/lib/formato";
import { mensajeErrorTransporte } from "@/lib/transportes/errores";

/** Estado del formulario de transporte: el error se muestra en un modal. */
export type EstadoFormularioTransporte = { error?: string } | undefined;

/** Valor de ?aviso= cuando no se puede borrar un transporte asignado. */
const AVISO_EN_USO = "en-uso";

function datos(formData: FormData) {
  return {
    nombre: String(formData.get("nombre") ?? "").trim(),
    telefono: aTexto(formData.get("telefono")),
    observaciones: aTexto(formData.get("observaciones")),
    activo: formData.get("activo") === "on",
  };
}

function refrescar() {
  revalidatePath("/transportes");
  revalidatePath("/clientes", "layout");
}

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones de los formularios devuelven el mensaje en lugar de lanzarlo.

export async function crearTransporte(
  _estado: EstadoFormularioTransporte,
  formData: FormData,
): Promise<EstadoFormularioTransporte> {
  const supabase = await createClient();
  const { error } = await supabase.from("transporte").insert(datos(formData));
  if (error) return { error: mensajeErrorTransporte("crear", error) };
  refrescar();
  redirect("/transportes");
}

export async function actualizarTransporte(
  _estado: EstadoFormularioTransporte,
  formData: FormData,
): Promise<EstadoFormularioTransporte> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transporte")
    .update(datos(formData))
    .eq("id", String(formData.get("id")));
  if (error) return { error: mensajeErrorTransporte("actualizar", error) };
  refrescar();
  redirect("/transportes");
}

export async function eliminarTransporte(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("transporte").delete().eq("id", String(formData.get("id")));
  // El formulario de borrar no tiene estado: el transporte en uso se avisa en
  // la página con un parámetro de la URL.
  if (error?.code === "23503") redirect(`/transportes?aviso=${AVISO_EN_USO}`);
  if (error) redirect("/transportes?aviso=no-eliminado");
  refrescar();
  redirect("/transportes");
}

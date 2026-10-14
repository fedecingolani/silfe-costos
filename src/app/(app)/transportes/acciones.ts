"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aTexto } from "@/lib/formato";

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

export async function crearTransporte(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("transporte").insert(datos(formData));
  if (error) throw new Error(`No se pudo crear el transporte: ${error.message}`);
  refrescar();
}

export async function actualizarTransporte(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transporte")
    .update(datos(formData))
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el transporte: ${error.message}`);
  refrescar();
  redirect("/transportes");
}

export async function eliminarTransporte(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("transporte").delete().eq("id", String(formData.get("id")));
  // Next enmascara en producción los errores lanzados desde una acción: el
  // transporte en uso se avisa en la página con un parámetro de la URL.
  if (error?.code === "23503") redirect(`/transportes?aviso=${AVISO_EN_USO}`);
  if (error) throw new Error(`No se pudo eliminar el transporte: ${error.message}`);
  refrescar();
  redirect("/transportes");
}

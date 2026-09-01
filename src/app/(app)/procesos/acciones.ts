"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aTexto } from "@/lib/formato";

function datos(formData: FormData) {
  return {
    codigo: String(formData.get("codigo") ?? "").trim(),
    nombre: String(formData.get("nombre") ?? "").trim(),
    descripcion: aTexto(formData.get("descripcion")),
    activo: formData.get("activo") === "on",
  };
}

export async function crearProceso(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("proceso").insert(datos(formData));
  if (error) throw new Error(`No se pudo crear el proceso: ${error.message}`);
  revalidatePath("/procesos");
}

export async function actualizarProceso(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("proceso").update(datos(formData)).eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el proceso: ${error.message}`);
  revalidatePath("/procesos");
  redirect("/procesos");
}

export async function eliminarProceso(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("proceso").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el proceso: ${error.message}`);
  revalidatePath("/procesos");
}

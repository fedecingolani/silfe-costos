"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero } from "@/lib/formato";

function datos(formData: FormData) {
  return {
    nombre: String(formData.get("nombre") ?? "").trim(),
    costo_hora: aNumero(formData.get("costo_hora"), 0),
    cargas_sociales_pct: aNumero(formData.get("cargas_sociales_pct"), 0),
    activo: formData.get("activo") === "on",
  };
}

export async function crearCategoria(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("categoria_mano_obra").insert(datos(formData));
  if (error) throw new Error(`No se pudo crear la categoría: ${error.message}`);
  revalidatePath("/mano-obra");
}

export async function actualizarCategoria(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("categoria_mano_obra")
    .update(datos(formData))
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar la categoría: ${error.message}`);
  revalidatePath("/mano-obra");
  revalidatePath("/productos");
  redirect("/mano-obra");
}

export async function eliminarCategoria(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("categoria_mano_obra").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar la categoría: ${error.message}`);
  revalidatePath("/mano-obra");
}

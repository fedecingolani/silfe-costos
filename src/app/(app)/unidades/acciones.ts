"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aNumero } from "@/lib/formato";

export async function crearUnidad(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("unidad_medida").insert({
    codigo: String(formData.get("codigo") ?? "").trim(),
    nombre: String(formData.get("nombre") ?? "").trim(),
    magnitud: String(formData.get("magnitud") ?? "UNIDAD"),
  });
  if (error) throw new Error(`No se pudo crear la unidad: ${error.message}`);
  revalidatePath("/unidades");
}

export async function eliminarUnidad(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("unidad_medida").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar la unidad: ${error.message}`);
  revalidatePath("/unidades");
}

export async function crearConversion(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("conversion_unidad").insert({
    unidad_origen_id: String(formData.get("unidad_origen_id")),
    unidad_destino_id: String(formData.get("unidad_destino_id")),
    factor: aNumero(formData.get("factor"), 1),
  });
  if (error) throw new Error(`No se pudo crear la conversión: ${error.message}`);
  revalidatePath("/unidades");
}

export async function eliminarConversion(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("conversion_unidad").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar la conversión: ${error.message}`);
  revalidatePath("/unidades");
}

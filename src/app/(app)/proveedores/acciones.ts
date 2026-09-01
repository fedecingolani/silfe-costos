"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aTexto } from "@/lib/formato";

function datos(formData: FormData) {
  return {
    nombre: String(formData.get("nombre") ?? "").trim(),
    cuit: aTexto(formData.get("cuit")),
    contacto: aTexto(formData.get("contacto")),
    email: aTexto(formData.get("email")),
    telefono: aTexto(formData.get("telefono")),
    notas: aTexto(formData.get("notas")),
    activo: formData.get("activo") === "on",
  };
}

export async function crearProveedor(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").insert(datos(formData));
  if (error) throw new Error(`No se pudo crear el proveedor: ${error.message}`);
  revalidatePath("/proveedores");
}

export async function actualizarProveedor(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").update(datos(formData)).eq("id", id);
  if (error) throw new Error(`No se pudo actualizar el proveedor: ${error.message}`);
  revalidatePath("/proveedores");
  redirect("/proveedores");
}

export async function eliminarProveedor(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").delete().eq("id", id);
  if (error) throw new Error(`No se pudo eliminar el proveedor: ${error.message}`);
  revalidatePath("/proveedores");
}

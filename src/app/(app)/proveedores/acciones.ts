"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";

function refrescar(proveedorId?: string) {
  revalidatePath("/proveedores");
  if (proveedorId) revalidatePath(`/proveedores/${proveedorId}`);
}

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
  refrescar();
}

export async function actualizarProveedor(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").update(datos(formData)).eq("id", id);
  if (error) throw new Error(`No se pudo actualizar el proveedor: ${error.message}`);
  refrescar(id);
  redirect("/proveedores");
}

export async function eliminarProveedor(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").delete().eq("id", id);
  if (error) throw new Error(`No se pudo eliminar el proveedor: ${error.message}`);
  refrescar();
}

// ----- Contactos ---------------------------------------------------------

export async function agregarContacto(formData: FormData) {
  const proveedorId = String(formData.get("proveedor_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor_contacto").insert({
    proveedor_id: proveedorId,
    nombre: String(formData.get("nombre") ?? "").trim(),
    cargo: aTexto(formData.get("cargo")),
    telefono: aTexto(formData.get("telefono")),
    email: aTexto(formData.get("email")),
    orden: aNumero(formData.get("orden"), 0),
  });
  if (error) throw new Error(`No se pudo agregar el contacto: ${error.message}`);
  refrescar(proveedorId);
}

export async function actualizarContacto(formData: FormData) {
  const proveedorId = String(formData.get("proveedor_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("proveedor_contacto")
    .update({
      nombre: String(formData.get("nombre") ?? "").trim(),
      cargo: aTexto(formData.get("cargo")),
      telefono: aTexto(formData.get("telefono")),
      email: aTexto(formData.get("email")),
    })
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el contacto: ${error.message}`);
  refrescar(proveedorId);
}

export async function eliminarContacto(formData: FormData) {
  const proveedorId = String(formData.get("proveedor_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("proveedor_contacto")
    .delete()
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el contacto: ${error.message}`);
  refrescar(proveedorId);
}

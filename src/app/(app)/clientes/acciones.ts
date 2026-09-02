"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";

function refrescar(clienteId?: string) {
  revalidatePath("/clientes");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

// ----- Cliente ---------------------------------------------------------

function datosCliente(formData: FormData) {
  return {
    codigo_legado: aNumero(formData.get("codigo_legado")),
    razon_social: String(formData.get("razon_social") ?? "").trim(),
    cuit: aTexto(formData.get("cuit")),
    direccion: aTexto(formData.get("direccion")),
    localidad: aTexto(formData.get("localidad")),
    provincia: aTexto(formData.get("provincia")),
    codigo_postal: aTexto(formData.get("codigo_postal")),
    telefono: aTexto(formData.get("telefono")),
    zona_id: aTexto(formData.get("zona_id")),
    activo: formData.get("activo") === "on",
  };
}

export async function crearCliente(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cliente")
    .insert(datosCliente(formData))
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el cliente: ${error.message}`);
  refrescar();
  redirect(`/clientes/${data.id}`);
}

export async function actualizarCliente(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("cliente").update(datosCliente(formData)).eq("id", id);
  if (error) throw new Error(`No se pudo actualizar el cliente: ${error.message}`);
  refrescar(id);
  redirect("/clientes");
}

export async function eliminarCliente(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("cliente").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el cliente: ${error.message}`);
  refrescar();
  redirect("/clientes");
}

// ----- Contactos ---------------------------------------------------------

export async function agregarContacto(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("cliente_contacto").insert({
    cliente_id: clienteId,
    nombre: String(formData.get("nombre") ?? "").trim(),
    cargo: aTexto(formData.get("cargo")),
    telefono: aTexto(formData.get("telefono")),
    orden: aNumero(formData.get("orden"), 0),
  });
  if (error) throw new Error(`No se pudo agregar el contacto: ${error.message}`);
  refrescar(clienteId);
}

export async function actualizarContacto(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_contacto")
    .update({
      nombre: String(formData.get("nombre") ?? "").trim(),
      cargo: aTexto(formData.get("cargo")),
      telefono: aTexto(formData.get("telefono")),
    })
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el contacto: ${error.message}`);
  refrescar(clienteId);
}

export async function eliminarContacto(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_contacto")
    .delete()
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el contacto: ${error.message}`);
  refrescar(clienteId);
}

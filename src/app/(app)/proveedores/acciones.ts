"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";
import { mensajeErrorArticulo, mensajeErrorProveedor } from "@/lib/proveedores/errores";
import { validarArticulo, validarCuit, validarDatosFiscales } from "@/lib/proveedores/validacion";

/** Estado de los formularios con modal de error (proveedor y artículo). */
export type EstadoFormularioProveedor = { error?: string } | undefined;

function refrescar(proveedorId?: string) {
  revalidatePath("/proveedores");
  if (proveedorId) revalidatePath(`/proveedores/${proveedorId}`);
}

function texto(formData: FormData, campo: string): string | null {
  const valor = formData.get(campo);
  return valor === null ? null : String(valor);
}

function datos(formData: FormData) {
  const fiscales = validarDatosFiscales({
    condicion_iva: texto(formData, "condicion_iva"),
    domicilio: texto(formData, "domicilio"),
    cbu: texto(formData, "cbu"),
    alias: texto(formData, "alias"),
  });
  if ("error" in fiscales) return fiscales;
  // Se guarda sólo con dígitos: así se encuentra por CUIT (API de compras) y no se repite.
  const cuit = validarCuit(texto(formData, "cuit"));
  if ("error" in cuit) return cuit;
  return {
    datos: {
      nombre: String(formData.get("nombre") ?? "").trim(),
      cuit: cuit.datos,
      contacto: aTexto(formData.get("contacto")),
      email: aTexto(formData.get("email")),
      telefono: aTexto(formData.get("telefono")),
      notas: aTexto(formData.get("notas")),
      activo: formData.get("activo") === "on",
      ...fiscales.datos,
    },
  };
}

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones de los formularios devuelven el mensaje en lugar de lanzarlo.

export async function crearProveedor(
  _estado: EstadoFormularioProveedor,
  formData: FormData,
): Promise<EstadoFormularioProveedor> {
  const entrada = datos(formData);
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").insert(entrada.datos);
  if (error) return { error: mensajeErrorProveedor("crear", error) };
  refrescar();
  redirect("/proveedores");
}

export async function actualizarProveedor(
  _estado: EstadoFormularioProveedor,
  formData: FormData,
): Promise<EstadoFormularioProveedor> {
  const id = String(formData.get("id"));
  const entrada = datos(formData);
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { error } = await supabase.from("proveedor").update(entrada.datos).eq("id", id);
  if (error) return { error: mensajeErrorProveedor("actualizar", error) };
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

// ----- Artículos del proveedor -------------------------------------------

function datosArticulo(formData: FormData) {
  return validarArticulo({
    codigo: texto(formData, "codigo"),
    descripcion: texto(formData, "descripcion"),
    unidad: texto(formData, "unidad"),
    factor: texto(formData, "factor_conversion"),
    materia_prima_id: texto(formData, "materia_prima_id"),
  });
}

export async function agregarArticulo(
  _estado: EstadoFormularioProveedor,
  formData: FormData,
): Promise<EstadoFormularioProveedor> {
  const proveedorId = String(formData.get("proveedor_id"));
  const entrada = datosArticulo(formData);
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("proveedor_articulo")
    .insert({ ...entrada.datos, proveedor_id: proveedorId });
  if (error) return { error: mensajeErrorArticulo("agregar", error) };
  refrescar(proveedorId);
  redirect(`/proveedores/${proveedorId}`);
}

export async function actualizarArticulo(
  _estado: EstadoFormularioProveedor,
  formData: FormData,
): Promise<EstadoFormularioProveedor> {
  const proveedorId = String(formData.get("proveedor_id"));
  const entrada = datosArticulo(formData);
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proveedor_articulo")
    .update({ ...entrada.datos, activo: formData.get("activo") === "on" })
    .eq("id", String(formData.get("id")))
    .eq("proveedor_id", proveedorId)
    .select("id");
  if (error) return { error: mensajeErrorArticulo("actualizar", error) };
  // Sin filas: alguien borró el artículo mientras se editaba.
  if (!data?.length) return { error: "El artículo ya no existe. Recargá la página." };
  refrescar(proveedorId);
  redirect(`/proveedores/${proveedorId}`);
}

export async function eliminarArticulo(formData: FormData) {
  const proveedorId = String(formData.get("proveedor_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("proveedor_articulo")
    .delete()
    .eq("id", String(formData.get("id")))
    .eq("proveedor_id", proveedorId);
  // El borrado no tiene estado: el artículo en uso se avisa en la página con
  // un parámetro de la URL.
  if (error?.code === "23503") redirect(`/proveedores/${proveedorId}?aviso=articulo-en-uso`);
  if (error) redirect(`/proveedores/${proveedorId}?aviso=articulo-no-eliminado`);
  refrescar(proveedorId);
  redirect(`/proveedores/${proveedorId}`);
}

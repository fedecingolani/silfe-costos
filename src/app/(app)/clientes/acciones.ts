"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";
import { validarCbu, validarCvu } from "@/lib/clientes/validaciones";

function refrescar(clienteId?: string) {
  revalidatePath("/clientes");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

/** Estado de los formularios de cliente que muestran el error en un modal. */
export type EstadoFormularioCliente = { error?: string } | undefined;

/** Mensajes legibles para las restricciones de la base sobre el cliente. */
const MENSAJES_RESTRICCION: Record<string, string> = {
  cliente_cbu_check: "El CBU debe tener exactamente 22 dígitos.",
  cliente_cvu_check: "El CVU debe tener exactamente 22 dígitos.",
  cliente_alias_bancario_check:
    "El alias lleva de 6 a 20 caracteres: letras, números, punto y guion.",
  cliente_condicion_iva_check: "La condición frente al IVA no es válida.",
};

function mensajeErrorCliente(
  accion: string,
  error: { code?: string; message: string },
): string {
  if (error.code === "23514") {
    const restriccion = Object.keys(MENSAJES_RESTRICCION).find((r) => error.message.includes(r));
    if (restriccion) return MENSAJES_RESTRICCION[restriccion];
  }
  return `No se pudo ${accion} el cliente: ${error.message}`;
}

/** CBU o CVU sin espacios ni guiones; si no tiene el formato, se manda tal cual y la base lo rechaza. */
function cuenta(valor: FormDataEntryValue | null, validar: typeof validarCbu) {
  const texto = aTexto(valor);
  return texto === null ? null : (validar(texto).normalizado ?? texto);
}

// ----- Cliente ---------------------------------------------------------

/**
 * Datos del formulario de cliente. El alta sólo muestra algunos campos: los
 * que no vienen en el formulario no se tocan (quedan con su valor por defecto).
 */
function datosCliente(formData: FormData) {
  const datos: Record<string, unknown> = {
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
    condicion_iva: aTexto(formData.get("condicion_iva")),
    transporte_id: aTexto(formData.get("transporte_id")),
  };
  if (formData.has("cbu")) datos.cbu = cuenta(formData.get("cbu"), validarCbu);
  if (formData.has("cvu")) datos.cvu = cuenta(formData.get("cvu"), validarCvu);
  if (formData.has("alias_bancario")) datos.alias_bancario = aTexto(formData.get("alias_bancario"));
  if (formData.has("observaciones")) datos.observaciones = aTexto(formData.get("observaciones"));
  return datos;
}

export async function crearCliente(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cliente")
    .insert(datosCliente(formData))
    .select("id")
    .single();
  if (error) return { error: mensajeErrorCliente("crear", error) };
  refrescar();
  redirect(`/clientes/${data.id}`);
}

export async function actualizarCliente(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("cliente").update(datosCliente(formData)).eq("id", id);
  if (error) return { error: mensajeErrorCliente("actualizar", error) };
  refrescar(id);
  redirect(`/clientes/${id}`);
}

export async function eliminarCliente(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("cliente").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el cliente: ${error.message}`);
  refrescar();
  redirect("/clientes");
}

// ----- Sucursales y direcciones de entrega -------------------------------

function datosSucursal(formData: FormData) {
  return {
    nombre: String(formData.get("nombre") ?? "").trim(),
    direccion: aTexto(formData.get("direccion")),
    localidad: aTexto(formData.get("localidad")),
    provincia: aTexto(formData.get("provincia")),
    codigo_postal: aTexto(formData.get("codigo_postal")),
    telefono: aTexto(formData.get("telefono")),
    observaciones: aTexto(formData.get("observaciones")),
    recibe_entregas: formData.get("recibe_entregas") === "on",
    transporte_id: aTexto(formData.get("transporte_id")),
    orden: aNumero(formData.get("orden"), 0),
  };
}

/** Marca la sucursal como principal y desmarca la anterior, en una sola transacción. */
async function marcarPrincipal(supabase: Awaited<ReturnType<typeof createClient>>, sucursalId: string) {
  const { error } = await supabase.rpc("marcar_sucursal_principal", { p_sucursal_id: sucursalId });
  if (error) throw new Error(`No se pudo marcar la sucursal como principal: ${error.message}`);
}

export async function agregarSucursal(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cliente_sucursal")
    .insert({ cliente_id: clienteId, ...datosSucursal(formData) })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo agregar la sucursal: ${error.message}`);
  if (formData.get("principal") === "on") await marcarPrincipal(supabase, data.id);
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
}

export async function actualizarSucursal(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const principal = formData.get("principal") === "on";
  const { error } = await supabase
    .from("cliente_sucursal")
    .update({ ...datosSucursal(formData), ...(principal ? {} : { principal: false }) })
    .eq("id", id);
  if (error) throw new Error(`No se pudo actualizar la sucursal: ${error.message}`);
  if (principal) await marcarPrincipal(supabase, id);
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
}

export async function hacerSucursalPrincipal(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  await marcarPrincipal(supabase, String(formData.get("id")));
  refrescar(clienteId);
}

export async function eliminarSucursal(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_sucursal")
    .delete()
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar la sucursal: ${error.message}`);
  refrescar(clienteId);
}

// ----- Contactos ---------------------------------------------------------

function datosContacto(formData: FormData) {
  return {
    nombre: String(formData.get("nombre") ?? "").trim(),
    cargo: aTexto(formData.get("cargo")),
    telefono: aTexto(formData.get("telefono")),
    email: aTexto(formData.get("email")),
    whatsapp: aTexto(formData.get("whatsapp")),
    observaciones: aTexto(formData.get("observaciones")),
    sucursal_id: aTexto(formData.get("sucursal_id")),
    orden: aNumero(formData.get("orden"), 0),
  };
}

export async function agregarContacto(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_contacto")
    .insert({ cliente_id: clienteId, ...datosContacto(formData) });
  if (error) throw new Error(`No se pudo agregar el contacto: ${error.message}`);
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
}

export async function actualizarContacto(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_contacto")
    .update(datosContacto(formData))
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el contacto: ${error.message}`);
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
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

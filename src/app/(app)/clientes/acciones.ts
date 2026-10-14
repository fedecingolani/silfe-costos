"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";
import { validarCbu, validarCvu } from "@/lib/clientes/validaciones";
import {
  mensajeErrorCliente,
  mensajeErrorContacto,
  mensajeErrorInteraccion,
  mensajeErrorSucursal,
} from "@/lib/clientes/errores";
import { fechaLocalAIso, rutaDeVuelta } from "@/lib/clientes/seguimiento";

function refrescar(clienteId?: string) {
  revalidatePath("/clientes");
  revalidatePath("/seguimiento");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

/** Estado de los formularios de la ficha que muestran el error en un modal. */
export type EstadoFormularioCliente = { error?: string } | undefined;

/**
 * Valores de ?aviso= que muestran la ficha y el listado cuando falla una
 * acción de un formulario sin estado (botones de eliminar o de marcar la
 * principal). Next enmascara en producción los errores lanzados desde una
 * acción, así que se avisan con un parámetro de la URL.
 */
export type AvisoCliente =
  | "cliente-no-eliminado"
  | "sucursal-no-eliminada"
  | "principal-no-marcada"
  | "contacto-no-eliminado"
  | "interaccion-no-eliminada";

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
  const id = String(formData.get("id"));
  const { error } = await supabase.from("cliente").delete().eq("id", id);
  if (error) redirect(`/clientes/${id}?aviso=${"cliente-no-eliminado" satisfies AvisoCliente}`);
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

/** Guarda la sucursal con guardar_sucursal; si falla, devuelve el mensaje legible. */
async function guardarSucursal(formData: FormData, accion: string): Promise<EstadoFormularioCliente> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_sucursal", {
    p_id: aTexto(formData.get("id")),
    p_cliente_id: String(formData.get("cliente_id")),
    // Alta o edición y, si es la principal, desmarcar la anterior: todo en
    // una sola transacción, dentro de la función.
    p_datos: { ...datosSucursal(formData), principal: formData.get("principal") === "on" },
  });
  if (error) return { error: mensajeErrorSucursal(accion, error) };
  return undefined;
}

export async function agregarSucursal(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const clienteId = String(formData.get("cliente_id"));
  const estado = await guardarSucursal(formData, "agregar");
  if (estado?.error) return estado;
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
}

export async function actualizarSucursal(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const clienteId = String(formData.get("cliente_id"));
  const estado = await guardarSucursal(formData, "actualizar");
  if (estado?.error) return estado;
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
}

export async function hacerSucursalPrincipal(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("marcar_sucursal_principal", {
    p_sucursal_id: String(formData.get("id")),
  });
  if (error) redirect(`/clientes/${clienteId}?aviso=${"principal-no-marcada" satisfies AvisoCliente}`);
  refrescar(clienteId);
  // Vuelve a la ficha sin ?aviso=, por si quedó de un error anterior.
  redirect(`/clientes/${clienteId}`);
}

export async function eliminarSucursal(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_sucursal")
    .delete()
    .eq("id", String(formData.get("id")));
  if (error) redirect(`/clientes/${clienteId}?aviso=${"sucursal-no-eliminada" satisfies AvisoCliente}`);
  refrescar(clienteId);
  // Vuelve a la ficha sin ?aviso=, por si quedó de un error anterior.
  redirect(`/clientes/${clienteId}`);
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

export async function agregarContacto(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_contacto")
    .insert({ cliente_id: clienteId, ...datosContacto(formData) });
  if (error) return { error: mensajeErrorContacto("agregar", error) };
  refrescar(clienteId);
  redirect(`/clientes/${clienteId}`);
}

export async function actualizarContacto(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_contacto")
    .update(datosContacto(formData))
    .eq("id", String(formData.get("id")))
    .eq("cliente_id", clienteId);
  if (error) return { error: mensajeErrorContacto("actualizar", error) };
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
  if (error) redirect(`/clientes/${clienteId}?aviso=${"contacto-no-eliminado" satisfies AvisoCliente}`);
  refrescar(clienteId);
  // Vuelve a la ficha sin ?aviso=, por si quedó de un error anterior.
  redirect(`/clientes/${clienteId}`);
}

// ----- Seguimiento: interacciones con el cliente --------------------------

/**
 * Datos del formulario de interacción. La fecha llega de un input
 * datetime-local en hora argentina. Devuelve el error legible si algo no
 * se puede guardar, antes de ir a la base.
 */
function datosInteraccion(formData: FormData) {
  const fecha = fechaLocalAIso(String(formData.get("fecha") ?? ""));
  if (!fecha) return { error: "La fecha y hora no son válidas." } as const;
  const resumen = String(formData.get("resumen") ?? "").trim();
  if (resumen === "") return { error: "Escribí un resumen de la interacción." } as const;
  return {
    datos: {
      tipo: String(formData.get("tipo") ?? ""),
      sentido: String(formData.get("sentido") ?? "SALIENTE"),
      fecha,
      contacto_id: aTexto(formData.get("contacto_id")),
      resumen,
      notas: aTexto(formData.get("notas")),
      proximo_contacto: aTexto(formData.get("proximo_contacto")),
      proxima_accion: aTexto(formData.get("proxima_accion")),
    },
  } as const;
}

export async function registrarInteraccion(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const clienteId = String(formData.get("cliente_id"));
  const leido = datosInteraccion(formData);
  if ("error" in leido) return { error: leido.error };
  const supabase = await createClient();
  // realizado_por lo completa la base con auth.uid(); el email se copia acá.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("cliente_interaccion").insert({
    cliente_id: clienteId,
    ...leido.datos,
    realizado_por_email: user?.email ?? null,
  });
  if (error) return { error: mensajeErrorInteraccion("registrar", error) };
  refrescar(clienteId);
  redirect(rutaDeVuelta(String(formData.get("volver") ?? ""), clienteId));
}

export async function actualizarInteraccion(
  _estado: EstadoFormularioCliente,
  formData: FormData,
): Promise<EstadoFormularioCliente> {
  const clienteId = String(formData.get("cliente_id"));
  const leido = datosInteraccion(formData);
  if ("error" in leido) return { error: leido.error };
  const supabase = await createClient();
  // Quién la registró no cambia al editarla.
  const { data, error } = await supabase
    .from("cliente_interaccion")
    .update(leido.datos)
    .eq("id", String(formData.get("id")))
    .eq("cliente_id", clienteId)
    .select("id");
  if (error) return { error: mensajeErrorInteraccion("actualizar", error) };
  if (!data || data.length === 0) return { error: "La interacción ya no existe." };
  refrescar(clienteId);
  redirect(rutaDeVuelta(String(formData.get("volver") ?? ""), clienteId));
}

export async function eliminarInteraccion(formData: FormData) {
  const clienteId = String(formData.get("cliente_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("cliente_interaccion")
    .delete()
    .eq("id", String(formData.get("id")))
    .eq("cliente_id", clienteId);
  if (error) redirect(`/clientes/${clienteId}?aviso=${"interaccion-no-eliminada" satisfies AvisoCliente}`);
  refrescar(clienteId);
  // Vuelve a la ficha sin ?aviso=, por si quedó de un error anterior.
  redirect(`/clientes/${clienteId}`);
}

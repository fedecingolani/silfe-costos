"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { armarComprobanteCompra, parametrosGuardarComprobanteCompra } from "@/lib/compras/comprobantes/borrador";
import { mensajeErrorComprobanteCompra } from "@/lib/compras/comprobantes/errores";
import type { FacturaAsociable } from "@/lib/compras/comprobantes/nota";
import { LETRAS_COMPRA, type PrecioComprobanteCompra, type ProveedorArticulo } from "@/lib/tipos";
import { cargarArticulos, cargarFacturasAsociables } from "./datos";

// Como en remitos y comprobantes de venta, las acciones devuelven el mensaje
// de error en lugar de lanzarlo (Next enmascara en producción los errores de
// las acciones).

export type ResultadoComprobanteCompra = { error?: string; ok?: string; id?: string };

const RUTA = "/compras/comprobantes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea (id null, queda en borrador) o actualiza un borrador con sus
 * renglones y percepciones en una sola transacción
 * (guardar_comprobante_compra). `datos` es el JSON de
 * ComprobanteCompraEnviado; los importes y totales los calcula la base.
 * Devuelve el id: el editor abre la dirección de uno nuevo o sigue con la
 * confirmación.
 */
export async function guardarComprobanteCompra(id: string | null, datos: string): Promise<ResultadoComprobanteCompra> {
  if (id !== null && !UUID.test(id)) return { error: "Comprobante inválido." };
  let enviado: unknown;
  try {
    enviado = JSON.parse(datos);
  } catch {
    return { error: "Los datos del comprobante no son válidos." };
  }
  const armado = armarComprobanteCompra(enviado);
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "guardar_comprobante_compra",
    parametrosGuardarComprobanteCompra(id, armado.armado),
  );
  if (error) return { error: mensajeErrorComprobanteCompra(error) };
  if (typeof data !== "string" || !UUID.test(data)) return { error: "No se pudo guardar el comprobante: la base no devolvió su id." };
  const guardadoId = data;

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${guardadoId}`);
  return { ok: "Comprobante guardado.", id: guardadoId };
}

/**
 * Renglones con materia prima de un comprobante guardado, con el precio de
 * la factura (por unidad de compra) y el vigente del proveedor
 * (precios_comprobante_compra). Antes de confirmar, para elegir qué
 * precios actualizar.
 */
export async function preciosComprobanteCompra(
  id: string,
): Promise<{ error: string } | { lineas: PrecioComprobanteCompra[] }> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("precios_comprobante_compra", { p_id: id });
  if (error) return { error: mensajeErrorComprobanteCompra(error, "leer los precios del comprobante") };
  const filas = (data ?? []) as PrecioComprobanteCompra[];
  // numeric llega como número o como texto según el tamaño: se normaliza.
  const lineas = filas.map((l) => ({
    ...l,
    precio_factura: Number(l.precio_factura),
    precio_vigente: l.precio_vigente === null ? null : Number(l.precio_vigente),
  }));
  return { lineas };
}

/**
 * Confirma un borrador ya guardado (confirmar_comprobante_compra) y, en la
 * misma transacción, carga el precio de la factura de los renglones
 * elegidos. Después sólo se anula.
 */
export async function confirmarComprobanteCompra(
  id: string,
  actualizarPrecios: string[] = [],
): Promise<ResultadoComprobanteCompra> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  if (!Array.isArray(actualizarPrecios) || !actualizarPrecios.every((r) => typeof r === "string" && UUID.test(r))) {
    return { error: "Los renglones elegidos no son válidos." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirmar_comprobante_compra", {
    p_id: id,
    p_actualizar_precios: actualizarPrecios,
  });
  if (error) return { error: mensajeErrorComprobanteCompra(error, "confirmar el comprobante") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  if (actualizarPrecios.length > 0) {
    // Como agregarPrecio en materias primas: el precio nuevo cambia costos.
    revalidatePath("/materias-primas", "layout");
    revalidatePath("/productos", "layout");
  }
  return {
    ok: actualizarPrecios.length > 0 ? "Comprobante confirmado y precios actualizados." : "Comprobante confirmado.",
    id,
  };
}

/** Anula un confirmado; conserva sus datos y libera el número (anular_comprobante_compra). */
export async function anularComprobanteCompra(id: string): Promise<ResultadoComprobanteCompra> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("anular_comprobante_compra", { p_id: id });
  if (error) return { error: mensajeErrorComprobanteCompra(error, "anular el comprobante") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return { ok: "Comprobante anulado.", id };
}

/** Borra un borrador (renglones y percepciones se van en cascada) y vuelve al listado. */
export async function borrarComprobanteCompra(id: string): Promise<ResultadoComprobanteCompra> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comprobante_compra")
    .delete()
    .eq("id", id)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { error: mensajeErrorComprobanteCompra(error, "borrar el comprobante") };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar comprobantes en borrador. Uno confirmado se anula." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/** Catálogo del proveedor elegido en el editor. Vacío si no se pudo leer. */
export async function articulosDelProveedor(proveedorId: string): Promise<ProveedorArticulo[]> {
  if (!UUID.test(proveedorId)) return [];
  const supabase = await createClient();
  const articulos = await cargarArticulos(supabase, proveedorId);
  return typeof articulos === "string" ? [] : articulos;
}

/**
 * Facturas confirmadas del proveedor y la letra, para asociar a una nota.
 * Si no se pudieron leer, el mensaje: el editor distingue una lectura
 * fallida de una lista vacía.
 */
export async function facturasAsociables(
  proveedorId: string,
  letra: string,
): Promise<{ facturas: FacturaAsociable[] } | { error: string }> {
  if (!UUID.test(proveedorId) || !(LETRAS_COMPRA as readonly string[]).includes(letra)) return { facturas: [] };
  const supabase = await createClient();
  const facturas = await cargarFacturasAsociables(supabase, proveedorId, letra);
  return typeof facturas === "string" ? { error: facturas } : { facturas };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { armarRemitoCompra, parametrosGuardarRemitoCompra } from "@/lib/compras/remitos/borrador";
import { mensajeErrorFacturarRemitosCompra, mensajeErrorRemitoCompra } from "@/lib/compras/remitos/errores";
import { aplicarSeleccion, armarFacturacion, seleccionInicial } from "@/lib/compras/remitos/facturacion";
import { cargarPendientes } from "./datos";

// Como en los comprobantes de compra, las acciones devuelven el mensaje de
// error en lugar de lanzarlo (Next enmascara en producción los errores de
// las acciones). El catálogo del proveedor que pide el editor es el de los
// comprobantes (articulosDelProveedor en ../comprobantes/acciones).

export type ResultadoRemitoCompra = { error?: string; ok?: string; id?: string };

const RUTA = "/compras/remitos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea (id null, queda en borrador) o actualiza un borrador con sus
 * renglones en una sola transacción (guardar_remito_compra). `datos` es el
 * JSON de RemitoCompraEnviado. Devuelve el id: el editor abre la dirección
 * de uno nuevo.
 */
export async function guardarRemitoCompra(id: string | null, datos: string): Promise<ResultadoRemitoCompra> {
  if (id !== null && !UUID.test(id)) return { error: "Remito inválido." };
  let enviado: unknown;
  try {
    enviado = JSON.parse(datos);
  } catch {
    return { error: "Los datos del remito no son válidos." };
  }
  const armado = armarRemitoCompra(enviado);
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardar_remito_compra", parametrosGuardarRemitoCompra(id, armado.armado));
  if (error) return { error: mensajeErrorRemitoCompra(error) };
  if (typeof data !== "string" || !UUID.test(data)) return { error: "No se pudo guardar el remito: la base no devolvió su id." };

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${data}`);
  return { ok: "Remito guardado.", id: data };
}

/** Registra un borrador como recibido (recibir_remito_compra). Después sólo se anula o se factura. */
export async function recibirRemitoCompra(id: string): Promise<ResultadoRemitoCompra> {
  if (!UUID.test(id)) return { error: "Remito inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("recibir_remito_compra", { p_id: id });
  if (error) return { error: mensajeErrorRemitoCompra(error, "recibir el remito") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return { ok: "Remito recibido.", id };
}

/** Anula un recibido sin nada facturado; conserva sus datos y libera el número (anular_remito_compra). */
export async function anularRemitoCompra(id: string): Promise<ResultadoRemitoCompra> {
  if (!UUID.test(id)) return { error: "Remito inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("anular_remito_compra", { p_id: id });
  if (error) return { error: mensajeErrorRemitoCompra(error, "anular el remito") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return { ok: "Remito anulado.", id };
}

/** Borra un borrador (los renglones se van en cascada) y vuelve al listado. */
export async function borrarRemitoCompra(id: string): Promise<ResultadoRemitoCompra> {
  if (!UUID.test(id)) return { error: "Remito inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("remito_compra")
    .delete()
    .eq("id", id)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { error: mensajeErrorRemitoCompra(error, "borrar el remito") };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar remitos en borrador. Uno recibido se anula." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/**
 * Factura renglones pendientes de remitos recibidos de un proveedor: crea
 * un borrador de factura (facturar_remitos_compra) y abre su editor.
 * `seleccion` es el JSON de SeleccionEnviada[] y `cabecera`, el de
 * CabeceraFacturaEnviada: del navegador sólo se toman qué renglones van,
 * cuánto y el número de la factura; lo pendiente se lee de la base, que
 * lo vuelve a controlar con candado.
 */
export async function facturarRemitosCompra(
  proveedorId: string,
  cabecera: string,
  seleccion: string,
): Promise<ResultadoRemitoCompra> {
  if (!UUID.test(proveedorId)) return { error: "Proveedor inválido." };
  let enviados: unknown;
  let cabeceraEnviada: unknown;
  try {
    enviados = JSON.parse(seleccion);
    cabeceraEnviada = JSON.parse(cabecera);
  } catch {
    return { error: "Los datos de la facturación no son válidos." };
  }

  const supabase = await createClient();
  const pendientes = await cargarPendientes(supabase, proveedorId);
  if (typeof pendientes === "string") return { error: pendientes };
  const aplicada = aplicarSeleccion(seleccionInicial(pendientes), enviados);
  if ("error" in aplicada) return { error: aplicada.error };
  const armado = armarFacturacion(aplicada.items, cabeceraEnviada);
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const { data, error } = await supabase.rpc("facturar_remitos_compra", armado.pedido);
  if (error) return { error: mensajeErrorFacturarRemitosCompra(error) };
  if (typeof data !== "string" || !UUID.test(data)) return { error: "No se pudo crear la factura: la base no devolvió su id." };

  revalidatePath(RUTA, "layout");
  revalidatePath("/compras/comprobantes");
  redirect(`/compras/comprobantes/${data}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { armarOrdenPago, leerOrdenEnviada } from "@/lib/compras/pagos/guardado";
import { mensajeErrorOrdenPago } from "@/lib/compras/pagos/errores";
import { validarMotivoAnulacion } from "@/lib/compras/pagos/anulacion";
import { resumenConfirmacion } from "@/lib/compras/pagos/listado";
import { cargarCheques, cargarCuentaProveedor, type CuentaProveedor } from "./datos";

// Como en cobranzas: las acciones devuelven el mensaje en lugar de lanzarlo.

export type ResultadoOrdenPago = {
  error?: string;
  ok?: string;
  id?: string;
  /** Texto de la confirmación. */
  resumen?: string;
};

const RUTA = "/compras/pagos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refresca las pantallas que cambian con una orden: comprobantes imputados, cartera y proveedor. */
function revalidarAlrededor(comprobantes: readonly string[], proveedorId: string | null) {
  revalidatePath("/compras/comprobantes");
  for (const id of new Set(comprobantes)) revalidatePath(`/compras/comprobantes/${id}`);
  revalidatePath("/cheques");
  if (proveedorId) revalidatePath(`/proveedores/${proveedorId}`);
}

/** Facturas y notas de débito con saldo y saldo a favor del proveedor, para el editor. */
export async function cuentaDelProveedor(proveedorId: string): Promise<CuentaProveedor | { error: string }> {
  if (!UUID.test(proveedorId)) return { error: "Proveedor inválido." };
  const supabase = await createClient();
  const cuenta = await cargarCuentaProveedor(supabase, proveedorId);
  return typeof cuenta === "string" ? { error: cuenta } : cuenta;
}

/**
 * Crea (id null) o reemplaza un borrador con sus medios e imputaciones en
 * una sola transacción (guardar_orden_pago). Valida en el servidor con las
 * mismas reglas que la pantalla, contra los saldos y la cartera actuales.
 */
export async function guardarOrdenPago(id: string | null, datos: string): Promise<ResultadoOrdenPago> {
  if (id !== null && !UUID.test(id)) return { error: "Orden de pago inválida." };
  let crudo: unknown;
  try {
    crudo = JSON.parse(datos);
  } catch {
    return { error: "Los datos de la orden de pago no son válidos." };
  }
  const enviada = leerOrdenEnviada(crudo);
  if (!enviada) return { error: "Los datos de la orden de pago no son válidos." };
  if (!enviada.proveedorId || !UUID.test(enviada.proveedorId)) return { error: "Elegí el proveedor." };
  const chequeIds = enviada.medios.flatMap((m) => (m.tipo === "cheque_tercero" && m.chequeId ? [m.chequeId] : []));
  if (chequeIds.some((c) => !UUID.test(c))) return { error: "Uno de los cheques elegidos no es válido." };

  const supabase = await createClient();
  const { data: proveedor, error: errorProveedor } = await supabase
    .from("proveedor")
    .select("nombre")
    .eq("id", enviada.proveedorId)
    .maybeSingle();
  if (errorProveedor) return { error: `No se pudo leer el proveedor: ${errorProveedor.message}` };
  if (!proveedor) return { error: "El proveedor ya no existe." };

  const [cuenta, cheques] = await Promise.all([
    cargarCuentaProveedor(supabase, enviada.proveedorId),
    cargarCheques(supabase, chequeIds),
  ]);
  if (typeof cuenta === "string") return { error: cuenta };
  if (typeof cheques === "string") return { error: cheques };

  const armado = armarOrdenPago(enviada, { debitos: cuenta.debitos, cheques });
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const { data: guardadoId, error } = await supabase.rpc("guardar_orden_pago", {
    p_id: id,
    p_orden: armado.guardar.orden,
    p_medios: armado.guardar.medios,
    p_imputaciones: armado.guardar.imputaciones,
  });
  if (error) return { error: mensajeErrorOrdenPago(error) };
  const nuevoId = String(guardadoId);

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${nuevoId}`);
  return {
    ok: "Borrador guardado.",
    id: nuevoId,
    resumen: resumenConfirmacion({
      total: armado.guardar.total,
      proveedor: proveedor.nombre,
      aFavor: armado.guardar.aFavor,
      cheques: chequeIds.length,
    }),
  };
}

/** Confirma el borrador: le asigna número, entrega sus cheques de terceros e imputa (confirmar_orden_pago). */
export async function confirmarOrdenPago(id: string): Promise<ResultadoOrdenPago> {
  if (!UUID.test(id)) return { error: "Orden de pago inválida." };
  const supabase = await createClient();
  const [{ data: orden }, { data: imputadas }] = await Promise.all([
    supabase.from("orden_pago").select("proveedor_id").eq("id", id).maybeSingle(),
    supabase.from("imputacion_compra").select("comprobante_compra_id").eq("orden_pago_id", id),
  ]);
  const { error } = await supabase.rpc("confirmar_orden_pago", { p_id: id });
  if (error) return { error: mensajeErrorOrdenPago(error, "confirmar la orden de pago") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  revalidarAlrededor(
    (imputadas ?? []).map((i) => i.comprobante_compra_id as string),
    (orden?.proveedor_id as string | undefined) ?? null,
  );
  return { ok: "Orden de pago confirmada.", id };
}

/** Borra un borrador; sus medios e imputaciones se van en cascada. */
export async function borrarOrdenPago(id: string): Promise<ResultadoOrdenPago> {
  if (!UUID.test(id)) return { error: "Orden de pago inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("orden_pago").delete().eq("id", id).eq("estado", "borrador").select("id");
  if (error) return { error: mensajeErrorOrdenPago(error, "borrar la orden de pago") };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar órdenes de pago en borrador." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/**
 * Anula una orden confirmada con un motivo (anular_orden_pago): se deshacen
 * sus imputaciones y sus cheques de terceros vuelven a la cartera.
 */
export async function anularOrdenPago(id: string, motivo: string): Promise<ResultadoOrdenPago> {
  if (!UUID.test(id)) return { error: "Orden de pago inválida." };
  const errorMotivo = validarMotivoAnulacion(motivo);
  if (errorMotivo) return { error: errorMotivo };
  const supabase = await createClient();

  // Los comprobantes que vuelven a quedar pendientes, para refrescar sus pantallas.
  const [{ data: imputadas }, { data: orden }] = await Promise.all([
    supabase.from("imputacion_compra").select("comprobante_compra_id").eq("orden_pago_id", id),
    supabase.from("orden_pago").select("proveedor_id").eq("id", id).maybeSingle(),
  ]);

  const { error } = await supabase.rpc("anular_orden_pago", { p_id: id, p_motivo: motivo.trim() });
  if (error) return { error: mensajeErrorOrdenPago(error, "anular la orden de pago") };

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  revalidarAlrededor(
    (imputadas ?? []).map((i) => i.comprobante_compra_id as string),
    (orden?.proveedor_id as string | undefined) ?? null,
  );
  return { ok: "Orden de pago anulada.", id };
}

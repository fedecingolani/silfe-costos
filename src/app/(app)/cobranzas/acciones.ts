"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { armarRecibo, leerReciboEnviado } from "@/lib/cobranzas/guardado";
import { mensajeErrorCobranza } from "@/lib/cobranzas/errores";
import { mensajeErrorAnulacion, validarMotivoAnulacion, type ChequeDelRecibo } from "@/lib/cobranzas/anulacion";
import { resumenEmision } from "@/lib/cobranzas/listado";
import { pesos } from "@/lib/formato";
import { cargarComprobanteContado, cargarDebitos, type CuentaCliente } from "./datos";

// Como en comprobantes: las acciones devuelven el mensaje en lugar de lanzarlo.

export type ResultadoRecibo = {
  error?: string;
  ok?: string;
  id?: string;
  /** Texto de la confirmación de emisión. */
  resumen?: string;
};

const RUTA = "/cobranzas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Débitos pendientes de cuenta corriente y saldo a favor del cliente, para el editor. */
export async function cuentaDelCliente(clienteId: string): Promise<CuentaCliente | { error: string }> {
  if (!UUID.test(clienteId)) return { error: "Cliente inválido." };
  const supabase = await createClient();
  const cuenta = await cargarDebitos(supabase, clienteId);
  return typeof cuenta === "string" ? { error: cuenta } : cuenta;
}

/**
 * Crea (id null) o reemplaza un borrador con sus medios, cheques e
 * imputaciones en una sola transacción (guardar_borrador_recibo). Valida en
 * el servidor con las mismas reglas que la pantalla, contra los saldos
 * actuales de la base.
 */
export async function guardarRecibo(id: string | null, datos: string): Promise<ResultadoRecibo> {
  if (id !== null && !UUID.test(id)) return { error: "Recibo inválido." };
  let crudo: unknown;
  try {
    crudo = JSON.parse(datos);
  } catch {
    return { error: "Los datos del recibo no son válidos." };
  }
  const enviado = leerReciboEnviado(crudo);
  if (!enviado) return { error: "Los datos del recibo no son válidos." };
  if (!enviado.clienteId || !UUID.test(enviado.clienteId)) return { error: "Elegí el cliente." };
  if (enviado.contadoId && !UUID.test(enviado.contadoId)) return { error: "Comprobante inválido." };

  const supabase = await createClient();
  const { data: cliente, error: errorCliente } = await supabase
    .from("cliente")
    .select("razon_social")
    .eq("id", enviado.clienteId)
    .maybeSingle();
  if (errorCliente) return { error: `No se pudo leer el cliente: ${errorCliente.message}` };
  if (!cliente) return { error: "El cliente ya no existe." };

  let contexto: Parameters<typeof armarRecibo>[1];
  if (enviado.contadoId) {
    const contado = await cargarComprobanteContado(supabase, enviado.contadoId);
    if (typeof contado === "string") return { error: contado };
    if (contado.clienteId !== enviado.clienteId) return { error: "El pago es del cliente de la factura." };
    contexto = { debitos: [], contado: { id: contado.id, total: contado.total, condicionPago: contado.condicionPago } };
  } else {
    const cuenta = await cargarDebitos(supabase, enviado.clienteId);
    if (typeof cuenta === "string") return { error: cuenta };
    contexto = { debitos: cuenta.debitos, contado: null };
  }

  const armado = armarRecibo(enviado, contexto);
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const { data: guardadoId, error } = await supabase.rpc("guardar_borrador_recibo", {
    p_id: id,
    p_recibo: armado.guardar.recibo,
    p_medios: armado.guardar.medios,
    p_imputaciones: armado.guardar.imputaciones,
  });
  if (error) return { error: mensajeErrorCobranza(error) };
  const nuevoId = String(guardadoId);

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${nuevoId}`);
  return {
    ok: "Borrador guardado.",
    id: nuevoId,
    resumen: resumenEmision(pesos(armado.guardar.total), cliente.razon_social),
  };
}

/** Emite el borrador: le asigna número y lo deja inmutable (emitir_recibo). */
export async function emitirRecibo(id: string): Promise<ResultadoRecibo> {
  if (!UUID.test(id)) return { error: "Recibo inválido." };
  const supabase = await createClient();
  const { data: contado } = await supabase.from("recibo").select("comprobante_contado_id").eq("id", id).maybeSingle();
  const { error } = await supabase.rpc("emitir_recibo", { p_id: id });
  if (error) return { error: mensajeErrorCobranza(error, "emitir el recibo") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  if (contado?.comprobante_contado_id) {
    revalidatePath("/comprobantes");
    revalidatePath(`/comprobantes/${contado.comprobante_contado_id}`);
  }
  return { ok: "Recibo emitido.", id };
}

/** Borra un borrador; sus medios, cheques e imputaciones se van en cascada. */
export async function borrarRecibo(id: string): Promise<ResultadoRecibo> {
  if (!UUID.test(id)) return { error: "Recibo inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("recibo").delete().eq("id", id).eq("estado", "borrador").select("id");
  if (error) return { error: mensajeErrorCobranza(error, "borrar el recibo") };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar recibos en borrador." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/**
 * Anula un recibo emitido con un motivo (anular_recibo): se deshacen sus
 * imputaciones y sus cheques salen de la cartera. Si algún cheque ya no está
 * en cartera (CB010), el mensaje dice cuáles y en qué estado.
 */
export async function anularRecibo(id: string, motivo: string): Promise<ResultadoRecibo> {
  if (!UUID.test(id)) return { error: "Recibo inválido." };
  const errorMotivo = validarMotivoAnulacion(motivo);
  if (errorMotivo) return { error: errorMotivo };
  const supabase = await createClient();

  // Los comprobantes que vuelven a quedar pendientes, para refrescar sus pantallas.
  const [{ data: imputados }, { data: recibo }] = await Promise.all([
    supabase.from("imputacion").select("comprobante_id").eq("recibo_id", id),
    supabase.from("recibo").select("cliente_id, comprobante_contado_id").eq("id", id).maybeSingle(),
  ]);

  const { error } = await supabase.rpc("anular_recibo", { p_id: id, p_motivo: motivo.trim() });
  if (error) {
    let cheques: ChequeDelRecibo[] = [];
    if (error.code === "CB010") {
      const { data } = await supabase.from("cheque").select("banco, numero, estado").eq("recibo_id", id).order("numero");
      cheques = (data ?? []) as ChequeDelRecibo[];
    }
    return { error: mensajeErrorAnulacion(error, cheques) };
  }

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  revalidatePath("/cheques");
  revalidatePath("/cuentas-corrientes");
  revalidatePath("/comprobantes");
  for (const comprobanteId of new Set([
    ...(imputados ?? []).map((i) => i.comprobante_id as string),
    ...(recibo?.comprobante_contado_id ? [recibo.comprobante_contado_id as string] : []),
  ])) {
    revalidatePath(`/comprobantes/${comprobanteId}`);
  }
  if (recibo?.cliente_id) revalidatePath(`/clientes/${recibo.cliente_id}`);
  return { ok: "Recibo anulado.", id };
}

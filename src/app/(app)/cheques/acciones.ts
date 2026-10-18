"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DESTINO_ACCION, validarCambioCheque, type AccionCheque, type DatosCambioCheque } from "@/lib/cobranzas/cartera";
import { mensajeErrorCobranza } from "@/lib/cobranzas/errores";
import type { EstadoCheque } from "@/lib/tipos";

// Como en comprobantes y cobranzas: las acciones devuelven el mensaje en lugar de lanzarlo.

export type ResultadoCheque = { error?: string; ok?: string };

const RUTA = "/cheques";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACCIONES: readonly AccionCheque[] = ["depositar", "entregar", "rechazar"];

function leerDatos(datos: string): DatosCambioCheque | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(datos);
  } catch {
    return null;
  }
  if (typeof crudo !== "object" || crudo === null) return null;
  const d = crudo as Record<string, unknown>;
  if (!(ACCIONES as readonly unknown[]).includes(d.accion)) return null;
  const textoONulo = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    accion: d.accion as AccionCheque,
    fecha: typeof d.fecha === "string" ? d.fecha : "",
    observacion: textoONulo(d.observacion),
    entregadoA: textoONulo(d.entregadoA),
    gastosImporte: typeof d.gastosImporte === "number" ? d.gastosImporte : d.gastosImporte == null ? null : Number.NaN,
    gastosDescripcion: textoONulo(d.gastosDescripcion),
  };
}

/**
 * Cambia el estado de un cheque de la cartera. Depositar y entregar
 * actualizan el cheque (el trigger controla la transición y escribe el
 * historial). Rechazar llama a rechazar_cheque, que en la misma transacción
 * crea el borrador de la nota de débito y deja el cheque rechazado con ella;
 * después abre la ND en el editor.
 */
export async function cambiarEstadoCheque(id: string, datos: string): Promise<ResultadoCheque> {
  if (!UUID.test(id)) return { error: "Cheque inválido." };
  const leidos = leerDatos(datos);
  if (!leidos) return { error: "Los datos del cambio de estado no son válidos." };

  const supabase = await createClient();
  const { data: cheque, error: errorCheque } = await supabase
    .from("cheque")
    .select("estado, recibo_id")
    .eq("id", id)
    .maybeSingle();
  if (errorCheque) return { error: `No se pudo leer el cheque: ${errorCheque.message}` };
  if (!cheque) return { error: "No se encontró el cheque." };

  const validado = validarCambioCheque(cheque.estado as EstadoCheque, leidos);
  if ("errores" in validado) return { error: validado.errores.join(" ") };
  const { cambio } = validado;

  if (cambio.accion === "rechazar") {
    const { data: ndId, error } = await supabase.rpc("rechazar_cheque", {
      p_cheque_id: id,
      p_fecha: cambio.fecha,
      p_observacion: cambio.observacion,
      p_gastos: cambio.gastos,
    });
    if (error) return { error: mensajeErrorCobranza(error, "rechazar el cheque") };
    revalidatePath(RUTA);
    revalidatePath(`${RUTA}/${id}`);
    revalidatePath(`/cobranzas/${cheque.recibo_id}`);
    revalidatePath("/comprobantes");
    redirect(`/comprobantes/${String(ndId)}`);
  }

  const { data, error } = await supabase
    .from("cheque")
    .update({
      estado: DESTINO_ACCION[cambio.accion],
      estado_fecha: cambio.fecha,
      estado_observacion: cambio.observacion,
      ...(cambio.accion === "entregar" ? { entregado_a: cambio.entregadoA } : {}),
    })
    .eq("id", id)
    .eq("estado", cheque.estado)
    .select("id");
  if (error) return { error: mensajeErrorCobranza(error, "cambiar el estado del cheque") };
  if ((data ?? []).length !== 1) return { error: "El cheque cambió de estado. Recargá la página." };

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  revalidatePath(`/cobranzas/${cheque.recibo_id}`);
  return { ok: cambio.accion === "depositar" ? "Cheque depositado." : "Cheque entregado." };
}

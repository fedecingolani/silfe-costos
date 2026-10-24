"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import type { ItemGuardado } from "@/lib/comprobantes/borrador";
import { armarPresupuesto, mensajeErrorGuardado } from "@/lib/presupuestos/borrador";
import { cabeceraDuplicada, type CabeceraOrigen } from "@/lib/presupuestos/editor";
import { productosPorId } from "./datos";

// Como en comprobantes, las acciones devuelven el mensaje de error en lugar
// de lanzarlo (Next enmascara en producción los errores de las acciones).
// El buscador de clientes y los precios de una lista son los de
// comprobantes (buscarClientes, preciosDeLista en ../comprobantes/acciones).

export type ResultadoPresupuesto = { error?: string; ok?: string };

const RUTA = "/presupuestos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea (id null) o actualiza un presupuesto abierto con sus ítems en una sola
 * transacción (guardar_presupuesto). `datos` es el JSON de
 * PresupuestoEnviado: importes y totales se recalculan acá, nunca se toman
 * del navegador. Uno nuevo abre su dirección; uno editado devuelve "ok".
 */
export async function guardarPresupuesto(id: string | null, datos: string): Promise<ResultadoPresupuesto> {
  if (id !== null && !UUID.test(id)) return { error: "Presupuesto inválido." };
  let enviado: unknown;
  try {
    enviado = JSON.parse(datos);
  } catch {
    return { error: "Los datos del presupuesto no son válidos." };
  }

  const supabase = await createClient();
  const items = (enviado as { items?: unknown })?.items;
  const ids = Array.isArray(items)
    ? [
        ...new Set(
          items
            .map((i) => (i as { productoId?: unknown })?.productoId)
            .filter((v): v is string => typeof v === "string" && UUID.test(v)),
        ),
      ]
    : [];
  const productos = await productosPorId(supabase, ids);
  if (typeof productos === "string") return { error: productos };

  const armado = armarPresupuesto(enviado, { productos });
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const { data: guardadoId, error } = await supabase.rpc("guardar_presupuesto", {
    p_id: id,
    p_presupuesto: armado.presupuesto.cabecera,
    p_items: armado.presupuesto.items,
  });
  if (error) return { error: mensajeErrorGuardado(error) };
  const nuevoId = String(guardadoId);

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${nuevoId}`);
  if (id === null) redirect(`${RUTA}/${nuevoId}`);
  return { ok: "Presupuesto guardado." };
}

/** Borra un presupuesto abierto (los ítems se van en cascada) y vuelve al listado. */
export async function borrarPresupuesto(id: string): Promise<ResultadoPresupuesto> {
  if (!UUID.test(id)) return { error: "Presupuesto inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("presupuesto")
    .delete()
    .eq("id", id)
    .eq("estado", "abierto")
    .select("id");
  if (error) return { error: mensajeErrorGuardado(error) };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar presupuestos abiertos." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/**
 * Crea un presupuesto abierto nuevo copiado de otro (abierto o convertido):
 * mismo cliente, cabecera e ítems tal cual, fecha de hoy y validez por
 * defecto. Abre el nuevo.
 */
export async function duplicarPresupuesto(id: string): Promise<ResultadoPresupuesto> {
  if (!UUID.test(id)) return { error: "Presupuesto inválido." };
  const supabase = await createClient();
  const [{ data: p, error }, { data: items, error: errorItems }] = await Promise.all([
    supabase
      .from("presupuesto")
      .select(
        "cliente_id, fecha_vencimiento_pago, condicion_pago, lista_precio_id, observaciones, neto, no_gravado, iva, total",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("presupuesto_item")
      .select(
        "producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, gravado, alicuota_iva, importe, iva",
      )
      .eq("presupuesto_id", id)
      .order("orden"),
  ]);
  const errorCarga = error ?? errorItems;
  if (errorCarga) return { error: `No se pudo leer el presupuesto: ${errorCarga.message}` };
  if (!p) return { error: "No se encontró el presupuesto." };

  const { data: nuevoId, error: errorGuardar } = await supabase.rpc("guardar_presupuesto", {
    p_id: null,
    p_presupuesto: cabeceraDuplicada(p as CabeceraOrigen, hoyArgentina()),
    p_items: (items ?? []) as ItemGuardado[],
  });
  if (errorGuardar) return { error: mensajeErrorGuardado(errorGuardar) };

  revalidatePath(RUTA);
  redirect(`${RUTA}/${String(nuevoId)}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { armarRemito, datosDeEntregaDelCliente, parametrosGuardarRemito } from "@/lib/remitos/borrador";
import { mensajeErrorRemito } from "@/lib/remitos/errores";
import { productosPorId } from "../presupuestos/datos";

// Como en presupuestos y comprobantes, las acciones devuelven el mensaje de
// error en lugar de lanzarlo (Next enmascara en producción los errores de
// las acciones). El buscador de clientes y los precios de una lista son los
// de comprobantes (buscarClientes, preciosDeLista en ../comprobantes/acciones).

export type ResultadoRemito = { error?: string; ok?: string };

const RUTA = "/remitos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea (id null, queda en borrador) o actualiza un remito con sus ítems en
 * una sola transacción (guardar_remito). `datos` es el JSON de RemitoEnviado:
 * importes, totales y valor declarado se arman acá con armarRemito, nunca se
 * toman del navegador. Uno nuevo abre su dirección; uno editado devuelve "ok".
 */
export async function guardarRemito(id: string | null, datos: string): Promise<ResultadoRemito> {
  if (id !== null && !UUID.test(id)) return { error: "Remito inválido." };
  let enviado: unknown;
  try {
    enviado = JSON.parse(datos);
  } catch {
    return { error: "Los datos del remito no son válidos." };
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

  const armado = armarRemito(enviado, { productos });
  if ("errores" in armado) return { error: armado.errores.join(" ") };

  const { data: guardadoId, error } = await supabase.rpc("guardar_remito", parametrosGuardarRemito(id, armado.remito));
  if (error) return { error: mensajeErrorRemito(error) };
  const nuevoId = String(guardadoId);

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${nuevoId}`);
  if (id === null) redirect(`${RUTA}/${nuevoId}`);
  return { ok: "Remito guardado." };
}

/** Emite un borrador: toma el próximo número de su punto de venta (emitir_remito). */
export async function emitirRemito(id: string): Promise<ResultadoRemito> {
  if (!UUID.test(id)) return { error: "Remito inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("emitir_remito", { p_id: id });
  if (error) return { error: mensajeErrorRemito(error, "emitir el remito") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return { ok: "Remito emitido." };
}

/** Anula un emitido sin nada facturado; conserva el número (anular_remito). */
export async function anularRemito(id: string): Promise<ResultadoRemito> {
  if (!UUID.test(id)) return { error: "Remito inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("anular_remito", { p_id: id });
  if (error) return { error: mensajeErrorRemito(error, "anular el remito") };
  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return { ok: "Remito anulado." };
}

/** Borra un borrador (los ítems se van en cascada) y vuelve al listado. */
export async function borrarRemito(id: string): Promise<ResultadoRemito> {
  if (!UUID.test(id)) return { error: "Remito inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("remito")
    .delete()
    .eq("id", id)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { error: mensajeErrorRemito(error, "borrar el remito") };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar remitos en borrador. Un remito emitido se anula." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/**
 * Transporte y domicilio de entrega con que arranca un remito al elegir el
 * cliente (datosDeEntregaDelCliente). null si no se pudo leer el cliente:
 * el editor deja los valores como están.
 */
export async function datosDeEntrega(clienteId: string): Promise<{ transporteId: string; domicilioEntrega: string } | null> {
  if (!UUID.test(clienteId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cliente")
    .select("transporte_id, direccion, localidad, provincia")
    .eq("id", clienteId)
    .maybeSingle();
  if (error || !data) return null;
  return datosDeEntregaDelCliente(data);
}

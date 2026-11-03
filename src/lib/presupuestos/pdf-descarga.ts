/**
 * Carga lo que necesita el PDF de un presupuesto (abierto o convertido): el
 * presupuesto, sus ítems, el cliente, los datos del emisor y el logo. Sólo
 * columnas explícitas; nunca nada de arca_credencial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COLUMNAS_EMISOR_PDF,
  COLUMNAS_ITEM_PDF,
  type DatosPdfComprobante,
  type FilaEmisorPdf,
  type FilaItemPdf,
} from "@/lib/comprobantes/pdf-datos";
import { leerLogoEmpresa } from "@/lib/empresa/logo";
import { esUuid } from "@/lib/listas-precios/uuid";
import {
  COLUMNAS_CLIENTE_PDF,
  COLUMNAS_PRESUPUESTO_PDF,
  armarDatosPdfPresupuesto,
  type ClientePdfPresupuesto,
  type FilaPresupuestoPdf,
} from "./pdf-datos";

export type ResultadoPdfPresupuesto =
  | { ok: true; datos: DatosPdfComprobante; logo: Uint8Array | null }
  | { ok: false; respuesta: Response };

function respuestaError(mensaje: string, status: number): ResultadoPdfPresupuesto {
  return {
    ok: false,
    respuesta: new Response(mensaje, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

export async function cargarPdfPresupuesto({
  id,
  cliente: supabase,
}: {
  id: string;
  /** Cliente de Supabase con la sesión del usuario. */
  cliente: SupabaseClient;
}): Promise<ResultadoPdfPresupuesto> {
  if (!esUuid(id)) return respuestaError("El presupuesto no existe.", 404);

  const [presupuesto, items, emisor] = await Promise.all([
    supabase.from("presupuesto").select(COLUMNAS_PRESUPUESTO_PDF).eq("id", id).maybeSingle(),
    supabase.from("presupuesto_item").select(COLUMNAS_ITEM_PDF).eq("presupuesto_id", id).order("orden"),
    supabase.from("arca_emisor").select(COLUMNAS_EMISOR_PDF).eq("id", true).maybeSingle(),
  ]);
  if (presupuesto.error) return respuestaError(`Error al cargar el presupuesto: ${presupuesto.error.message}`, 500);
  if (!presupuesto.data) return respuestaError("El presupuesto no existe.", 404);
  if (items.error) return respuestaError(`Error al cargar los ítems: ${items.error.message}`, 500);
  if (emisor.error) return respuestaError(`Error al cargar los datos del emisor: ${emisor.error.message}`, 500);

  const p = presupuesto.data as unknown as FilaPresupuestoPdf & { cliente_id: string };
  const cliente = await supabase.from("cliente").select(COLUMNAS_CLIENTE_PDF).eq("id", p.cliente_id).maybeSingle();
  if (cliente.error) return respuestaError(`Error al cargar el cliente: ${cliente.error.message}`, 500);

  const logo = (await leerLogoEmpresa(supabase))?.bytes ?? null;
  const datos = armarDatosPdfPresupuesto({
    presupuesto: p,
    cliente: cliente.data as ClientePdfPresupuesto | null,
    items: (items.data ?? []) as unknown as FilaItemPdf[],
    emisor: emisor.data as FilaEmisorPdf | null,
  });
  for (const aviso of datos.inconsistencias) console.warn(`PDF del presupuesto ${id}: ${aviso}`);
  return { ok: true, datos, logo };
}

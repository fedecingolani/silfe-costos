/**
 * Carga lo que necesita el PDF de un remito emitido (o anulado, parcial o
 * facturado): el remito, sus ítems, el cliente, el transporte, los datos del
 * emisor y el logo, el nombre de fantasía y el contacto de la empresa. Sólo
 * columnas explícitas; nunca nada de arca_credencial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUMNAS_EMISOR_PDF, type FilaEmisorPdf } from "@/lib/comprobantes/pdf-datos";
import { leerEmpresaPdf } from "@/lib/empresa/pdf-empresa";
import { esUuid } from "@/lib/listas-precios/uuid";
import {
  COLUMNAS_CLIENTE_REMITO_PDF,
  COLUMNAS_ITEM_REMITO_PDF,
  COLUMNAS_REMITO_PDF,
  armarDatosPdfRemito,
  puedeImprimirRemito,
  type ClientePdfRemito,
  type DatosPdfRemito,
  type FilaItemRemitoPdf,
  type FilaRemitoPdf,
} from "./pdf-datos";

export type ResultadoPdfRemito =
  | { ok: true; datos: DatosPdfRemito; logo: Uint8Array | null }
  | { ok: false; respuesta: Response };

function respuestaError(mensaje: string, status: number): ResultadoPdfRemito {
  return {
    ok: false,
    respuesta: new Response(mensaje, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

export async function cargarPdfRemito({
  id,
  cliente: supabase,
}: {
  id: string;
  /** Cliente de Supabase con la sesión del usuario. */
  cliente: SupabaseClient;
}): Promise<ResultadoPdfRemito> {
  if (!esUuid(id)) return respuestaError("El remito no existe.", 404);

  const remito = await supabase.from("remito").select(COLUMNAS_REMITO_PDF).eq("id", id).maybeSingle();
  if (remito.error) return respuestaError(`Error al cargar el remito: ${remito.error.message}`, 500);
  if (!remito.data) return respuestaError("El remito no existe.", 404);
  const r = remito.data as unknown as FilaRemitoPdf & { cliente_id: string; transporte_id: string | null };
  const imprimible = puedeImprimirRemito(r);
  if (!imprimible.ok) return respuestaError(imprimible.motivo, imprimible.status);

  const [items, clienteRes, transporte, emisor] = await Promise.all([
    supabase.from("remito_item").select(COLUMNAS_ITEM_REMITO_PDF).eq("remito_id", id).order("orden"),
    supabase.from("cliente").select(COLUMNAS_CLIENTE_REMITO_PDF).eq("id", r.cliente_id).maybeSingle(),
    r.transporte_id
      ? supabase.from("transporte").select("nombre").eq("id", r.transporte_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("arca_emisor").select(COLUMNAS_EMISOR_PDF).eq("id", true).maybeSingle(),
  ]);
  const error = items.error ?? clienteRes.error ?? transporte.error ?? emisor.error;
  if (error) return respuestaError(`Error al cargar los datos del remito: ${error.message}`, 500);

  const { logo, identidad } = await leerEmpresaPdf(supabase);
  const datos = armarDatosPdfRemito({
    remito: r,
    cliente: clienteRes.data as ClientePdfRemito | null,
    transporte: (transporte.data as { nombre: string } | null)?.nombre ?? null,
    items: (items.data ?? []) as unknown as FilaItemRemitoPdf[],
    emisor: emisor.data as FilaEmisorPdf | null,
    identidad,
  });
  for (const aviso of datos.inconsistencias) console.warn(`PDF del remito ${id}: ${aviso}`);
  return { ok: true, datos, logo };
}

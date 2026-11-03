/**
 * Carga lo que necesita el PDF de un comprobante: el comprobante, sus
 * ítems, los datos del emisor, si el punto de venta es electrónico y el
 * logo. Sólo columnas explícitas; nunca nada de arca_credencial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerLogoEmpresa } from "@/lib/empresa/logo";
import { esUuid } from "@/lib/listas-precios/uuid";
import { datosAsociado, leerAsociados } from "./asociados-carga";
import {
  COLUMNAS_COMPROBANTE_PDF,
  COLUMNAS_EMISOR_PDF,
  COLUMNAS_ITEM_PDF,
  armarDatosPdf,
  dispositionEnLinea,
  puedeImprimir,
  type DatosPdfComprobante,
  type FilaComprobantePdf,
  type FilaEmisorPdf,
  type FilaItemPdf,
} from "./pdf-datos";

export type ResultadoPdf =
  | { ok: true; datos: DatosPdfComprobante; logo: Uint8Array | null }
  | { ok: false; respuesta: Response };

export type OpcionesPdf = {
  id: string;
  /** Cliente de Supabase con la sesión del usuario. */
  cliente: SupabaseClient;
};

function respuestaError(mensaje: string, status: number): ResultadoPdf {
  return {
    ok: false,
    respuesta: new Response(mensaje, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

export async function cargarPdfComprobante({
  id,
  cliente,
}: OpcionesPdf): Promise<ResultadoPdf> {
  if (!esUuid(id)) return respuestaError("El comprobante no existe.", 404);

  const [comprobante, items, emisor] = await Promise.all([
    cliente.from("comprobante").select(COLUMNAS_COMPROBANTE_PDF).eq("id", id).maybeSingle(),
    cliente.from("comprobante_item").select(COLUMNAS_ITEM_PDF).eq("comprobante_id", id).order("orden"),
    cliente.from("arca_emisor").select(COLUMNAS_EMISOR_PDF).eq("id", true).maybeSingle(),
  ]);
  if (comprobante.error) return respuestaError(`Error al cargar el comprobante: ${comprobante.error.message}`, 500);
  if (!comprobante.data) return respuestaError("El comprobante no existe.", 404);
  if (items.error) return respuestaError(`Error al cargar los ítems: ${items.error.message}`, 500);
  if (emisor.error) return respuestaError(`Error al cargar los datos del emisor: ${emisor.error.message}`, 500);

  const c = comprobante.data as unknown as FilaComprobantePdf;
  const puntoVenta = await cliente
    .from("punto_venta")
    .select("electronico")
    .eq("numero", c.punto_venta)
    .maybeSingle();
  if (puntoVenta.error) return respuestaError(`Error al cargar el punto de venta: ${puntoVenta.error.message}`, 500);

  const datosEmisor = emisor.data as FilaEmisorPdf | null;
  const imprimible = puedeImprimir({
    ...c,
    puntoVentaElectronico: puntoVenta.data?.electronico === true,
    cuitEmisor: datosEmisor?.cuit,
  });
  if (!imprimible.ok) return respuestaError(imprimible.motivo, imprimible.status);

  const asociados = c.clase === "factura" ? [] : await leerAsociados(cliente, id);
  if (typeof asociados === "string") return respuestaError(asociados, 500);

  const logo = (await leerLogoEmpresa(cliente))?.bytes ?? null;
  const datos = armarDatosPdf({
    comprobante: c,
    items: (items.data ?? []) as unknown as FilaItemPdf[],
    emisor: datosEmisor!,
    asociados: asociados.map(datosAsociado),
  });
  // No se corta la impresión: se deja rastro para revisar el comprobante.
  for (const aviso of datos.inconsistencias) console.warn(`PDF del comprobante ${c.id}: ${aviso}`);
  return { ok: true, datos, logo };
}

/** Respuesta con el PDF para abrir en el navegador. */
export function respuestaPdf(bytes: Uint8Array, nombre: string): Response {
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": dispositionEnLinea(nombre),
      "Cache-Control": "private, no-store",
    },
  });
}

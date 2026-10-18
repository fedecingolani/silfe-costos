/**
 * Carga lo que necesita el PDF de un recibo: el recibo, su cliente, sus
 * medios (con los cheques), sus imputaciones (con los comprobantes), los
 * datos del emisor y el logo. Sólo columnas explícitas; nunca nada de
 * arca_credencial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MS_LOGO } from "@/lib/listas-precios/cargar-descarga";
import { esUuid } from "@/lib/listas-precios/uuid";
import { COLUMNAS_EMISOR_PDF, type FilaEmisorPdf } from "@/lib/comprobantes/pdf-datos";
import { cargarLogo } from "@/lib/comprobantes/pdf-descarga";
import {
  COLUMNAS_CLIENTE_RECIBO_PDF,
  COLUMNAS_IMPUTACION_RECIBO_PDF,
  COLUMNAS_MEDIO_RECIBO_PDF,
  COLUMNAS_RECIBO_PDF,
  armarDatosPdfRecibo,
  puedeImprimirRecibo,
  type DatosPdfRecibo,
  type FilaClienteReciboPdf,
  type FilaImputacionReciboPdf,
  type FilaMedioReciboPdf,
  type FilaReciboPdf,
} from "./pdf-recibo-datos";

type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ResultadoPdfRecibo =
  | { ok: true; datos: DatosPdfRecibo; logo: Uint8Array | null }
  | { ok: false; respuesta: Response };

function respuestaError(mensaje: string, status: number): ResultadoPdfRecibo {
  return {
    ok: false,
    respuesta: new Response(mensaje, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

export async function cargarPdfRecibo({
  id,
  url,
  cliente,
  fetch: fetchLogo = fetch,
  msLogo = MS_LOGO,
}: {
  id: string;
  /** URL del pedido: el logo se pide al mismo origen. */
  url: string;
  /** Cliente de Supabase con la sesión del usuario. */
  cliente: SupabaseClient;
  fetch?: Fetch;
  msLogo?: number;
}): Promise<ResultadoPdfRecibo> {
  if (!esUuid(id)) return respuestaError("El recibo no existe.", 404);

  const recibo = await cliente.from("recibo").select(COLUMNAS_RECIBO_PDF).eq("id", id).maybeSingle();
  if (recibo.error) return respuestaError(`Error al cargar el recibo: ${recibo.error.message}`, 500);
  if (!recibo.data) return respuestaError("El recibo no existe.", 404);
  const r = recibo.data as unknown as FilaReciboPdf & { cliente_id: string };
  const imprimible = puedeImprimirRecibo(r.estado);
  if (!imprimible.ok) return respuestaError(imprimible.motivo, imprimible.status);

  const [clienteRes, medios, imputaciones, emisor] = await Promise.all([
    cliente.from("cliente").select(COLUMNAS_CLIENTE_RECIBO_PDF).eq("id", r.cliente_id).maybeSingle(),
    cliente.from("recibo_medio").select(COLUMNAS_MEDIO_RECIBO_PDF).eq("recibo_id", id).order("orden"),
    cliente.from("imputacion").select(COLUMNAS_IMPUTACION_RECIBO_PDF).eq("recibo_id", id).order("creado_en"),
    cliente.from("arca_emisor").select(COLUMNAS_EMISOR_PDF).eq("id", true).maybeSingle(),
  ]);
  const error = clienteRes.error ?? medios.error ?? imputaciones.error ?? emisor.error;
  if (error) return respuestaError(`Error al cargar los datos del recibo: ${error.message}`, 500);
  if (!clienteRes.data) return respuestaError("No se encontró el cliente del recibo.", 500);

  const logo = await cargarLogo(url, fetchLogo, msLogo);
  const datos = armarDatosPdfRecibo({
    recibo: r,
    cliente: clienteRes.data as unknown as FilaClienteReciboPdf,
    medios: (medios.data ?? []) as unknown as FilaMedioReciboPdf[],
    imputaciones: (imputaciones.data ?? []) as unknown as FilaImputacionReciboPdf[],
    emisor: (emisor.data ?? null) as FilaEmisorPdf | null,
  });
  return { ok: true, datos, logo };
}

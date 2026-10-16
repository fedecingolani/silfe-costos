import { createClient } from "@/lib/supabase/server";
import { generarPdfComprobante } from "@/lib/comprobantes/pdf";
import { cargarPdfComprobante, respuestaPdf } from "@/lib/comprobantes/pdf-descarga";

export const dynamic = "force-dynamic";

/** PDF del comprobante autorizado, para abrir en el navegador (el middleware ya exige sesión). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await cargarPdfComprobante({ id, url: request.url, cliente: await createClient() });
  if (!resultado.ok) return resultado.respuesta;

  const bytes = await generarPdfComprobante(resultado.datos, resultado.logo);
  return respuestaPdf(bytes, resultado.datos.nombreArchivo);
}

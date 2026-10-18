import { createClient } from "@/lib/supabase/server";
import { respuestaPdf } from "@/lib/comprobantes/pdf-descarga";
import { generarPdfRecibo } from "@/lib/cobranzas/pdf-recibo";
import { cargarPdfRecibo } from "@/lib/cobranzas/pdf-recibo-descarga";

export const dynamic = "force-dynamic";

/** PDF del recibo emitido o anulado (409 si es borrador), para abrir en el navegador (el middleware exige sesión). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await cargarPdfRecibo({ id, url: request.url, cliente: await createClient() });
  if (!resultado.ok) return resultado.respuesta;

  const bytes = await generarPdfRecibo(resultado.datos, resultado.logo);
  return respuestaPdf(bytes, resultado.datos.nombreArchivo);
}

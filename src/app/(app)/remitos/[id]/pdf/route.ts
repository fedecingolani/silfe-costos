import { createClient } from "@/lib/supabase/server";
import { respuestaPdf } from "@/lib/comprobantes/pdf-descarga";
import { generarPdfRemito } from "@/lib/remitos/pdf";
import { cargarPdfRemito } from "@/lib/remitos/pdf-descarga";

export const dynamic = "force-dynamic";

/** PDF del remito emitido (409 si es borrador), para abrir en el navegador (el middleware exige sesión). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await cargarPdfRemito({ id, cliente: await createClient() });
  if (!resultado.ok) return resultado.respuesta;

  const bytes = await generarPdfRemito(resultado.datos, resultado.logo);
  return respuestaPdf(bytes, resultado.datos.nombreArchivo);
}

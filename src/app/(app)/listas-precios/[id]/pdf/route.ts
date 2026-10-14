import { generarPdf } from "@/lib/listas-precios/pdf";
import { cargarDatosDescarga, respuestaArchivo } from "../descarga";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await cargarDatosDescarga(id, request, true);
  if (!resultado.ok) return resultado.respuesta;

  const bytes = await generarPdf(resultado.datos);
  return respuestaArchivo(bytes, resultado.nombre, "pdf", "application/pdf");
}

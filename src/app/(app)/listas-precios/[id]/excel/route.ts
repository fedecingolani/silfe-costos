import { generarExcel } from "@/lib/listas-precios/excel";
import { cargarDatosDescarga, respuestaArchivo } from "../descarga";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await cargarDatosDescarga(id, request, false);
  if (!resultado.ok) return resultado.respuesta;

  const bytes = generarExcel(resultado.datos);
  return respuestaArchivo(
    bytes,
    resultado.nombre,
    "xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

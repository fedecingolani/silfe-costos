import { createClient } from "@/lib/supabase/server";
import { cargarDatosDescarga as cargar, type ResultadoDescarga } from "@/lib/listas-precios/cargar-descarga";

export { respuestaArchivo } from "@/lib/listas-precios/cargar-descarga";

/**
 * Carga los datos de la descarga con la sesión del usuario (el middleware
 * ya exige sesión en las rutas de la app).
 */
export async function cargarDatosDescarga(id: string, request: Request, conLogo: boolean): Promise<ResultadoDescarga> {
  return cargar({ id, url: request.url, conLogo, cliente: await createClient() });
}

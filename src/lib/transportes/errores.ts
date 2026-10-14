/**
 * Mensajes legibles para los errores de la base al guardar o borrar
 * transportes. Las acciones los devuelven en lugar de lanzarlos: en
 * producción Next reemplaza el mensaje de un error lanzado por uno genérico.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string };

export const MENSAJE_TRANSPORTE_EN_USO =
  "El transporte está asignado a clientes o sucursales: desactivalo en lugar de borrarlo.";

export function mensajeErrorTransporte(accion: string, error: ErrorBase): string {
  // La única restricción única de transporte, además de la clave, es el nombre.
  if (error.code === "23505") return "Ya existe un transporte con ese nombre.";
  if (error.code === "23503") return MENSAJE_TRANSPORTE_EN_USO;
  return `No se pudo ${accion} el transporte: ${error.message}`;
}

/**
 * Mensajes legibles para los errores de la base al guardar o borrar
 * proveedores y artículos del proveedor. Las acciones los devuelven en lugar
 * de lanzarlos: en producción Next reemplaza el mensaje de un error lanzado
 * por uno genérico.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string };

export const MENSAJE_ARTICULO_EN_USO =
  "El artículo se usa en comprobantes o remitos: hay que desactivarlo en lugar de borrarlo.";

/** Índice único (nombre en la base) → mensaje. */
const UNICOS: Record<string, string> = {
  proveedor_nombre_uq: "Ya existe un proveedor con ese nombre.",
  proveedor_articulo_codigo_uq: "Este proveedor ya tiene un artículo con ese código.",
  proveedor_articulo_descripcion_uq: "Este proveedor ya tiene un artículo sin código con esa descripción.",
};

function mensajeUnico(error: ErrorBase): string | null {
  if (error.code !== "23505") return null;
  const clave = Object.keys(UNICOS).find((nombre) => error.message.includes(`"${nombre}"`));
  return clave ? UNICOS[clave] : null;
}

export function mensajeErrorProveedor(accion: string, error: ErrorBase): string {
  return mensajeUnico(error) ?? `No se pudo ${accion} el proveedor: ${error.message}`;
}

export function mensajeErrorArticulo(accion: string, error: ErrorBase): string {
  const unico = mensajeUnico(error);
  if (unico) return unico;
  // Al borrar, la clave foránea rota es un comprobante que usa el artículo; al
  // guardar, es la materia prima o el proveedor que se borró mientras tanto.
  if (error.code === "23503") {
    return accion === "eliminar" ? MENSAJE_ARTICULO_EN_USO : "La materia prima o el proveedor ya no existen. Recargá la página.";
  }
  return `No se pudo ${accion} el artículo: ${error.message}`;
}

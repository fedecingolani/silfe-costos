/**
 * Mensajes legibles para los errores de la base al guardar bancos
 * (20261114000002_bancos.sql y 20261114000004_bancos_referencias.sql). Las
 * acciones los devuelven en lugar de lanzarlos: en producción Next reemplaza
 * el mensaje de un error lanzado por uno genérico.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string };

/** Los cheques no acompañan el cambio de nombre: son inmutables. */
export const MENSAJE_BANCO_EN_CHEQUES =
  "Este banco está en cheques cargados: no se puede renombrar. Desactivalo y creá otro.";

/** Restricción (nombre en la base) → mensaje. */
const RESTRICCIONES: Record<string, string> = {
  banco_nombre_key: "Ya existe un banco con ese nombre.",
  banco_nombre_clave_uq: "Ya existe un banco activo con ese nombre (sin contar mayúsculas, tildes ni espacios).",
  banco_nombre_check: "El nombre del banco es obligatorio.",
  cheque_banco_fkey: MENSAJE_BANCO_EN_CHEQUES,
};

export function mensajeErrorBanco(accion: string, error: ErrorBase): string {
  if (error.code === "23505" || error.code === "23514" || error.code === "23503") {
    const clave = Object.keys(RESTRICCIONES).find((nombre) => error.message.includes(`"${nombre}"`));
    if (clave) return RESTRICCIONES[clave];
  }
  return `No se pudo ${accion} el banco: ${error.message}`;
}

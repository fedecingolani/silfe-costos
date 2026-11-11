/**
 * Mensajes legibles de los errores de la base de Finanzas (SQLSTATE FN0xx,
 * ver 20261111000001_finanzas_cuentas.sql) y de los checks e índices de
 * cuenta_fondos y ajuste_fondos. Las acciones los devuelven en lugar de
 * lanzarlos: en producción Next reemplaza el mensaje de un error lanzado.
 */

export type ErrorBase = { code?: string; message: string };

const PROPIOS: Record<string, string> = {
  FN001: "El ajuste ya no se puede modificar. Recargue la página.",
  FN002: "Un ajuste nuevo no puede nacer anulado.",
  FN003: "Los ajustes no se borran: se anulan con un motivo.",
  FN004: "La cuenta está inactiva: no admite ajustes nuevos.",
  FN005: "El motivo de la anulación es obligatorio.",
  FN006: "No se puede cambiar el tipo de la cuenta (banco o caja).",
  "23503": "La cuenta ya no existe. Recargue la página.",
};

/** Restricción (nombre en la base) → mensaje. */
const RESTRICCIONES: Record<string, string> = {
  cuenta_fondos_nombre_uq: "Ya existe una cuenta (de banco o de caja) con ese nombre.",
  cuenta_fondos_cbu_check: "El CBU tiene que tener 22 dígitos.",
  cuenta_fondos_nombre_check: "El nombre de la cuenta es obligatorio.",
  cuenta_fondos_caja_sin_banco_check: "Una caja no lleva datos bancarios.",
  ajuste_fondos_importe_check: "El importe tiene que ser mayor que cero.",
  ajuste_fondos_concepto_check: "El concepto es obligatorio.",
};

export function mensajeErrorFinanzas(error: ErrorBase, contexto: string): string {
  const code = error.code ?? "";
  if (code === "23505" || code === "23514") {
    const clave = Object.keys(RESTRICCIONES).find((nombre) => error.message.includes(`"${nombre}"`));
    if (clave) return RESTRICCIONES[clave];
  }
  return PROPIOS[code] ?? `No se pudo ${contexto}: ${error.message}`;
}

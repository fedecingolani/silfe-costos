/**
 * Mensajes legibles de los errores de la base de Finanzas (SQLSTATE FN0xx,
 * ver 20261111000001_finanzas_cuentas.sql) y de los checks e índices de
 * cuenta_fondos, ajuste_fondos y transferencia_fondos. Las acciones los devuelven en lugar de
 * lanzarlos: en producción Next reemplaza el mensaje de un error lanzado.
 * La caja en negativo (FN011, ver 20261112000005_finanzas_caja_sin_negativo.sql)
 * se muestra con el mensaje de la base, que nombra la caja, el saldo y la fecha.
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
  if (code === "FN011") return error.message;
  if (code === "23505" || code === "23514") {
    const clave = Object.keys(RESTRICCIONES).find((nombre) => error.message.includes(`"${nombre}"`));
    if (clave) return RESTRICCIONES[clave];
  }
  return PROPIOS[code] ?? `No se pudo ${contexto}: ${error.message}`;
}

/** Mensajes de las transferencias (20261112000003_finanzas_transferencias.sql) que difieren de los del ajuste. */
const TRANSFERENCIA: Record<string, string> = {
  FN001: "La transferencia ya no se puede modificar. Recargue la página.",
  FN002: "Una transferencia nueva no puede nacer anulada.",
  FN003: "Las transferencias no se borran: se anulan con un motivo.",
  FN010: "La cuenta destino tiene que ser distinta de la de origen.",
  "23503": "Alguna de las cuentas ya no existe. Recargue la página.",
};

const RESTRICCIONES_TRANSFERENCIA: Record<string, string> = {
  transferencia_fondos_importe_check: "El importe tiene que ser mayor que cero.",
};

/**
 * Como mensajeErrorFinanzas, para registrar o anular una transferencia. La
 * cuenta inactiva (FN004) usa el mensaje de la base, que nombra la cuenta.
 */
export function mensajeErrorTransferencia(error: ErrorBase, contexto: string): string {
  const code = error.code ?? "";
  if (code === "FN004") return error.message;
  if (code === "23514") {
    const clave = Object.keys(RESTRICCIONES_TRANSFERENCIA).find((nombre) => error.message.includes(`"${nombre}"`));
    if (clave) return RESTRICCIONES_TRANSFERENCIA[clave];
  }
  return TRANSFERENCIA[code] ?? mensajeErrorFinanzas(error, contexto);
}

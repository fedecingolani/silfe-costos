/**
 * Mensajes legibles de los errores de la base al guardar, confirmar o anular
 * órdenes de pago, al imputar notas de crédito de compra y al anular un
 * comprobante de compra con imputaciones (SQLSTATE OP001–OP017, ver
 * 20261106000001_pagos_compra.sql). Cada código trae su pista (HINT) con el
 * motivo: se busca por las dos, por si llega sólo una. Un deadlock (40P01) o
 * un conflicto de serialización (40001) se resuelve probando de nuevo. Las
 * acciones devuelven el mensaje en lugar de lanzarlo.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string; hint?: string | null };

const INMUTABLE = "La orden de pago está confirmada o anulada: no se puede modificar.";
const TRANSICION = "La orden de pago cambió de estado. Recargá la página.";
const SIN_MEDIOS = "Agregá al menos un medio de pago antes de confirmar la orden.";
const TOTAL = "El total de la orden no coincide con la suma de sus medios de pago. Recargá la página.";
const EXCEDE_CREDITO = "Lo imputado supera el total de la orden de pago (o de la nota de crédito).";
const PROVEEDOR = "Los comprobantes y los cheques tienen que ser del proveedor de la orden.";
const MEDIO = "Revisá los medios de pago: hay datos que no son válidos.";
const INEXISTENTE = "No se encontró la orden de pago. Puede que la hayan borrado.";
const NUMERACION = "El número de la orden lo asigna la confirmación. Recargá la página.";
const CREDITO = "Sólo se imputa una nota de crédito de compra confirmada.";
const MOTIVO = "Para anular la orden de pago, indicá el motivo.";
const CON_IMPUTACIONES =
  "El comprobante tiene pagos o notas de crédito imputados: anulá primero esas órdenes de pago o notas de crédito.";
const VINCULO = "El cheque se entrega y se devuelve sólo confirmando o anulando su orden de pago.";
const REINTENTAR = "Otra persona estaba usando los mismos comprobantes o cheques. Probá de nuevo.";

const PROPIOS: Record<string, string> = {
  OP001: INMUTABLE,
  orden_pago_inmutable: INMUTABLE,
  OP002: TRANSICION,
  transicion_invalida: TRANSICION,
  OP003: SIN_MEDIOS,
  orden_pago_sin_medios: SIN_MEDIOS,
  OP004: TOTAL,
  total_distinto_medios: TOTAL,
  OP005: EXCEDE_CREDITO,
  imputacion_excede_credito: EXCEDE_CREDITO,
  OP008: PROVEEDOR,
  proveedor_distinto: PROVEEDOR,
  OP011: MEDIO,
  medio_invalido: MEDIO,
  OP012: INEXISTENTE,
  orden_pago_inexistente: INEXISTENTE,
  OP013: NUMERACION,
  numeracion_invalida: NUMERACION,
  OP014: CREDITO,
  credito_invalido: CREDITO,
  OP015: MOTIVO,
  motivo_requerido: MOTIVO,
  OP016: CON_IMPUTACIONES,
  comprobante_con_imputaciones: CON_IMPUTACIONES,
  OP017: VINCULO,
  cheque_vinculo_invalido: VINCULO,
  "40P01": REINTENTAR,
  "40001": REINTENTAR,
  "23503": "El proveedor, un comprobante o un cheque ya no existen. Recargá la página.",
};

/**
 * El mensaje de la base ya dice qué comprobante (saldo excedido, no
 * imputable) o qué cheque (fuera de la cartera, no devolvible).
 */
const MENSAJE_DE_LA_BASE = new Set([
  "OP006",
  "imputacion_excede_saldo",
  "OP007",
  "debito_invalido",
  "OP009",
  "cheque_no_disponible",
  "OP010",
  "cheque_no_devolvible",
]);

/** Controles de la tabla (23514), por nombre de la restricción. */
const MENSAJES_CONTROL: [restriccion: string, mensaje: string][] = [
  ["orden_pago_medio_cheque_propio_check", "Cada cheque propio lleva banco, número y fecha de pago."],
  ["orden_pago_medio_importe_check", "El importe de cada medio de pago tiene que ser mayor que cero."],
  ["orden_pago_medio_", MEDIO],
  ["imputacion_compra_importe_check", "El importe de cada imputación tiene que ser mayor que cero."],
];

/**
 * Mensaje legible de un error de la base.
 * @param accion lo que se intentaba, para un error sin traducción («confirmar la orden de pago»).
 */
export function mensajeErrorOrdenPago(error: ErrorBase, accion = "guardar la orden de pago"): string {
  if (error.code === "23514") {
    const control = MENSAJES_CONTROL.find(([nombre]) => error.message.includes(nombre))?.[1];
    if (control) return control;
  }
  if ((error.code && MENSAJE_DE_LA_BASE.has(error.code)) || (error.hint && MENSAJE_DE_LA_BASE.has(error.hint))) {
    return error.message;
  }
  // Object.hasOwn: una pista como "constructor" no tiene que encontrar lo heredado de Object.
  const propio = (clave: string | null | undefined) => (clave && Object.hasOwn(PROPIOS, clave) ? PROPIOS[clave] : undefined);
  return propio(error.code) ?? propio(error.hint) ?? `No se pudo ${accion}: ${error.message}`;
}

/**
 * Origen de un movimiento de fondos (columna origen de v_movimiento_fondos):
 * cómo se muestra y adónde lleva en la tabla de movimientos de una cuenta.
 */
const NOMBRES: Record<string, string> = {
  ajuste: "Ajuste",
  recibo: "Recibo",
  orden_pago: "Orden de pago",
  cheque_deposito: "Depósito de cheque",
  cheque_rechazo: "Cheque rechazado",
  transferencia: "Transferencia",
};

export function nombreOrigen(origen: string): string {
  return NOMBRES[origen] ?? origen;
}

/**
 * Página del origen del movimiento, o null si no tiene (un ajuste se ve en
 * la misma tabla). El depósito y el rechazo de un cheque llevan al cheque.
 * Una transferencia enlaza a la otra cuenta (ver cuentaDeTransferencia), no
 * a una página propia.
 */
export function enlaceOrigen(movimiento: { origen: string; origen_id: string }): string | null {
  if (movimiento.origen === "recibo") return `/cobranzas/${movimiento.origen_id}`;
  if (movimiento.origen === "orden_pago") return `/compras/pagos/${movimiento.origen_id}`;
  if (movimiento.origen === "cheque_deposito" || movimiento.origen === "cheque_rechazo") {
    return `/cheques/${movimiento.origen_id}`;
  }
  return null;
}

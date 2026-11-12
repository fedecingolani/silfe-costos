/**
 * Origen de un movimiento de fondos (columna origen de v_movimiento_fondos):
 * cómo se muestra y adónde lleva en la tabla de movimientos de una cuenta.
 */
const NOMBRES: Record<string, string> = {
  ajuste: "Ajuste",
  recibo: "Recibo",
};

export function nombreOrigen(origen: string): string {
  return NOMBRES[origen] ?? origen;
}

/** Página del origen del movimiento, o null si no tiene (un ajuste se ve en la misma tabla). */
export function enlaceOrigen(movimiento: { origen: string; origen_id: string }): string | null {
  if (movimiento.origen === "recibo") return `/cobranzas/${movimiento.origen_id}`;
  return null;
}

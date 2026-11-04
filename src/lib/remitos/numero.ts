/**
 * Número de un remito: letra R, punto de venta y correlativo propio del
 * punto de venta (igual que numero_texto de v_remito_estado).
 */

/** Lo que se muestra en lugar del número mientras el remito es un borrador. */
export const SIN_NUMERO_REMITO = "Sin número";

/** R-00001-00000001 */
export function numeroRemito(puntoVenta: number, numero: number | string): string {
  return `R-${String(puntoVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

/** R-00001-00000001, o «Sin número» si todavía no se emitió. */
export function numeroVisibleRemito(remito: { punto_venta: number; numero: number | string | null }): string {
  return remito.numero === null ? SIN_NUMERO_REMITO : numeroRemito(remito.punto_venta, remito.numero);
}

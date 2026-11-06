/**
 * Imputación de una orden de pago a las facturas y notas de débito de compra
 * con saldo del proveedor: el usuario elige cuáles cancela y por cuánto;
 * "completar en orden" llena de la más vieja a la más nueva y lo no imputado
 * queda a favor. Es la misma cuenta que en cobranzas (completarEnOrden y
 * saldoAFavor), con los mensajes de la orden de pago.
 */
import { aCentavos, sumarPesos, textoPesos } from "@/lib/cobranzas/dinero";
import type { DebitoPendiente, ImputacionElegida } from "@/lib/cobranzas/imputacion";

export { completarEnOrden, saldoAFavor } from "@/lib/cobranzas/imputacion";
export type { DebitoPendiente, ImputacionElegida } from "@/lib/cobranzas/imputacion";

/**
 * Errores de lo elegido. Un importe en cero se ignora. Un comprobante
 * repetido se rechaza acá: la base lo rechazaría con 23505.
 */
export function validarImputacionesPago(
  debitos: readonly DebitoPendiente[],
  elegidas: readonly ImputacionElegida[],
  totalOrden: number,
): string[] {
  const errores = new Set<string>();
  const saldos = new Map(debitos.map((d) => [d.comprobanteId, d.saldo]));
  const vistos = new Set<string>();

  for (const elegida of elegidas) {
    if (!Number.isFinite(elegida.importe) || elegida.importe < 0) {
      errores.add("Un importe imputado no puede ser negativo.");
      continue;
    }
    if (aCentavos(elegida.importe) === 0) continue;
    if (vistos.has(elegida.comprobanteId)) {
      errores.add("Cada comprobante se imputa una sola vez.");
      continue;
    }
    vistos.add(elegida.comprobanteId);
    const saldo = saldos.get(elegida.comprobanteId);
    if (saldo === undefined) {
      errores.add("Uno de los comprobantes no tiene saldo pendiente.");
    } else if (aCentavos(elegida.importe) > aCentavos(saldo)) {
      errores.add(`La imputación a un comprobante supera su saldo pendiente (${textoPesos(saldo)}).`);
    }
  }

  const imputado = sumarPesos(elegidas.filter((e) => Number.isFinite(e.importe) && e.importe > 0).map((e) => e.importe));
  if (aCentavos(imputado) > aCentavos(totalOrden)) {
    errores.add(`Lo imputado (${textoPesos(imputado)}) supera el total de la orden de pago (${textoPesos(totalOrden)}).`);
  }
  return [...errores];
}

/**
 * Importes a imputar al abrir una orden nueva desde un comprobante («Pagar»):
 * su saldo pendiente. Vacío si no llega o ya no tiene saldo.
 */
export function imputacionInicial(
  debitos: readonly DebitoPendiente[],
  comprobanteId: string | null,
): Record<string, string> {
  const debito = comprobanteId ? debitos.find((d) => d.comprobanteId === comprobanteId) : undefined;
  return debito ? { [debito.comprobanteId]: String(debito.saldo) } : {};
}

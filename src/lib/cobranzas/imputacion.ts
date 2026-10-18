/**
 * Imputación de una cobranza a los débitos pendientes del cliente: el
 * usuario elige cuáles cancela y por cuánto; "completar en orden" llena de
 * la más vieja a la más nueva. Lo no imputado queda a favor. El pago de una
 * factura de contado es siempre por su total exacto.
 */
import type { CondicionPago } from "@/lib/tipos";
import { aCentavos, aPesos, sumarPesos, textoPesos } from "./dinero";

/** Débito con saldo pendiente (de v_comprobante_saldo). fecha yyyy-mm-dd. */
export type DebitoPendiente = { comprobanteId: string; fecha: string; saldo: number };

export type ImputacionElegida = { comprobanteId: string; importe: number };

/**
 * Errores de lo elegido. Un importe en cero se ignora (el comprobante no se
 * imputa).
 */
export function validarImputaciones(
  debitos: readonly DebitoPendiente[],
  elegidas: readonly ImputacionElegida[],
  totalRecibo: number,
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
  if (aCentavos(imputado) > aCentavos(totalRecibo)) {
    errores.add(`Lo imputado (${textoPesos(imputado)}) supera el total del recibo (${textoPesos(totalRecibo)}).`);
  }
  return [...errores];
}

/** Lo que queda a favor del cliente: total del recibo menos lo imputado. */
export function saldoAFavor(totalRecibo: number, elegidas: readonly ImputacionElegida[]): number {
  const imputado = elegidas.reduce((total, e) => total + Math.max(aCentavos(e.importe), 0), 0);
  return aPesos(aCentavos(totalRecibo) - imputado);
}

/** Llena de la más vieja a la más nueva hasta agotar el total. */
export function completarEnOrden(debitos: readonly DebitoPendiente[], total: number): ImputacionElegida[] {
  const ordenados = [...debitos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let restante = aCentavos(total);
  const elegidas: ImputacionElegida[] = [];
  for (const debito of ordenados) {
    if (restante <= 0) break;
    const importe = Math.min(restante, aCentavos(debito.saldo));
    if (importe <= 0) continue;
    elegidas.push({ comprobanteId: debito.comprobanteId, importe: aPesos(importe) });
    restante -= importe;
  }
  return elegidas;
}

export type ComprobanteContado = { id: string; total: number; condicionPago: CondicionPago };

/**
 * Pago de una factura o ND de contado: los medios suman exactamente el
 * total y el recibo lleva una única imputación por ese total.
 */
export function pagoContado(
  comprobante: ComprobanteContado,
  medios: readonly { importe: number }[],
): { imputacion: ImputacionElegida } | { error: string } {
  if (comprobante.condicionPago !== "contado") {
    return { error: "El comprobante es de cuenta corriente: se cobra con una cobranza." };
  }
  const suma = sumarPesos(medios.map((m) => m.importe));
  if (aCentavos(suma) !== aCentavos(comprobante.total)) {
    return {
      error: `El pago de contado es por el total exacto (${textoPesos(comprobante.total)}); los medios suman ${textoPesos(suma)}.`,
    };
  }
  return { imputacion: { comprobanteId: comprobante.id, importe: comprobante.total } };
}

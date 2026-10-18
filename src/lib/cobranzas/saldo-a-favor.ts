/**
 * Aplicación automática del saldo a favor al autorizar una factura o ND de
 * cuenta corriente: se imputa de los créditos más viejos a los más nuevos
 * (recibos emitidos y notas de crédito con algo sin imputar, de
 * v_cliente_saldo_a_favor) hasta cubrir el débito o agotarlos. Un débito de
 * contado nunca consume saldo a favor.
 */
import type { CondicionPago } from "@/lib/tipos";
import { aCentavos, aPesos } from "./dinero";

/** fecha yyyy-mm-dd. */
export type CreditoDisponible = { origen: "recibo" | "nota_credito"; id: string; fecha: string; disponible: number };

export type DebitoAAplicar = { id: string; total: number; condicionPago: CondicionPago };

/** Fila de imputacion a insertar. */
export type ImputacionAutomatica = {
  reciboId: string | null;
  notaCreditoId: string | null;
  comprobanteId: string;
  importe: number;
  automatica: true;
};

export function aplicarSaldoAFavor(
  creditos: readonly CreditoDisponible[],
  debito: DebitoAAplicar,
): ImputacionAutomatica[] {
  if (debito.condicionPago === "contado") return [];
  const ordenados = [...creditos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let restante = aCentavos(debito.total);
  const imputaciones: ImputacionAutomatica[] = [];
  for (const credito of ordenados) {
    if (restante <= 0) break;
    const importe = Math.min(restante, aCentavos(credito.disponible));
    if (importe <= 0) continue;
    imputaciones.push({
      reciboId: credito.origen === "recibo" ? credito.id : null,
      notaCreditoId: credito.origen === "nota_credito" ? credito.id : null,
      comprobanteId: debito.id,
      importe: aPesos(importe),
      automatica: true,
    });
    restante -= importe;
  }
  return imputaciones;
}

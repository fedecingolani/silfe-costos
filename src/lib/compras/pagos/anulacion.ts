/**
 * Anulación de una orden de pago confirmada (anular_orden_pago): motivo,
 * qué cheques de terceros impiden anularla y lo que pasa al anularla. Sus
 * cheques vuelven a la cartera sólo si siguen entregados con esta orden: uno
 * rechazado después la bloquea (OP010).
 */
import { NOMBRES_ESTADO_CHEQUE, type EstadoCheque } from "@/lib/tipos";

export { LARGO_MAXIMO_MOTIVO, validarMotivoAnulacion } from "@/lib/cobranzas/anulacion";

export type ChequeDeLaOrden = { banco: string; numero: string; estado: EstadoCheque };

/** Explicación con los cheques que ya no pueden volver a la cartera, o null si no hay. */
export function textoChequesNoDevolvibles(cheques: readonly ChequeDeLaOrden[]): string | null {
  const bloqueados = cheques.filter((c) => c.estado !== "entregado");
  if (bloqueados.length === 0) return null;
  const lista = bloqueados.map((c) => `${c.banco} N° ${c.numero} (${NOMBRES_ESTADO_CHEQUE[c.estado]})`).join(", ");
  return (
    `No se puede anular: estos cheques ya no pueden volver a la cartera: ${lista}. ` +
    "La base no deja anular la orden mientras alguno de sus cheques esté en ese estado."
  );
}

/** Lo que pasa al anular, para mostrarlo antes de confirmar. */
export function efectosAnulacionOrdenPago({
  numero,
  chequesTerceros,
}: {
  numero: string;
  chequesTerceros: number;
}): string[] {
  const efectos = [
    "Los comprobantes que canceló vuelven a quedar pendientes (también lo que se les aplicó de su saldo a favor).",
  ];
  if (chequesTerceros === 1) efectos.push("Su cheque de terceros vuelve a la cartera.");
  else if (chequesTerceros > 1) efectos.push(`Sus ${chequesTerceros} cheques de terceros vuelven a la cartera.`);
  efectos.push(`El número ${numero} no se vuelve a usar: la orden queda visible como anulada.`);
  return efectos;
}

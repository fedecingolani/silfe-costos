/**
 * Anulación de un recibo emitido (anular_recibo): motivo, qué cheques
 * impiden anularlo, mensajes de error legibles y la explicación de lo que
 * pasa al anularlo.
 */
import { NOMBRES_ESTADO_CHEQUE, type EstadoCheque } from "@/lib/tipos";
import { mensajeErrorCobranza } from "./errores";

export const LARGO_MAXIMO_MOTIVO = 500;

export type ChequeDelRecibo = { banco: string; numero: string; estado: EstadoCheque };

/** Error del motivo, o null si está bien. */
export function validarMotivoAnulacion(motivo: string): string | null {
  const limpio = motivo.trim();
  if (limpio === "") return "Escribí el motivo de la anulación.";
  if (limpio.length > LARGO_MAXIMO_MOTIVO) return `El motivo no puede superar los ${LARGO_MAXIMO_MOTIVO} caracteres.`;
  return null;
}

/** Cheques que ya no están en cartera: mientras haya alguno, el recibo no se anula (CB010). */
export function chequesFueraDeCartera(cheques: readonly ChequeDelRecibo[]): ChequeDelRecibo[] {
  return cheques.filter((c) => c.estado !== "en_cartera");
}

/** Explicación con cada cheque y su estado, o null si todos siguen en cartera. */
export function textoChequesFueraDeCartera(cheques: readonly ChequeDelRecibo[]): string | null {
  const fuera = chequesFueraDeCartera(cheques);
  if (fuera.length === 0) return null;
  const lista = fuera.map((c) => `${c.banco} N° ${c.numero} (${NOMBRES_ESTADO_CHEQUE[c.estado]})`).join(", ");
  return (
    `No se puede anular: estos cheques ya salieron de la cartera: ${lista}. ` +
    "Para anular el recibo, todos sus cheques tienen que estar en cartera."
  );
}

/** Mensaje legible de un error de anular_recibo; `cheques` son los del recibo, leídos después del error. */
export function mensajeErrorAnulacion(
  error: { code?: string; message: string },
  cheques: readonly ChequeDelRecibo[],
): string {
  switch (error.code) {
    case "CB010":
      return textoChequesFueraDeCartera(cheques) ?? error.message;
    case "CB019":
      return "Escribí el motivo de la anulación.";
    case "CB002":
      return "El recibo ya no está emitido (puede que lo hayan anulado recién). Recargá la página.";
    default:
      return mensajeErrorCobranza(error, "anular el recibo");
  }
}

/** Lo que pasa al anular, para mostrarlo antes de confirmar. */
export function efectosAnulacion({
  numero,
  contado,
  cheques,
}: {
  numero: string;
  contado: boolean;
  cheques: number;
}): string[] {
  const efectos = [
    contado
      ? "La factura de contado vuelve a figurar «Contado – pago pendiente»."
      : "Los comprobantes que canceló vuelven a quedar pendientes (también lo que se les aplicó de su saldo a favor).",
  ];
  if (cheques === 1) efectos.push("Su cheque sale de la cartera: queda como anulado en su historial.");
  else if (cheques > 1) efectos.push(`Sus ${cheques} cheques salen de la cartera: quedan como anulados en su historial.`);
  efectos.push(`El número ${numero} no se vuelve a usar: el recibo queda visible como anulado.`);
  return efectos;
}

/**
 * Estado de pago de los débitos de cuenta corriente para mostrar en
 * comprobantes. Sale de v_comprobante_saldo: los que no están ahí
 * (borradores, homologación, notas de crédito) no tienen estado de pago.
 */
import type { EstadoPago } from "@/lib/tipos";

export const NOMBRES_ESTADO_PAGO: Record<EstadoPago, string> = {
  pendiente: "Pendiente",
  parcial: "Parcial",
  cancelado: "Cancelado",
};

export const TONO_ESTADO_PAGO: Record<EstadoPago, "ambar" | "azul" | "verde"> = {
  pendiente: "ambar",
  parcial: "azul",
  cancelado: "verde",
};

export type SaldoDebito = { comprobanteId: string; saldo: number; estadoPago: EstadoPago };

/** Saldo por comprobante, a partir de las filas de v_comprobante_saldo. */
export function mapaSaldos(
  filas: readonly { comprobante_id: string; saldo: number | string; estado_pago: string }[],
): Map<string, SaldoDebito> {
  return new Map(
    filas.map((f) => [
      f.comprobante_id,
      { comprobanteId: f.comprobante_id, saldo: Number(f.saldo), estadoPago: f.estado_pago as EstadoPago },
    ]),
  );
}

/**
 * Parte una lista de ids en lotes, para consultar con `in` sin pasarse del
 * largo de la URL de PostgREST (500 uuid en una sola URL son ~19 KB).
 */
export function enLotes<T>(lista: readonly T[], tamano: number): T[][] {
  if (tamano < 1) throw new Error("El tamaño del lote tiene que ser al menos 1.");
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

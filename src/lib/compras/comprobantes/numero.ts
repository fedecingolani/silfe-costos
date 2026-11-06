/**
 * Comprobantes de compra: nombre y número tal como se muestran
 * («FC A 00003-00012345»). El número es el del proveedor.
 */
import type { LetraCompra, TipoComprobanteCompra } from "@/lib/tipos";

export const NOMBRES_TIPO_COMPROBANTE_COMPRA: Record<TipoComprobanteCompra, string> = {
  factura: "Factura",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
};

const ABREVIATURAS: Record<TipoComprobanteCompra, string> = {
  factura: "FC",
  nota_credito: "NC",
  nota_debito: "ND",
};

/** FC A, NC B, ND C */
export function abreviaturaComprobanteCompra(tipo: TipoComprobanteCompra, letra: LetraCompra): string {
  return `${ABREVIATURAS[tipo]} ${letra}`;
}

/** FC A 00003-00012345 */
export function numeroComprobanteCompra(comprobante: {
  tipo: TipoComprobanteCompra;
  letra: LetraCompra;
  punto_venta: number;
  numero: number | string;
}): string {
  const pv = String(comprobante.punto_venta).padStart(5, "0");
  const numero = String(comprobante.numero).padStart(8, "0");
  return `${abreviaturaComprobanteCompra(comprobante.tipo, comprobante.letra)} ${pv}-${numero}`;
}

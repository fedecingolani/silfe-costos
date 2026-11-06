/**
 * Importes y totales de un comprobante de compra en el navegador, con las
 * mismas reglas que la base (fn_comprobante_compra_item_calcular y
 * fn_comprobante_compra_totales). Es una vista previa: los totales que
 * valen son los que calcula la base al guardar.
 *
 *   - importe del renglón = round(cantidad × precio × (1 − descuento/100), 2);
 *   - A y M: IVA del renglón = round(importe × alícuota/100, 2) si tiene
 *     alícuota y no es exento. Neto gravado: los renglones con alícuota (0 %
 *     incluido); exento: los exentos; no gravado: el resto;
 *   - B y C: sin IVA; todo lo no exento va a no gravado;
 *   - percepciones sumadas por tipo; total = todo lo anterior.
 *
 * Se calcula con enteros escalados (BigInt) para redondear como round() de
 * Postgres (la mitad, alejándose del cero) sin arrastrar coma flotante.
 */
import { desescalar, escalarDecimal } from "@/lib/remitos/decimal";
import type { LetraCompra, TipoPercepcionCompra } from "@/lib/tipos";
import { discriminaIva } from "./letra";

export type RenglonCalculable = {
  cantidad: string | number;
  precioUnitario: string | number;
  /** Vacío es 0. */
  descuentoPct: string | number;
  /** null: no gravado. */
  alicuotaIva: number | null;
  exento: boolean;
};

export type PercepcionCalculable = { tipo: TipoPercepcionCompra | string; importe: string | number };

export type TotalesCompra = {
  netoGravado: number;
  noGravado: number;
  exento: number;
  iva: number;
  /** Sólo en A y M, de menor a mayor alícuota. */
  ivaPorAlicuota: { alicuota: number; neto: number; iva: number }[];
  percepcionIva: number;
  percepcionIibb: number;
  otrosImpuestos: number;
  total: number;
};

/** División entera que redondea la mitad alejándose del cero. */
function redondear(valor: bigint, divisor: bigint): bigint {
  const absoluto = valor < 0n ? -valor : valor;
  const cociente = (absoluto + divisor / 2n) / divisor;
  return valor < 0n ? -cociente : cociente;
}

type RenglonEscalado = { importe: bigint; iva: bigint; alicuota: bigint | null; gravado: boolean; exento: boolean };

function escalarRenglon(renglon: RenglonCalculable, letra: LetraCompra): RenglonEscalado | null {
  const cantidad = escalarDecimal(renglon.cantidad, 4);
  const precio = escalarDecimal(renglon.precioUnitario, 4);
  const descuento =
    typeof renglon.descuentoPct === "string" && renglon.descuentoPct.trim() === ""
      ? 0n
      : escalarDecimal(renglon.descuentoPct, 2);
  if (cantidad === null || cantidad <= 0n || precio === null || precio < 0n) return null;
  if (descuento === null || descuento < 0n || descuento > 10000n) return null;

  // cantidad (×10⁴) × precio (×10⁴) × (1 − descuento/100) (×10⁴) = ×10¹²; a centavos, ÷10¹⁰.
  const importe = redondear(cantidad * precio * (10000n - descuento), 10n ** 10n);
  const alicuota =
    renglon.exento || renglon.alicuotaIva === null || !discriminaIva(letra)
      ? null
      : escalarDecimal(renglon.alicuotaIva, 2);
  // importe (×10²) × alícuota (×10²) / 100 = IVA ×10⁶; a centavos, ÷10⁴.
  const iva = alicuota === null ? 0n : redondear(importe * alicuota, 10n ** 4n);
  return { importe, iva, alicuota, gravado: alicuota !== null, exento: renglon.exento };
}

/** Importe e IVA de un renglón; null si está a medio cargar o no es válido. */
export function calcularRenglonCompra(
  renglon: RenglonCalculable,
  letra: LetraCompra,
): { importe: number; iva: number } | null {
  const r = escalarRenglon(renglon, letra);
  return r && { importe: desescalar(r.importe, 2), iva: desescalar(r.iva, 2) };
}

/** Totales del comprobante. Los renglones y percepciones a medio cargar no suman. */
export function totalesComprobanteCompra(
  renglones: readonly RenglonCalculable[],
  percepciones: readonly PercepcionCalculable[],
  letra: LetraCompra,
): TotalesCompra {
  let netoGravado = 0n;
  let noGravado = 0n;
  let exento = 0n;
  let iva = 0n;
  const porAlicuota = new Map<bigint, { neto: bigint; iva: bigint }>();

  for (const renglon of renglones) {
    const r = escalarRenglon(renglon, letra);
    if (!r) continue;
    if (r.exento) exento += r.importe;
    else if (r.gravado) {
      netoGravado += r.importe;
      iva += r.iva;
      const acumulado = porAlicuota.get(r.alicuota!) ?? { neto: 0n, iva: 0n };
      porAlicuota.set(r.alicuota!, { neto: acumulado.neto + r.importe, iva: acumulado.iva + r.iva });
    } else noGravado += r.importe;
  }

  const porTipo: Record<string, bigint> = { iva: 0n, iibb: 0n, otro: 0n };
  for (const p of percepciones) {
    const importe = escalarDecimal(p.importe, 2);
    if (importe === null || importe <= 0n || !Object.hasOwn(porTipo, p.tipo)) continue;
    porTipo[p.tipo] += importe;
  }

  const total = netoGravado + noGravado + exento + iva + porTipo.iva + porTipo.iibb + porTipo.otro;
  return {
    netoGravado: desescalar(netoGravado, 2),
    noGravado: desescalar(noGravado, 2),
    exento: desescalar(exento, 2),
    iva: desescalar(iva, 2),
    ivaPorAlicuota: [...porAlicuota.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([alicuota, v]) => ({
        alicuota: desescalar(alicuota, 2),
        neto: desescalar(v.neto, 2),
        iva: desescalar(v.iva, 2),
      })),
    percepcionIva: desescalar(porTipo.iva, 2),
    percepcionIibb: desescalar(porTipo.iibb, 2),
    otrosImpuestos: desescalar(porTipo.otro, 2),
    total: desescalar(total, 2),
  };
}

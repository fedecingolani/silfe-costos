/**
 * Importes de un comprobante. Todo se calcula con enteros (BigInt) a partir
 * de cantidades y precios con 4 decimales, descuento y alícuota con 2, para
 * no arrastrar errores de coma flotante. Redondeo: mitad hacia arriba, a
 * centavos.
 *
 * - Renglón: importe = cantidad × precio × (1 − dto%), redondeado; su IVA es
 *   informativo (para la pantalla y el PDF).
 * - Comprobante: el IVA se calcula por alícuota sobre la base sumada de esa
 *   alícuota y se redondea una vez. Es lo que pide WSFE: cada AlicIva lleva
 *   BaseImp e Importe ≈ BaseImp × alícuota, e ImpIVA es la suma de los
 *   Importe. Por eso la suma de los IVA de los renglones puede diferir en
 *   algún centavo del IVA del comprobante; manda el del comprobante.
 * - Un renglón no gravado no lleva IVA: suma en noGravado (ImpTotConc), no
 *   en el neto gravado (ImpNeto) ni en el IVA por alícuota.
 * - total = neto + noGravado + iva.
 * - Comprobante X (opción sinIva): no suma IVA. Los precios se toman tal
 *   cual, el IVA de cada renglón es 0, no hay IVA por alícuota y
 *   total = neto + noGravado. La alícuota se sigue validando porque se guarda.
 */
import { NO_GRAVADO, type AlicuotaIva } from "@/lib/tipos";

export { NO_GRAVADO };

export type ItemACalcular = {
  cantidad: number;
  precioUnitario: number;
  /** 0 a 100 */
  descuentoPct: number;
  /** En %: 0, 2.5, 5, 10.5, 21 o 27; o "no_gravado". */
  alicuotaIva: number | typeof NO_GRAVADO;
};

export type OpcionesCalculo = {
  /** Comprobante X: sin IVA (ver arriba). */
  sinIva?: boolean;
};

export type IvaPorAlicuota = { id: number; alicuota: AlicuotaIva; base: number; importe: number };

export type Totales = {
  /** Neto gravado. */
  neto: number;
  noGravado: number;
  iva: number;
  total: number;
  ivaPorAlicuota: IvaPorAlicuota[];
};

/**
 * Tasa de una fila de comprobante_item: "no_gravado" si gravado es false;
 * si no, su alícuota. Una fila sin la columna gravado es gravada.
 */
export function tasaDeFila(fila: {
  gravado?: boolean | null;
  alicuota_iva: number | string | null;
}): number | typeof NO_GRAVADO {
  return fila.gravado === false ? NO_GRAVADO : Number(fila.alicuota_iva);
}

/** Código de ARCA (AlicIva.Id) por alícuota. */
const ID_ALICUOTA = new Map<number, number>([
  [0, 3],
  [10.5, 4],
  [21, 5],
  [27, 6],
  [5, 8],
  [2.5, 9],
]);

/** Valor decimal escalado a entero: escalar(1.2345, 4) = 12345n. */
function escalar(valor: number, decimales: number): bigint {
  return BigInt(Math.round(valor * 10 ** decimales));
}

/** División entera redondeando la mitad hacia arriba (valores no negativos). */
function dividirRedondeando(numerador: bigint, divisor: bigint): bigint {
  return (numerador * 2n + divisor) / (divisor * 2n);
}

function aPesos(centavos: bigint): number {
  return Number(centavos) / 100;
}

function importeEnCentavos(item: ItemACalcular): bigint {
  // cantidad × 10^4, precio × 10^4 y (1 − dto%) × 10^4 (100% = 10000 con el % a 2 decimales):
  // el producto queda en escala 10^12 y los centavos son escala 10^2.
  const producto = escalar(item.cantidad, 4) * escalar(item.precioUnitario, 4) * (10000n - escalar(item.descuentoPct, 2));
  return dividirRedondeando(producto, 10n ** 10n);
}

function ivaEnCentavos(baseCentavos: bigint, alicuota: number): bigint {
  return dividirRedondeando(baseCentavos * escalar(alicuota, 2), 10000n);
}

export function calcularItem(item: ItemACalcular, opciones: OpcionesCalculo = {}): { importe: number; iva: number } {
  const importe = importeEnCentavos(item);
  if (item.alicuotaIva === NO_GRAVADO || opciones.sinIva) return { importe: aPesos(importe), iva: 0 };
  return { importe: aPesos(importe), iva: aPesos(ivaEnCentavos(importe, item.alicuotaIva)) };
}

export function calcularTotales(items: readonly ItemACalcular[], opciones: OpcionesCalculo = {}): Totales {
  const bases = new Map<number, bigint>();
  let noGravado = 0n;
  for (const item of items) {
    if (item.alicuotaIva === NO_GRAVADO) {
      noGravado += importeEnCentavos(item);
      continue;
    }
    if (!ID_ALICUOTA.has(item.alicuotaIva)) {
      throw new Error(`La alícuota de IVA ${item.alicuotaIva}% no es una de las de ARCA.`);
    }
    bases.set(item.alicuotaIva, (bases.get(item.alicuotaIva) ?? 0n) + importeEnCentavos(item));
  }

  let neto = 0n;
  let iva = 0n;
  const ivaPorAlicuota: IvaPorAlicuota[] = [];
  for (const [alicuota, base] of bases) {
    neto += base;
    if (opciones.sinIva) continue;
    const importe = ivaEnCentavos(base, alicuota);
    iva += importe;
    ivaPorAlicuota.push({
      id: ID_ALICUOTA.get(alicuota)!,
      alicuota: alicuota as AlicuotaIva,
      base: aPesos(base),
      importe: aPesos(importe),
    });
  }
  ivaPorAlicuota.sort((a, b) => a.id - b.id);

  return {
    neto: aPesos(neto),
    noGravado: aPesos(noGravado),
    iva: aPesos(iva),
    total: aPesos(neto + noGravado + iva),
    ivaPorAlicuota,
  };
}

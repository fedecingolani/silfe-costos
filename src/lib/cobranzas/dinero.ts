/**
 * Importes de cobranzas en centavos enteros, para que sumas y restas de
 * pesos con 2 decimales no arrastren errores de coma flotante (0,1 + 0,2).
 * Los importes de cobranzas ya llegan con 2 decimales: no hay redondeo de
 * cálculo, sólo conversión (el cálculo de comprobantes, con 4 decimales y
 * redondeo mitad hacia arriba, sigue en comprobantes/calculo.ts).
 */

export function aCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

export function aPesos(centavos: number): number {
  return centavos / 100;
}

/** Suma de importes en pesos, exacta a centavos. */
export function sumarPesos(importes: readonly number[]): number {
  return aPesos(importes.reduce((total, importe) => total + aCentavos(importe), 0));
}

const pesosFmt = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$ 1.210,50" */
export function textoPesos(pesos: number): string {
  return `$ ${pesosFmt.format(pesos)}`;
}

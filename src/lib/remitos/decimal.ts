/**
 * Decimales sin coma flotante: un texto (o un número de Postgres) se pasa a
 * un entero escalado (BigInt), como hace calculo.ts con cantidades y
 * precios. Sirve para comparar cantidades de 4 decimales (numeric(14,4)) y
 * redondear importes a centavos sin arrastrar errores.
 */

const DECIMAL = /^(-)?(\d*)(?:\.(\d*))?$/;

/**
 * Entero escalado a `decimales`: escalarDecimal("100.25", 4) = 1002500n.
 * Acepta coma decimal. Con más decimales que la escala redondea la mitad
 * alejándose del cero, o devuelve null con `exacto`. null si está vacío o no
 * es un número.
 */
export function escalarDecimal(
  valor: string | number,
  decimales: number,
  opciones: { exacto?: boolean } = {},
): bigint | null {
  let textoValor: string;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    // Un número de Postgres trae a lo sumo su escala; el redondeo a 10 decimales quita el ruido de coma flotante.
    textoValor = String(Number(valor.toFixed(10)));
    if (textoValor.includes("e")) textoValor = valor.toFixed(10);
  } else {
    textoValor = valor.trim().replace(",", ".");
  }
  const partes = DECIMAL.exec(textoValor);
  if (!partes) return null;
  const [, signo, enteros = "", fraccion = ""] = partes;
  if (enteros === "" && fraccion === "") return null;

  const propios = fraccion.slice(0, decimales).padEnd(decimales, "0");
  const sobrantes = fraccion.slice(decimales);
  if (opciones.exacto && /[1-9]/.test(sobrantes)) return null;

  let escalado = BigInt((enteros || "0") + propios);
  if (sobrantes !== "" && Number(sobrantes[0]) >= 5) escalado += 1n;
  return signo ? -escalado : escalado;
}

/** Número de un entero escalado: desescalar(1002500n, 4) = 100.25. */
export function desescalar(escalado: bigint, decimales: number): number {
  const negativo = escalado < 0n;
  const absoluto = (negativo ? -escalado : escalado).toString().padStart(decimales + 1, "0");
  const enteros = absoluto.slice(0, absoluto.length - decimales);
  const fraccion = absoluto.slice(absoluto.length - decimales);
  const numero = Number(decimales > 0 ? `${enteros}.${fraccion}` : enteros);
  return negativo ? -numero : numero;
}

import { describe, expect, it } from "vitest";
import { matrizQr } from "./qr-matriz";
import { urlQrArca } from "./qr";

const URL = urlQrArca({
  fecha: "2026-10-16",
  cuitEmisor: "30712345671",
  puntoVenta: 7,
  tipoArca: 1,
  numero: 361,
  total: 1694000,
  docTipo: 80,
  docNro: "30698765432",
  cae: "76123456789012",
});

describe("matrizQr", () => {
  it("genera una matriz cuadrada de un tamaño de QR válido (4 × versión + 17)", () => {
    const matriz = matrizQr(URL);
    const n = matriz.length;
    expect(matriz.every((fila) => fila.length === n)).toBe(true);
    expect((n - 17) % 4).toBe(0);
    // La URL de ARCA (≈ 300 caracteres) con corrección M da una versión intermedia.
    expect(n).toBeGreaterThanOrEqual(53);
    expect(n).toBeLessThanOrEqual(81);
  });

  it("tiene los patrones de posición en tres esquinas", () => {
    const matriz = matrizQr(URL);
    const n = matriz.length;
    for (const [f, c] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      // Borde oscuro de 7 × 7, anillo claro y centro oscuro de 3 × 3.
      expect(matriz[f][c]).toBe(true);
      expect(matriz[f + 6][c + 6]).toBe(true);
      expect(matriz[f + 1][c + 1]).toBe(false);
      expect(matriz[f + 3][c + 3]).toBe(true);
    }
  });

  it("es determinística", () => {
    expect(matrizQr(URL)).toEqual(matrizQr(URL));
  });
});

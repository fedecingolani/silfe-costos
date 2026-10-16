import { describe, expect, it } from "vitest";
import { calcularItem, calcularTotales } from "./calculo";

describe("calcularItem", () => {
  it("multiplica cantidad por precio y aplica la alícuota", () => {
    expect(calcularItem({ cantidad: 2, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 21 })).toEqual({
      importe: 200,
      iva: 42,
    });
  });

  it("aplica el descuento antes de redondear", () => {
    // 3 × 33.3333 × 0.9 = 89.99991 → 90.00; IVA 10.5% = 9.45
    expect(calcularItem({ cantidad: 3, precioUnitario: 33.3333, descuentoPct: 10, alicuotaIva: 10.5 })).toEqual({
      importe: 90,
      iva: 9.45,
    });
  });

  it("no arrastra errores de coma flotante", () => {
    // En coma flotante 1.005 × 100 = 100.49999…; con centavos enteros da 100.50.
    expect(calcularItem({ cantidad: 100, precioUnitario: 1.005, descuentoPct: 0, alicuotaIva: 21 })).toEqual({
      importe: 100.5,
      iva: 21.11,
    });
    expect(calcularItem({ cantidad: 0.1, precioUnitario: 0.2, descuentoPct: 0, alicuotaIva: 0 })).toEqual({
      importe: 0.02,
      iva: 0,
    });
  });

  it("redondea la mitad hacia arriba", () => {
    // 1 × 0.125 = 0.125 → 0.13; IVA 21% de 0.13 = 0.0273 → 0.03
    expect(calcularItem({ cantidad: 1, precioUnitario: 0.125, descuentoPct: 0, alicuotaIva: 21 })).toEqual({
      importe: 0.13,
      iva: 0.03,
    });
  });

  it("con 100% de descuento da cero", () => {
    expect(calcularItem({ cantidad: 5, precioUnitario: 10, descuentoPct: 100, alicuotaIva: 21 })).toEqual({
      importe: 0,
      iva: 0,
    });
  });

  it("soporta cantidades y precios grandes con 4 decimales", () => {
    expect(
      calcularItem({ cantidad: 12345.6789, precioUnitario: 98765.4321, descuentoPct: 12.5, alicuotaIva: 27 }),
    ).toEqual({ importe: 1066910522.24, iva: 288065841 });
  });
});

describe("calcularTotales", () => {
  it("suma importes y calcula el IVA por alícuota sobre la base sumada", () => {
    const totales = calcularTotales([
      { cantidad: 1, precioUnitario: 0.05, descuentoPct: 0, alicuotaIva: 21 },
      { cantidad: 1, precioUnitario: 0.05, descuentoPct: 0, alicuotaIva: 21 },
      { cantidad: 1, precioUnitario: 0.05, descuentoPct: 0, alicuotaIva: 21 },
    ]);
    // Por renglón: 0.0105 → 0.01 (× 3 = 0.03). Sobre la base: 0.15 × 21% = 0.0315 → 0.03.
    expect(totales).toEqual({
      neto: 0.15,
      iva: 0.03,
      total: 0.18,
      ivaPorAlicuota: [{ id: 5, alicuota: 21, base: 0.15, importe: 0.03 }],
    });
  });

  it("discrimina el IVA por alícuota con los códigos de ARCA, ordenado por código", () => {
    const totales = calcularTotales([
      { cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 27 },
      { cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 0 },
      { cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 2.5 },
      { cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 5 },
      { cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 10.5 },
      { cantidad: 2, precioUnitario: 50, descuentoPct: 0, alicuotaIva: 21 },
      { cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 21 },
    ]);
    expect(totales.ivaPorAlicuota).toEqual([
      { id: 3, alicuota: 0, base: 100, importe: 0 },
      { id: 4, alicuota: 10.5, base: 100, importe: 10.5 },
      { id: 5, alicuota: 21, base: 200, importe: 42 },
      { id: 6, alicuota: 27, base: 100, importe: 27 },
      { id: 8, alicuota: 5, base: 100, importe: 5 },
      { id: 9, alicuota: 2.5, base: 100, importe: 2.5 },
    ]);
    expect(totales.neto).toBe(700);
    expect(totales.iva).toBe(87);
    expect(totales.total).toBe(787);
  });

  it("sin ítems da cero", () => {
    expect(calcularTotales([])).toEqual({ neto: 0, iva: 0, total: 0, ivaPorAlicuota: [] });
  });

  it("rechaza una alícuota que ARCA no acepta", () => {
    expect(() =>
      calcularTotales([{ cantidad: 1, precioUnitario: 1, descuentoPct: 0, alicuotaIva: 22 }]),
    ).toThrow("La alícuota de IVA 22% no es una de las de ARCA.");
  });
});

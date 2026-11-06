import { describe, expect, it } from "vitest";
import { calcularRenglonCompra, totalesComprobanteCompra, type RenglonCalculable } from "./totales";

const renglon = (cambios: Partial<RenglonCalculable> = {}): RenglonCalculable => ({
  cantidad: "1",
  precioUnitario: "100",
  descuentoPct: "",
  alicuotaIva: 21,
  exento: false,
  ...cambios,
});

describe("calcularRenglonCompra", () => {
  it("importe = cantidad × precio × (1 − descuento), IVA sobre el importe, a centavos", () => {
    expect(
      calcularRenglonCompra(renglon({ cantidad: "2", precioUnitario: "1000,5", descuentoPct: "10" }), "A"),
    ).toEqual({ importe: 1800.9, iva: 378.19 });
  });

  it("redondea la mitad alejándose del cero, como round() de Postgres", () => {
    expect(calcularRenglonCompra(renglon({ precioUnitario: "0.005", alicuotaIva: null }), "A")).toEqual({
      importe: 0.01,
      iva: 0,
    });
    // 0,05 × 10,5 % = 0,00525 → 0,01
    expect(calcularRenglonCompra(renglon({ precioUnitario: "0.05", alicuotaIva: 10.5 }), "A")).toEqual({
      importe: 0.05,
      iva: 0.01,
    });
  });

  it("en B y C no calcula IVA aunque el renglón traiga alícuota", () => {
    expect(calcularRenglonCompra(renglon(), "B")).toEqual({ importe: 100, iva: 0 });
    expect(calcularRenglonCompra(renglon(), "C")).toEqual({ importe: 100, iva: 0 });
  });

  it("un renglón exento no lleva IVA", () => {
    expect(calcularRenglonCompra(renglon({ exento: true }), "A")).toEqual({ importe: 100, iva: 0 });
  });

  it("un renglón a medio cargar o inválido no se calcula", () => {
    expect(calcularRenglonCompra(renglon({ cantidad: "" }), "A")).toBeNull();
    expect(calcularRenglonCompra(renglon({ cantidad: "0" }), "A")).toBeNull();
    expect(calcularRenglonCompra(renglon({ precioUnitario: "abc" }), "A")).toBeNull();
    expect(calcularRenglonCompra(renglon({ precioUnitario: "-1" }), "A")).toBeNull();
    expect(calcularRenglonCompra(renglon({ descuentoPct: "101" }), "A")).toBeNull();
  });
});

describe("totalesComprobanteCompra", () => {
  const renglones: RenglonCalculable[] = [
    renglon({ precioUnitario: "1000", alicuotaIva: 21 }),
    renglon({ cantidad: "2", precioUnitario: "100", descuentoPct: "10", alicuotaIva: 10.5 }),
    renglon({ precioUnitario: "100", alicuotaIva: 0 }),
    renglon({ precioUnitario: "50", alicuotaIva: null, exento: true }),
    renglon({ precioUnitario: "30", alicuotaIva: null }),
    renglon({ cantidad: "" }),
  ];
  const percepciones = [
    { tipo: "iva", importe: "15" },
    { tipo: "iibb", importe: "20" },
    { tipo: "iibb", importe: "5,00" },
    { tipo: "otro", importe: "7" },
    { tipo: "otro", importe: "" },
  ] as const;

  it("A: neto gravado por alícuota, IVA, no gravado, exento y percepciones por tipo", () => {
    expect(totalesComprobanteCompra(renglones, percepciones, "A")).toEqual({
      netoGravado: 1280,
      noGravado: 30,
      exento: 50,
      iva: 228.9,
      ivaPorAlicuota: [
        { alicuota: 0, neto: 100, iva: 0 },
        { alicuota: 10.5, neto: 180, iva: 18.9 },
        { alicuota: 21, neto: 1000, iva: 210 },
      ],
      percepcionIva: 15,
      percepcionIibb: 25,
      otrosImpuestos: 7,
      total: 1635.9,
    });
  });

  it("M discrimina IVA igual que A", () => {
    expect(totalesComprobanteCompra(renglones, percepciones, "M").total).toBe(1635.9);
  });

  it("B y C: todo lo no exento va a no gravado, sin IVA", () => {
    for (const letra of ["B", "C"] as const) {
      expect(totalesComprobanteCompra(renglones, percepciones, letra)).toEqual({
        netoGravado: 0,
        noGravado: 1310,
        exento: 50,
        iva: 0,
        ivaPorAlicuota: [],
        percepcionIva: 15,
        percepcionIibb: 25,
        otrosImpuestos: 7,
        total: 1407,
      });
    }
  });

  it("sin renglones ni percepciones, todo en cero", () => {
    expect(totalesComprobanteCompra([], [], "A").total).toBe(0);
  });
});

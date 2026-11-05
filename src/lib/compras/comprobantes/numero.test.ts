import { describe, expect, it } from "vitest";
import { NOMBRES_TIPO_COMPROBANTE_COMPRA, abreviaturaComprobanteCompra, numeroComprobanteCompra } from "./numero";

describe("abreviaturaComprobanteCompra", () => {
  it("abrevia el tipo y suma la letra", () => {
    expect(abreviaturaComprobanteCompra("factura", "A")).toBe("FC A");
    expect(abreviaturaComprobanteCompra("nota_credito", "B")).toBe("NC B");
    expect(abreviaturaComprobanteCompra("nota_debito", "C")).toBe("ND C");
    expect(abreviaturaComprobanteCompra("factura", "M")).toBe("FC M");
  });
});

describe("numeroComprobanteCompra", () => {
  it("rellena el punto de venta a 5 dígitos y el número a 8", () => {
    expect(numeroComprobanteCompra({ tipo: "factura", letra: "A", punto_venta: 3, numero: 12345 })).toBe(
      "FC A 00003-00012345",
    );
  });

  it("acepta el número como texto (bigint de Postgres)", () => {
    expect(numeroComprobanteCompra({ tipo: "nota_credito", letra: "B", punto_venta: 12, numero: "7" })).toBe(
      "NC B 00012-00000007",
    );
  });
});

describe("NOMBRES_TIPO_COMPROBANTE_COMPRA", () => {
  it("nombra cada tipo", () => {
    expect(NOMBRES_TIPO_COMPROBANTE_COMPRA).toEqual({
      factura: "Factura",
      nota_credito: "Nota de crédito",
      nota_debito: "Nota de débito",
    });
  });
});

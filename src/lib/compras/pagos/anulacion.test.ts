import { describe, expect, it } from "vitest";
import { efectosAnulacionOrdenPago, textoChequesNoDevolvibles, validarMotivoAnulacion } from "./anulacion";

describe("validarMotivoAnulacion", () => {
  it("pide el motivo", () => {
    expect(validarMotivoAnulacion("  ")).toBe("Escribí el motivo de la anulación.");
    expect(validarMotivoAnulacion("pagado dos veces")).toBeNull();
  });
});

describe("textoChequesNoDevolvibles", () => {
  it("null si todos los cheques entregados pueden volver a la cartera", () => {
    expect(textoChequesNoDevolvibles([{ banco: "Nación", numero: "1", estado: "entregado" }])).toBeNull();
  });

  it("nombra los cheques que ya no están entregados con esta orden", () => {
    expect(
      textoChequesNoDevolvibles([
        { banco: "Nación", numero: "1", estado: "entregado" },
        { banco: "Galicia", numero: "2", estado: "rechazado" },
      ]),
    ).toBe(
      "No se puede anular: estos cheques ya no pueden volver a la cartera: Galicia N° 2 (Rechazado). " +
        "La base no deja anular la orden mientras alguno de sus cheques esté en ese estado.",
    );
  });
});

describe("efectosAnulacionOrdenPago", () => {
  it("explica imputaciones, cheques de terceros y número", () => {
    expect(efectosAnulacionOrdenPago({ numero: "OP-00000003", chequesTerceros: 2 })).toEqual([
      "Los comprobantes que canceló vuelven a quedar pendientes (también lo que se les aplicó de su saldo a favor).",
      "Sus 2 cheques de terceros vuelven a la cartera.",
      "El número OP-00000003 no se vuelve a usar: la orden queda visible como anulada.",
    ]);
    expect(efectosAnulacionOrdenPago({ numero: "OP-1", chequesTerceros: 1 })[1]).toBe(
      "Su cheque de terceros vuelve a la cartera.",
    );
    expect(efectosAnulacionOrdenPago({ numero: "OP-1", chequesTerceros: 0 })).toHaveLength(2);
  });
});

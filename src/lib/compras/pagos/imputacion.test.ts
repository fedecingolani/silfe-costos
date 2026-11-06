import { describe, expect, it } from "vitest";
import { completarEnOrden, imputacionInicial, saldoAFavor, validarImputacionesPago } from "./imputacion";

const debitos = [
  { comprobanteId: "b", fecha: "2026-10-15", saldo: 300 },
  { comprobanteId: "a", fecha: "2026-10-01", saldo: 100.5 },
];

describe("validarImputacionesPago", () => {
  it("sin errores dentro del saldo y del total", () => {
    expect(validarImputacionesPago(debitos, [{ comprobanteId: "a", importe: 100.5 }], 200)).toEqual([]);
  });

  it("no imputa dos veces el mismo comprobante (la base lo rechaza con 23505)", () => {
    expect(
      validarImputacionesPago(
        debitos,
        [
          { comprobanteId: "a", importe: 10 },
          { comprobanteId: "a", importe: 20 },
        ],
        1000,
      ),
    ).toEqual(["Cada comprobante se imputa una sola vez."]);
  });

  it("no supera el saldo de cada comprobante ni el total de la orden", () => {
    expect(validarImputacionesPago(debitos, [{ comprobanteId: "a", importe: 100.51 }], 1000)).toEqual([
      "La imputación a un comprobante supera su saldo pendiente ($ 100,50).",
    ]);
    expect(validarImputacionesPago(debitos, [{ comprobanteId: "b", importe: 300 }], 299.99)).toEqual([
      "Lo imputado ($ 300,00) supera el total de la orden de pago ($ 299,99).",
    ]);
  });

  it("negativos y comprobantes sin saldo", () => {
    expect(validarImputacionesPago(debitos, [{ comprobanteId: "a", importe: -1 }], 10)).toEqual([
      "Un importe imputado no puede ser negativo.",
    ]);
    expect(validarImputacionesPago(debitos, [{ comprobanteId: "z", importe: 1 }], 10)).toEqual([
      "Uno de los comprobantes no tiene saldo pendiente.",
    ]);
  });
});

describe("completarEnOrden y saldoAFavor", () => {
  it("imputa del más viejo al más nuevo y lo que sobra queda a favor", () => {
    const elegidas = completarEnOrden(debitos, 150);
    expect(elegidas).toEqual([
      { comprobanteId: "a", importe: 100.5 },
      { comprobanteId: "b", importe: 49.5 },
    ]);
    expect(saldoAFavor(500, completarEnOrden(debitos, 500))).toBe(99.5);
  });
});

describe("imputacionInicial", () => {
  it("precarga el saldo del comprobante que se paga desde su pantalla", () => {
    expect(imputacionInicial(debitos, "b")).toEqual({ b: "300" });
  });

  it("nada si no llega comprobante o no tiene saldo pendiente", () => {
    expect(imputacionInicial(debitos, null)).toEqual({});
    expect(imputacionInicial(debitos, "z")).toEqual({});
  });
});

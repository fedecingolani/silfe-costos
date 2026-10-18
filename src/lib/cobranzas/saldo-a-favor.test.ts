import { describe, expect, it } from "vitest";
import { aplicarSaldoAFavor, type CreditoDisponible } from "./saldo-a-favor";

const R1: CreditoDisponible = { origen: "recibo", id: "r1", fecha: "2026-10-01", disponible: 30 };
const NC: CreditoDisponible = { origen: "nota_credito", id: "nc", fecha: "2026-10-05", disponible: 15.5 };
const R2: CreditoDisponible = { origen: "recibo", id: "r2", fecha: "2026-10-09", disponible: 100 };

describe("aplicarSaldoAFavor", () => {
  const factura = { id: "f", total: 50, condicionPago: "cuenta_corriente" as const };

  it("aplica de los créditos más viejos a los más nuevos hasta cubrir el débito", () => {
    expect(aplicarSaldoAFavor([R2, NC, R1], factura)).toEqual([
      { reciboId: "r1", notaCreditoId: null, comprobanteId: "f", importe: 30, automatica: true },
      { reciboId: null, notaCreditoId: "nc", comprobanteId: "f", importe: 15.5, automatica: true },
      { reciboId: "r2", notaCreditoId: null, comprobanteId: "f", importe: 4.5, automatica: true },
    ]);
  });

  it("si no alcanza, aplica todo lo disponible", () => {
    expect(aplicarSaldoAFavor([R1], factura)).toEqual([
      { reciboId: "r1", notaCreditoId: null, comprobanteId: "f", importe: 30, automatica: true },
    ]);
  });

  it("sin créditos no imputa", () => {
    expect(aplicarSaldoAFavor([], factura)).toEqual([]);
    expect(aplicarSaldoAFavor([{ ...R1, disponible: 0 }], factura)).toEqual([]);
  });

  it("un débito de contado nunca consume saldo a favor", () => {
    expect(aplicarSaldoAFavor([R1, R2], { ...factura, condicionPago: "contado" })).toEqual([]);
  });
});

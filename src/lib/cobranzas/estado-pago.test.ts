import { describe, expect, it } from "vitest";
import { NOMBRES_ESTADO_PAGO, enLotes, mapaSaldos } from "./estado-pago";

describe("estado de pago", () => {
  it("arma el mapa de saldos con números", () => {
    const mapa = mapaSaldos([
      { comprobante_id: "a", saldo: "30.00", estado_pago: "parcial" },
      { comprobante_id: "b", saldo: 0, estado_pago: "cancelado" },
    ]);
    expect(mapa.get("a")).toEqual({ comprobanteId: "a", saldo: 30, estadoPago: "parcial" });
    expect(mapa.get("b")?.estadoPago).toBe("cancelado");
    expect(mapa.get("c")).toBeUndefined();
  });

  it("nombra los tres estados", () => {
    expect(Object.values(NOMBRES_ESTADO_PAGO)).toEqual(["Pendiente", "Parcial", "Cancelado"]);
  });

  it("parte en lotes", () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enLotes([], 100)).toEqual([]);
    expect(() => enLotes([1], 0)).toThrow();
  });
});

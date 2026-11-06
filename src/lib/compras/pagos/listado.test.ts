import { describe, expect, it } from "vitest";
import { avisoDeParametroPago, leerFiltrosPagos, resumenConfirmacion } from "./listado";

const PROVEEDOR = "11111111-1111-4111-8111-111111111111";

describe("leerFiltrosPagos", () => {
  it("lee fechas, proveedor y estado válidos", () => {
    expect(
      leerFiltrosPagos({ desde: "2026-10-01", hasta: "2026-10-31", proveedor: PROVEEDOR, estado: "confirmado" }),
    ).toEqual({ desde: "2026-10-01", hasta: "2026-10-31", proveedor: PROVEEDOR, estado: "confirmado" });
  });

  it("ignora valores desconocidos", () => {
    expect(leerFiltrosPagos({ desde: "ayer", proveedor: "x", estado: "emitido" })).toEqual({
      desde: "",
      hasta: "",
      proveedor: "",
      estado: "",
    });
  });
});

describe("resumenConfirmacion", () => {
  it("dice total, proveedor, cheques que se entregan y lo que queda a favor", () => {
    expect(resumenConfirmacion({ total: 1500, proveedor: "Lonas SA", aFavor: 100, cheques: 2 })).toBe(
      "Se va a confirmar la orden de pago por $ 1.500,00 a Lonas SA. Se entregan 2 cheques de terceros. " +
        "Quedan $ 100,00 a favor del proveedor. No se puede modificar después.",
    );
    expect(resumenConfirmacion({ total: 10, proveedor: "Lonas SA", aFavor: 0, cheques: 1 })).toBe(
      "Se va a confirmar la orden de pago por $ 10,00 a Lonas SA. Se entrega 1 cheque de terceros. " +
        "No se puede modificar después.",
    );
  });
});

describe("avisoDeParametroPago", () => {
  it("sólo los avisos conocidos", () => {
    expect(avisoDeParametroPago("guardado")).toBe("Borrador guardado.");
    expect(avisoDeParametroPago("confirmado")).toBe("Orden de pago confirmada.");
    expect(avisoDeParametroPago("anulado")).toBe("Orden de pago anulada.");
    expect(avisoDeParametroPago("<script>")).toBeNull();
    expect(avisoDeParametroPago(["guardado"])).toBeNull();
  });
});

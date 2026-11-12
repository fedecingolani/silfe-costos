import { describe, expect, it } from "vitest";
import { enlaceOrigen, nombreOrigen } from "./movimientos";

describe("nombreOrigen", () => {
  it("nombra los orígenes conocidos y deja los demás como vienen", () => {
    expect(nombreOrigen("ajuste")).toBe("Ajuste");
    expect(nombreOrigen("recibo")).toBe("Recibo");
    expect(nombreOrigen("orden_pago")).toBe("Orden de pago");
    expect(nombreOrigen("cheque_deposito")).toBe("Depósito de cheque");
    expect(nombreOrigen("cheque_rechazo")).toBe("Cheque rechazado");
    expect(nombreOrigen("otro")).toBe("otro");
  });
});

describe("enlaceOrigen", () => {
  it("un recibo enlaza a su cobranza", () => {
    expect(enlaceOrigen({ origen: "recibo", origen_id: "abc" })).toBe("/cobranzas/abc");
  });

  it("una orden de pago enlaza a su página en compras", () => {
    expect(enlaceOrigen({ origen: "orden_pago", origen_id: "abc" })).toBe("/compras/pagos/abc");
  });

  it("el depósito y el rechazo de un cheque enlazan al cheque", () => {
    expect(enlaceOrigen({ origen: "cheque_deposito", origen_id: "abc" })).toBe("/cheques/abc");
    expect(enlaceOrigen({ origen: "cheque_rechazo", origen_id: "abc" })).toBe("/cheques/abc");
  });

  it("un ajuste no tiene página propia", () => {
    expect(enlaceOrigen({ origen: "ajuste", origen_id: "abc" })).toBeNull();
  });
});

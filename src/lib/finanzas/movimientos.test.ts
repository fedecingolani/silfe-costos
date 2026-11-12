import { describe, expect, it } from "vitest";
import { enlaceOrigen, nombreOrigen } from "./movimientos";

describe("nombreOrigen", () => {
  it("nombra los orígenes conocidos y deja los demás como vienen", () => {
    expect(nombreOrigen("ajuste")).toBe("Ajuste");
    expect(nombreOrigen("recibo")).toBe("Recibo");
    expect(nombreOrigen("otro")).toBe("otro");
  });
});

describe("enlaceOrigen", () => {
  it("un recibo enlaza a su cobranza", () => {
    expect(enlaceOrigen({ origen: "recibo", origen_id: "abc" })).toBe("/cobranzas/abc");
  });

  it("un ajuste no tiene página propia", () => {
    expect(enlaceOrigen({ origen: "ajuste", origen_id: "abc" })).toBeNull();
  });
});

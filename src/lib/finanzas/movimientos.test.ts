import { describe, expect, it } from "vitest";
import { enlaceOrigen, nombreOrigen, rangoMovimientosCuenta } from "./movimientos";

describe("nombreOrigen", () => {
  it("nombra los orígenes conocidos y deja los demás como vienen", () => {
    expect(nombreOrigen("ajuste")).toBe("Ajuste");
    expect(nombreOrigen("recibo")).toBe("Recibo");
    expect(nombreOrigen("orden_pago")).toBe("Orden de pago");
    expect(nombreOrigen("cheque_deposito")).toBe("Depósito de cheque");
    expect(nombreOrigen("cheque_rechazo")).toBe("Cheque rechazado");
    expect(nombreOrigen("transferencia")).toBe("Transferencia");
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

  it("una transferencia enlaza a la otra cuenta, no a una página propia", () => {
    expect(enlaceOrigen({ origen: "transferencia", origen_id: "abc" })).toBeNull();
  });
});

describe("rangoMovimientosCuenta", () => {
  const hoy = "2026-11-13";

  it("sin fechas: desde hace 12 meses y sin tope, para que se vean los movimientos futuros", () => {
    expect(rangoMovimientosCuenta({}, hoy)).toEqual({ desde: "2025-11-13", hasta: null });
  });

  it("con sólo desde: sin tope", () => {
    expect(rangoMovimientosCuenta({ desde: "2026-01-01" }, hoy)).toEqual({ desde: "2026-01-01", hasta: null });
    expect(rangoMovimientosCuenta({ desde: "2027-01-01" }, hoy)).toEqual({ desde: "2027-01-01", hasta: null });
  });

  it("con hasta: respeta el rango pedido, aunque deje afuera lo futuro", () => {
    expect(rangoMovimientosCuenta({ desde: "2026-01-01", hasta: "2026-06-30" }, hoy)).toEqual({
      desde: "2026-01-01",
      hasta: "2026-06-30",
    });
    expect(rangoMovimientosCuenta({ hasta: "2026-06-30" }, hoy)).toEqual({ desde: "2025-11-13", hasta: "2026-06-30" });
  });

  it("da vuelta un rango al revés e ignora las fechas inválidas", () => {
    expect(rangoMovimientosCuenta({ desde: "2026-06-30", hasta: "2026-01-01" }, hoy)).toEqual({
      desde: "2026-01-01",
      hasta: "2026-06-30",
    });
    expect(rangoMovimientosCuenta({ desde: "x", hasta: "2026-13-40" }, hoy)).toEqual({ desde: "2025-11-13", hasta: null });
    expect(rangoMovimientosCuenta({ desde: "", hasta: "" }, hoy)).toEqual({ desde: "2025-11-13", hasta: null });
  });
});

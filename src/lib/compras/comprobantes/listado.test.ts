import { describe, expect, it } from "vitest";
import { consultaFiltros, leerFiltros, permisosComprobanteCompra } from "./listado";

const PROVEEDOR = "a0000000-0000-0000-0000-000000000001";

describe("leerFiltros", () => {
  it("lee los filtros válidos de la URL", () => {
    expect(
      leerFiltros({ desde: "2026-11-01", hasta: "2026-11-30", proveedor: PROVEEDOR, tipo: "nota_credito", estado: "confirmado" }),
    ).toEqual({ desde: "2026-11-01", hasta: "2026-11-30", proveedor: PROVEEDOR, tipo: "nota_credito", estado: "confirmado" });
  });

  it("ignora los valores desconocidos y toma el primero de una lista", () => {
    expect(leerFiltros({ desde: "ayer", proveedor: "x", tipo: "recibo", estado: ["anulado", "borrador"] })).toEqual({
      desde: "",
      hasta: "",
      proveedor: "",
      tipo: "",
      estado: "anulado",
    });
  });
});

describe("consultaFiltros", () => {
  it("sólo incluye los filtros aplicados", () => {
    expect(consultaFiltros({ desde: "", hasta: "2026-11-30", proveedor: PROVEEDOR, tipo: "", estado: "borrador" })).toBe(
      `hasta=2026-11-30&proveedor=${PROVEEDOR}&estado=borrador`,
    );
    expect(consultaFiltros(leerFiltros({}))).toBe("");
  });
});

describe("permisosComprobanteCompra", () => {
  it("un borrador se edita, se confirma y se borra", () => {
    expect(permisosComprobanteCompra("borrador")).toEqual({
      puedeEditar: true,
      puedeConfirmar: true,
      puedeBorrar: true,
      puedeAnular: false,
    });
  });

  it("un confirmado sólo se anula", () => {
    expect(permisosComprobanteCompra("confirmado")).toEqual({
      puedeEditar: false,
      puedeConfirmar: false,
      puedeBorrar: false,
      puedeAnular: true,
    });
  });

  it("un anulado sólo se ve", () => {
    expect(Object.values(permisosComprobanteCompra("anulado")).some(Boolean)).toBe(false);
  });
});

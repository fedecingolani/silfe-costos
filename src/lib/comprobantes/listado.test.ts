import { describe, expect, it } from "vitest";
import { leerFiltros, nombreComprobante, numeroVisible, ordenarListado } from "./listado";

describe("leerFiltros", () => {
  it("sin parámetros, muestra el ambiente activo y nada más filtrado", () => {
    expect(leerFiltros({}, "produccion")).toEqual({
      desde: "",
      hasta: "",
      cliente: "",
      clase: "",
      estado: "",
      ambiente: "produccion",
    });
  });

  it("lee los filtros válidos de la URL", () => {
    expect(
      leerFiltros(
        {
          desde: "2026-10-01",
          hasta: "2026-10-31",
          cliente: "  frutícola ",
          clase: "nota_debito",
          estado: "rechazado",
          ambiente: "todos",
        },
        "produccion",
      ),
    ).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
      cliente: "frutícola",
      clase: "nota_debito",
      estado: "rechazado",
      ambiente: "todos",
    });
  });

  it("ignora valores que no son de la lista o fechas inválidas", () => {
    expect(
      leerFiltros({ desde: "ayer", hasta: "2026-02-30", clase: "remito", estado: "x", ambiente: "test" }, "homologacion"),
    ).toEqual({ desde: "", hasta: "", cliente: "", clase: "", estado: "", ambiente: "homologacion" });
  });

  it("acepta el filtro de comprobantes sin ARCA (X)", () => {
    expect(leerFiltros({ ambiente: "interno" }, "produccion").ambiente).toBe("interno");
  });

  it("toma el primer valor si un parámetro viene repetido", () => {
    expect(leerFiltros({ estado: ["borrador", "autorizado"] }, "produccion").estado).toBe("borrador");
  });
});

describe("ordenarListado", () => {
  it("pone los borradores arriba y después ordena por fecha descendente", () => {
    const filas = [
      { id: "1", estado: "autorizado" as const, fecha: "2026-10-10", creado_en: "2026-10-10T10:00:00Z" },
      { id: "2", estado: "borrador" as const, fecha: "2026-10-01", creado_en: "2026-10-01T10:00:00Z" },
      { id: "3", estado: "rechazado" as const, fecha: "2026-10-12", creado_en: "2026-10-12T10:00:00Z" },
      { id: "4", estado: "borrador" as const, fecha: "2026-10-05", creado_en: "2026-10-05T10:00:00Z" },
      { id: "5", estado: "autorizado" as const, fecha: "2026-10-10", creado_en: "2026-10-10T12:00:00Z" },
    ];
    expect(ordenarListado(filas).map((f) => f.id)).toEqual(["4", "2", "3", "5", "1"]);
  });
});

describe("nombres", () => {
  it("nombra el comprobante con su letra si la tiene", () => {
    expect(nombreComprobante("factura", "A")).toBe("Factura A");
    expect(nombreComprobante("nota_debito", null)).toBe("Nota de débito");
  });

  it("muestra el número sólo si está autorizado", () => {
    expect(numeroVisible({ letra: "A", punto_venta: 7, numero: 361 })).toBe("A-00007-00000361");
    expect(numeroVisible({ letra: null, punto_venta: 7, numero: null })).toBe("—");
  });
});

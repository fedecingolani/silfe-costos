import { describe, expect, it } from "vitest";
import { consultaFiltros, leerFiltros, mostrarAvisoHomologacion, nombreComprobante, numeroVisible, ordenarListado } from "./listado";

describe("mostrarAvisoHomologacion", () => {
  it("se muestra con el ambiente activo en homologación", () => {
    expect(mostrarAvisoHomologacion("homologacion", "homologacion")).toBe(true);
    expect(mostrarAvisoHomologacion("homologacion", "todos")).toBe(true);
  });

  it("no se muestra con el filtro de comprobantes sin ARCA (X)", () => {
    expect(mostrarAvisoHomologacion("homologacion", "interno")).toBe(false);
  });

  it("no se muestra con el ambiente activo en producción", () => {
    expect(mostrarAvisoHomologacion("produccion", "produccion")).toBe(false);
    expect(mostrarAvisoHomologacion("produccion", "interno")).toBe(false);
  });
});

describe("leerFiltros", () => {
  it("sin parámetros, no filtra nada (todos los ambientes)", () => {
    expect(leerFiltros({})).toEqual({
      desde: "",
      hasta: "",
      cliente: "",
      clase: "",
      estado: "",
      ambiente: "todos",
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
          ambiente: "produccion",
        },
      ),
    ).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
      cliente: "frutícola",
      clase: "nota_debito",
      estado: "rechazado",
      ambiente: "produccion",
    });
  });

  it("ignora valores que no son de la lista o fechas inválidas", () => {
    expect(
      leerFiltros({ desde: "ayer", hasta: "2026-02-30", clase: "remito", estado: "x", ambiente: "test" }),
    ).toEqual({ desde: "", hasta: "", cliente: "", clase: "", estado: "", ambiente: "todos" });
  });

  it("acepta el filtro de comprobantes sin ARCA (X)", () => {
    expect(leerFiltros({ ambiente: "interno" }).ambiente).toBe("interno");
  });

  it("toma el primer valor si un parámetro viene repetido", () => {
    expect(leerFiltros({ estado: ["borrador", "autorizado"] }).estado).toBe("borrador");
  });
});

describe("consultaFiltros", () => {
  it("sin filtros devuelve una consulta vacía", () => {
    expect(consultaFiltros(leerFiltros({}))).toBe("");
  });

  it("incluye sólo los filtros aplicados y vuelve a leerse igual", () => {
    const filtros = leerFiltros({ desde: "2026-10-01", cliente: "frutícola", ambiente: "produccion" });
    const consulta = consultaFiltros(filtros);
    expect(consulta).toBe("desde=2026-10-01&cliente=frut%C3%ADcola&ambiente=produccion");
    expect(leerFiltros(Object.fromEntries(new URLSearchParams(consulta)))).toEqual(filtros);
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

import { describe, expect, it } from "vitest";
import { NOMBRES_ESTADO_PRESUPUESTO, estaVencido, leerFiltros, numeroPresupuesto } from "./listado";

describe("numeroPresupuesto", () => {
  it("muestra el correlativo con 8 dígitos", () => {
    expect(numeroPresupuesto(1)).toBe("P-00000001");
    expect(numeroPresupuesto("361")).toBe("P-00000361");
    expect(numeroPresupuesto(123456789)).toBe("P-123456789");
  });
});

describe("NOMBRES_ESTADO_PRESUPUESTO", () => {
  it("nombra los estados", () => {
    expect(NOMBRES_ESTADO_PRESUPUESTO).toEqual({ abierto: "Abierto", convertido: "Convertido" });
  });
});

describe("estaVencido", () => {
  it("vence después del día de validez, no ese mismo día", () => {
    expect(estaVencido("2026-10-23", "2026-10-24")).toBe(true);
    expect(estaVencido("2026-10-24", "2026-10-24")).toBe(false);
    expect(estaVencido("2026-10-25", "2026-10-24")).toBe(false);
  });

  it("con fechas inválidas no lo marca vencido", () => {
    expect(estaVencido("", "2026-10-24")).toBe(false);
    expect(estaVencido("2026-10-23", "")).toBe(false);
  });
});

describe("leerFiltros", () => {
  it("sin parámetros no filtra nada", () => {
    expect(leerFiltros({})).toEqual({ desde: "", hasta: "", cliente: "", estado: "", vencidos: false });
  });

  it("lee los filtros válidos de la URL", () => {
    expect(
      leerFiltros({
        desde: "2026-10-01",
        hasta: "2026-10-31",
        cliente: "  frutícola ",
        estado: ["convertido", "abierto"],
        vencidos: "1",
      }),
    ).toEqual({ desde: "2026-10-01", hasta: "2026-10-31", cliente: "frutícola", estado: "convertido", vencidos: true });
  });

  it("ignora valores desconocidos", () => {
    expect(leerFiltros({ desde: "2026-02-30", hasta: "ayer", estado: "borrador", vencidos: "tal vez" })).toEqual({
      desde: "",
      hasta: "",
      cliente: "",
      estado: "",
      vencidos: false,
    });
  });
});

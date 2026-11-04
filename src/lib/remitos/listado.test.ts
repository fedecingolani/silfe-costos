import { describe, expect, it } from "vitest";
import { ESTADOS_REMITO } from "@/lib/tipos";
import { NOMBRES_ESTADO_REMITO, TONO_ESTADO_REMITO, consultaFiltros, leerFiltros } from "./listado";

describe("leerFiltros", () => {
  it("lee fechas, cliente, estado y punto de venta", () => {
    expect(
      leerFiltros({
        desde: "2026-11-01",
        hasta: "2026-11-30",
        cliente: "  Frutícola  ",
        estado: "parcial",
        punto_venta: "3",
      }),
    ).toEqual({ desde: "2026-11-01", hasta: "2026-11-30", cliente: "Frutícola", estado: "parcial", puntoVenta: 3 });
  });

  it("sin parámetros, todo vacío", () => {
    expect(leerFiltros({})).toEqual({ desde: "", hasta: "", cliente: "", estado: "", puntoVenta: null });
  });

  it("ignora fechas, estados y puntos de venta inválidos", () => {
    expect(
      leerFiltros({ desde: "2026-02-30", hasta: "ayer", estado: "convertido", punto_venta: "-1" }),
    ).toEqual({ desde: "", hasta: "", cliente: "", estado: "", puntoVenta: null });
    expect(leerFiltros({ punto_venta: "1.5" }).puntoVenta).toBeNull();
    expect(leerFiltros({ punto_venta: "abc" }).puntoVenta).toBeNull();
  });

  it("si un parámetro llega repetido, toma el primero", () => {
    expect(leerFiltros({ estado: ["emitido", "anulado"] }).estado).toBe("emitido");
  });
});

describe("consultaFiltros", () => {
  it("arma la consulta sólo con los filtros aplicados", () => {
    expect(consultaFiltros({ desde: "2026-11-01", hasta: "", cliente: "", estado: "emitido", puntoVenta: 2 })).toBe(
      "desde=2026-11-01&estado=emitido&punto_venta=2",
    );
    expect(consultaFiltros({ desde: "", hasta: "", cliente: "", estado: "", puntoVenta: null })).toBe("");
  });

  it("ida y vuelta con leerFiltros", () => {
    const filtros = leerFiltros({ cliente: "Juan Pérez", hasta: "2026-12-01", punto_venta: "4" });
    expect(leerFiltros(Object.fromEntries(new URLSearchParams(consultaFiltros(filtros))))).toEqual(filtros);
  });
});

describe("nombres y tonos de estado", () => {
  it("todos los estados tienen nombre y tono", () => {
    for (const estado of ESTADOS_REMITO) {
      expect(NOMBRES_ESTADO_REMITO[estado]).toBeTruthy();
      expect(TONO_ESTADO_REMITO[estado]).toBeTruthy();
    }
  });

  it("facturado en verde, anulado en rojo, borrador neutro", () => {
    expect(TONO_ESTADO_REMITO.facturado).toBe("verde");
    expect(TONO_ESTADO_REMITO.anulado).toBe("rojo");
    expect(TONO_ESTADO_REMITO.borrador).toBe("neutro");
    expect(NOMBRES_ESTADO_REMITO.parcial).toBe("Facturado parcial");
  });
});

import { describe, expect, it } from "vitest";
import {
  condicionEstadoVisible,
  consultaFiltros,
  estadoVisibleRemitoCompra,
  leerFiltros,
  numeroRemitoCompra,
  permisosRemitoCompra,
} from "./listado";

const PROVEEDOR = "a0000000-0000-0000-0000-000000000001";

describe("numeroRemitoCompra", () => {
  it("punto de venta y número del proveedor con ceros", () => {
    expect(numeroRemitoCompra({ punto_venta: 3, numero: 123 })).toBe("00003-00000123");
    expect(numeroRemitoCompra({ punto_venta: 99999, numero: "99999999" })).toBe("99999-99999999");
  });
});

describe("estadoVisibleRemitoCompra", () => {
  it("borrador y anulado se muestran como están", () => {
    expect(estadoVisibleRemitoCompra("borrador", "pendiente")).toBe("borrador");
    expect(estadoVisibleRemitoCompra("anulado", "pendiente")).toBe("anulado");
  });

  it("un recibido se muestra según lo facturado", () => {
    expect(estadoVisibleRemitoCompra("recibido", "pendiente")).toBe("recibido");
    expect(estadoVisibleRemitoCompra("recibido", "parcial")).toBe("parcial");
    expect(estadoVisibleRemitoCompra("recibido", "facturado")).toBe("facturado");
  });
});

describe("condicionEstadoVisible", () => {
  it("traduce el estado que se filtra a las columnas de v_remito_compra_estado", () => {
    expect(condicionEstadoVisible("borrador")).toEqual({ estado: "borrador" });
    expect(condicionEstadoVisible("anulado")).toEqual({ estado: "anulado" });
    expect(condicionEstadoVisible("recibido")).toEqual({ estado: "recibido", estado_facturacion: "pendiente" });
    expect(condicionEstadoVisible("parcial")).toEqual({ estado: "recibido", estado_facturacion: "parcial" });
    expect(condicionEstadoVisible("facturado")).toEqual({ estado: "recibido", estado_facturacion: "facturado" });
  });
});

describe("filtros", () => {
  it("lee fechas, proveedor y estado válidos", () => {
    expect(
      leerFiltros({ desde: "2026-11-01", hasta: ["2026-11-30"], proveedor: PROVEEDOR, estado: "parcial" }),
    ).toEqual({ desde: "2026-11-01", hasta: "2026-11-30", proveedor: PROVEEDOR, estado: "parcial" });
  });

  it("ignora lo desconocido", () => {
    expect(leerFiltros({ desde: "ayer", proveedor: "otro", estado: "emitido" })).toEqual({
      desde: "",
      hasta: "",
      proveedor: "",
      estado: "",
    });
  });

  it("la consulta lleva sólo los filtros aplicados", () => {
    expect(consultaFiltros({ desde: "", hasta: "", proveedor: "", estado: "" })).toBe("");
    expect(consultaFiltros({ desde: "2026-11-01", hasta: "", proveedor: PROVEEDOR, estado: "recibido" })).toBe(
      `desde=2026-11-01&proveedor=${PROVEEDOR}&estado=recibido`,
    );
  });
});

describe("permisosRemitoCompra", () => {
  it("un borrador se edita, se borra y se recibe", () => {
    expect(permisosRemitoCompra("borrador")).toEqual({
      puedeEditar: true,
      puedeBorrar: true,
      puedeRecibir: true,
      puedeAnular: false,
      puedeFacturar: false,
    });
  });

  it("un recibido sin nada facturado se anula o se factura", () => {
    expect(permisosRemitoCompra("recibido")).toEqual({
      puedeEditar: false,
      puedeBorrar: false,
      puedeRecibir: false,
      puedeAnular: true,
      puedeFacturar: true,
    });
  });

  it("facturado en parte sólo factura lo pendiente; facturado y anulado no hacen nada", () => {
    expect(permisosRemitoCompra("parcial")).toMatchObject({ puedeAnular: false, puedeFacturar: true });
    for (const estado of ["facturado", "anulado"] as const) {
      expect(Object.values(permisosRemitoCompra(estado)).some(Boolean)).toBe(false);
    }
  });
});

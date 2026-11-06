import { describe, expect, it } from "vitest";
import type { RemitoCompra, RemitoCompraItem } from "@/lib/tipos";
import {
  armarRemitoCompra,
  editorDeRemitoCompra,
  editorRemitoCompraNuevo,
  filaRemitoCompraVacia,
  parametrosGuardarRemitoCompra,
  remitoCompraEnviado,
  type RemitoCompraEnviado,
  type RenglonRemitoEnviado,
} from "./borrador";

const PROVEEDOR = "a0000000-0000-0000-0000-000000000001";
const ARTICULO = "b0000000-0000-0000-0000-000000000001";
const MATERIA_PRIMA = "c0000000-0000-0000-0000-000000000001";
const REMITO = "d0000000-0000-0000-0000-000000000001";

const renglon = (cambios: Partial<RenglonRemitoEnviado> = {}): RenglonRemitoEnviado => ({
  modo: "articulo",
  articuloId: ARTICULO,
  codigo: "SOGA8",
  descripcion: "SOGA PP diam 8MM",
  unidad: "rollo",
  materiaPrimaId: "",
  factor: "1",
  cantidad: "2",
  ...cambios,
});

const enviado = (cambios: Partial<RemitoCompraEnviado> = {}): RemitoCompraEnviado => ({
  proveedorId: PROVEEDOR,
  puntoVenta: "3",
  numero: "123",
  fecha: "2026-11-05",
  observaciones: "  Llegó con el flete ",
  renglones: [
    renglon(),
    renglon({
      modo: "nuevo",
      articuloId: null,
      codigo: " MALLA-1 ",
      descripcion: "MALLA 50% NEGRA",
      unidad: "m",
      materiaPrimaId: MATERIA_PRIMA,
      factor: "2,5",
      cantidad: "10,5",
    }),
  ],
  ...cambios,
});

function armado(cambios: Partial<RemitoCompraEnviado> = {}) {
  const resultado = armarRemitoCompra(enviado(cambios));
  if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
  return resultado.armado;
}

function errores(valor: unknown): string[] {
  const resultado = armarRemitoCompra(valor);
  return "errores" in resultado ? resultado.errores : [];
}

describe("armarRemitoCompra", () => {
  it("arma p_remito con las claves que lee guardar_remito_compra", () => {
    expect(armado().remito).toEqual({
      proveedor_id: PROVEEDOR,
      punto_venta: 3,
      numero: 123,
      fecha: "2026-11-05",
      observaciones: "Llegó con el flete",
    });
  });

  it("un artículo del catálogo va con proveedor_articulo_id", () => {
    expect(armado().items[0]).toEqual({
      proveedor_articulo_id: ARTICULO,
      codigo_proveedor: "SOGA8",
      descripcion: "SOGA PP diam 8MM",
      unidad: "rollo",
      cantidad: 2,
    });
  });

  it("un artículo nuevo va con articulo_nuevo y su materia prima", () => {
    expect(armado().items[1]).toEqual({
      articulo_nuevo: {
        codigo: "MALLA-1",
        descripcion: "MALLA 50% NEGRA",
        unidad: "m",
        factor_conversion: 2.5,
        materia_prima_id: MATERIA_PRIMA,
      },
      codigo_proveedor: "MALLA-1",
      descripcion: "MALLA 50% NEGRA",
      unidad: "m",
      cantidad: 10.5,
    });
  });

  it("la descripción se guarda tal cual la escribió el proveedor", () => {
    expect(armado({ renglones: [renglon({ descripcion: "  SOGA  8MM " })] }).items[0].descripcion).toBe("  SOGA  8MM ");
  });

  it("sin observaciones van null", () => {
    expect(armado({ observaciones: " " }).remito.observaciones).toBeNull();
  });

  it("valida la cabecera", () => {
    expect(errores(enviado({ proveedorId: "", puntoVenta: "0", numero: "abc", fecha: "2026-02-30" }))).toEqual([
      "Elegí el proveedor.",
      "El punto de venta va de 1 a 99999.",
      "El número del remito va de 1 a 99999999.",
      "La fecha del remito no es válida.",
    ]);
  });

  it("pide al menos un renglón", () => {
    expect(errores(enviado({ renglones: [] }))).toContain("Agregá al menos un renglón.");
  });

  it("cada renglón lleva un artículo: del catálogo o nuevo con materia prima", () => {
    expect(
      errores(
        enviado({
          renglones: [
            renglon({ articuloId: null }),
            renglon({ modo: "nuevo", articuloId: null, materiaPrimaId: "" }),
            renglon({ modo: "nuevo", articuloId: null, materiaPrimaId: MATERIA_PRIMA, descripcion: " " }),
            renglon({ modo: "nuevo", articuloId: null, materiaPrimaId: MATERIA_PRIMA, factor: "0" }),
            renglon({ modo: "libre" as never, articuloId: null }),
          ],
        }),
      ),
    ).toEqual([
      "Renglón 1: elegí el artículo del proveedor.",
      "Renglón 2: elegí la materia prima del artículo nuevo.",
      "Renglón 3: escribí la descripción.",
      "Renglón 4: el factor de conversión tiene que ser un número mayor que cero.",
      "Renglón 5: elegí el artículo del proveedor.",
    ]);
  });

  it("la cantidad es mayor que cero, con hasta 4 decimales", () => {
    expect(
      errores(enviado({ renglones: [renglon({ cantidad: "0" }), renglon({ cantidad: "" }), renglon({ cantidad: "1.23456" })] })),
    ).toEqual([
      "Renglón 1: la cantidad tiene que ser mayor que cero.",
      "Renglón 2: la cantidad tiene que ser mayor que cero.",
      "Renglón 3: la cantidad admite hasta 4 decimales.",
    ]);
  });

  it("rechaza lo que no tiene forma de remito", () => {
    expect(errores(null)).toEqual(["Los datos del remito no son válidos."]);
    expect(errores({ proveedorId: PROVEEDOR })).toEqual(["Los datos del remito no son válidos."]);
  });
});

describe("parametrosGuardarRemitoCompra", () => {
  it("tiene exactamente los parámetros de la RPC", () => {
    const a = armado();
    expect(parametrosGuardarRemitoCompra(REMITO, a)).toEqual({ p_id: REMITO, p_remito: a.remito, p_items: a.items });
    expect(parametrosGuardarRemitoCompra(null, a).p_id).toBeNull();
  });
});

describe("editor", () => {
  it("un remito nuevo arranca con la fecha de hoy y un renglón vacío del catálogo", () => {
    const editor = editorRemitoCompraNuevo("2026-11-05");
    expect(editor).toMatchObject({ proveedorId: "", puntoVenta: "", numero: "", fecha: "2026-11-05", observaciones: "" });
    expect(editor.filas).toHaveLength(1);
    expect(editor.filas[0]).toMatchObject({ modo: "articulo", articuloId: null, cantidad: "1", factor: "1" });
  });

  it("cada fila vacía tiene su propia clave", () => {
    expect(filaRemitoCompraVacia().clave).not.toBe(filaRemitoCompraVacia().clave);
  });

  it("lo enviado no lleva los datos que sólo sirven en pantalla", () => {
    const [fila] = remitoCompraEnviado(editorRemitoCompraNuevo("2026-11-05")).renglones;
    expect(fila).not.toHaveProperty("clave");
    expect(fila).not.toHaveProperty("busqueda");
  });

  describe("ida y vuelta: remito guardado → editor → lo que se guarda", () => {
    const remito: RemitoCompra = {
      id: REMITO,
      proveedor_id: PROVEEDOR,
      punto_venta: 7,
      numero: 99,
      fecha: "2026-11-01",
      observaciones: null,
      estado: "borrador",
      recibido_en: null,
      anulado_en: null,
      creado_por: null,
      creado_en: "2026-11-01T10:00:00Z",
      actualizado_en: "2026-11-01T10:00:00Z",
    };
    const item = (cambios: Partial<RemitoCompraItem>): RemitoCompraItem => ({
      id: "e0000000-0000-0000-0000-000000000001",
      remito_compra_id: REMITO,
      orden: 0,
      proveedor_articulo_id: ARTICULO,
      materia_prima_id: MATERIA_PRIMA,
      codigo_proveedor: "SOGA8",
      descripcion: "SOGA PP diam 8MM",
      unidad: "rollo",
      cantidad: 2.5,
      ...cambios,
    });
    const items = [item({ orden: 1, codigo_proveedor: null, descripcion: "Otra", unidad: null, cantidad: 1 }), item({})];

    it("carga la cabecera y los renglones en orden", () => {
      const editor = editorDeRemitoCompra(remito, items);
      expect(editor).toMatchObject({ proveedorId: PROVEEDOR, puntoVenta: "7", numero: "99", fecha: "2026-11-01", observaciones: "" });
      expect(editor.filas.map((f) => f.descripcion)).toEqual(["SOGA PP diam 8MM", "Otra"]);
      expect(editor.filas[0]).toMatchObject({ modo: "articulo", articuloId: ARTICULO, cantidad: "2.5" });
    });

    it("vuelve a guardar lo mismo que estaba guardado", () => {
      const resultado = armarRemitoCompra(remitoCompraEnviado(editorDeRemitoCompra(remito, items)));
      if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
      expect(resultado.armado).toEqual({
        remito: { proveedor_id: PROVEEDOR, punto_venta: 7, numero: 99, fecha: "2026-11-01", observaciones: null },
        items: [
          { proveedor_articulo_id: ARTICULO, codigo_proveedor: "SOGA8", descripcion: "SOGA PP diam 8MM", unidad: "rollo", cantidad: 2.5 },
          { proveedor_articulo_id: ARTICULO, codigo_proveedor: null, descripcion: "Otra", unidad: null, cantidad: 1 },
        ],
      });
    });

    it("sin renglones guardados, el editor arranca con uno vacío", () => {
      expect(editorDeRemitoCompra(remito, []).filas).toHaveLength(1);
    });
  });
});

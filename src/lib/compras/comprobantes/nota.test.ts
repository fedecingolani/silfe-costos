import { describe, expect, it } from "vitest";
import type { ComprobanteCompra, ComprobanteCompraItem } from "@/lib/tipos";
import { armarComprobanteCompra, comprobanteEnviado } from "./borrador";
import {
  confirmaConPrecios,
  editorNotaDeFactura,
  esNotaCompra,
  facturaAsociadaEnEditor,
  notaDesdeParametros,
  puedeTenerNotas,
  type FacturaAsociable,
  type NotaAsociada,
} from "./nota";

const PROVEEDOR = "a0000000-0000-0000-0000-000000000001";
const ARTICULO = "b0000000-0000-0000-0000-000000000001";
const FACTURA = "d0000000-0000-0000-0000-000000000001";

const factura: ComprobanteCompra = {
  id: FACTURA,
  proveedor_id: PROVEEDOR,
  tipo: "factura",
  letra: "A",
  punto_venta: 3,
  numero: 12345,
  fecha: "2026-10-20",
  fecha_vencimiento: "2026-11-20",
  observaciones: "Entrega parcial",
  neto_gravado: 0,
  no_gravado: 0,
  exento: 0,
  iva: 0,
  percepcion_iva: 0,
  percepcion_iibb: 0,
  otros_impuestos: 0,
  total: 2100,
  estado: "confirmado",
  confirmado_en: "2026-10-20T10:00:00Z",
  anulado_en: null,
  creado_por: null,
  creado_en: "2026-10-20T10:00:00Z",
  actualizado_en: "2026-10-20T10:00:00Z",
  comprobante_asociado_id: null,
};

const item = (cambios: Partial<ComprobanteCompraItem>): ComprobanteCompraItem => ({
  id: "e0000000-0000-0000-0000-000000000001",
  comprobante_compra_id: FACTURA,
  orden: 0,
  proveedor_articulo_id: null,
  materia_prima_id: null,
  codigo_proveedor: null,
  descripcion: "Flete",
  unidad: null,
  cantidad: 1,
  precio_unitario: 100,
  descuento_pct: 0,
  alicuota_iva: null,
  exento: false,
  importe: 100,
  iva: 0,
  remito_compra_item_id: null,
  ...cambios,
});

const items = [
  item({ orden: 2, descripcion: "Servicio exento", exento: true }),
  item({ orden: 1 }),
  item({
    orden: 0,
    proveedor_articulo_id: ARTICULO,
    codigo_proveedor: "SOGA8",
    descripcion: "SOGA PP diam 8MM",
    unidad: "rollo",
    cantidad: 2,
    precio_unitario: 1000.5,
    descuento_pct: 10,
    alicuota_iva: 21,
  }),
];

describe("esNotaCompra", () => {
  it("las notas de crédito y débito son notas; la factura no", () => {
    expect(esNotaCompra("nota_credito")).toBe(true);
    expect(esNotaCompra("nota_debito")).toBe(true);
    expect(esNotaCompra("factura")).toBe(false);
  });
});

describe("puedeTenerNotas", () => {
  it("sólo una factura confirmada", () => {
    expect(puedeTenerNotas(factura)).toBe(true);
    expect(puedeTenerNotas({ ...factura, estado: "borrador" })).toBe(false);
    expect(puedeTenerNotas({ ...factura, estado: "anulado" })).toBe(false);
    expect(puedeTenerNotas({ ...factura, tipo: "nota_credito" })).toBe(false);
  });
});

describe("notaDesdeParametros", () => {
  it("lee la factura y el tipo de nota de la dirección", () => {
    expect(notaDesdeParametros(FACTURA, "nota_credito")).toEqual({ facturaId: FACTURA, tipo: "nota_credito" });
    expect(notaDesdeParametros([FACTURA], ["nota_debito"])).toEqual({ facturaId: FACTURA, tipo: "nota_debito" });
  });

  it("con datos inválidos o incompletos es un comprobante nuevo común", () => {
    expect(notaDesdeParametros(undefined, undefined)).toBeNull();
    expect(notaDesdeParametros("otra", "nota_credito")).toBeNull();
    expect(notaDesdeParametros(FACTURA, "factura")).toBeNull();
    expect(notaDesdeParametros(FACTURA, undefined)).toBeNull();
  });
});

describe("editorNotaDeFactura", () => {
  const editor = editorNotaDeFactura(factura, items, "nota_credito", "2026-11-05");

  it("toma proveedor, letra y la factura asociada; número vacío y fecha de hoy", () => {
    expect(editor).toMatchObject({
      proveedorId: PROVEEDOR,
      tipo: "nota_credito",
      letra: "A",
      puntoVenta: "",
      numero: "",
      fecha: "2026-11-05",
      fechaVencimiento: "",
      observaciones: "",
      comprobanteAsociadoId: FACTURA,
      percepciones: [],
    });
  });

  it("copia los renglones en orden con sus precios", () => {
    expect(editor.filas.map((f) => f.descripcion)).toEqual(["SOGA PP diam 8MM", "Flete", "Servicio exento"]);
    expect(editor.filas[0]).toMatchObject({
      modo: "articulo",
      articuloId: ARTICULO,
      codigo: "SOGA8",
      unidad: "rollo",
      cantidad: "2",
      precioUnitario: "1000.5",
      descuentoPct: "10",
      alicuotaIva: "21",
      exento: false,
    });
    expect(editor.filas[1]).toMatchObject({ modo: "libre", articuloId: null, alicuotaIva: "no_gravado" });
    expect(editor.filas[2]).toMatchObject({ modo: "libre", exento: true });
  });

  it("los renglones de la nota no vienen de remitos aunque la factura sí", () => {
    const deRemito = item({
      proveedor_articulo_id: ARTICULO,
      descripcion: "SOGA PP diam 8MM",
      remito_compra_item_id: "90000000-0000-0000-0000-000000000001",
    });
    const nota = editorNotaDeFactura(factura, [deRemito], "nota_debito", "2026-11-05");
    expect(nota.filas[0].remitoItemId).toBeNull();
  });

  it("cada renglón tiene su propia clave", () => {
    expect(new Set(editor.filas.map((f) => f.clave)).size).toBe(editor.filas.length);
  });

  it("lo copiado se arma para guardar como nota asociada (con número)", () => {
    const resultado = armarComprobanteCompra({ ...comprobanteEnviado(editor), puntoVenta: "3", numero: "77" });
    if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
    expect(resultado.armado.comprobante).toMatchObject({ tipo: "nota_credito", comprobante_asociado_id: FACTURA });
    expect(resultado.armado.items).toHaveLength(3);
    expect(resultado.armado.percepciones).toEqual([]);
  });
});

describe("confirmaConPrecios", () => {
  it("una factura elige precios al confirmarse", () => {
    expect(confirmaConPrecios("factura")).toBe(true);
  });

  it("una nota se confirma sin precios", () => {
    expect(confirmaConPrecios("nota_credito")).toBe(false);
    expect(confirmaConPrecios("nota_debito")).toBe(false);
  });
});

describe("facturaAsociadaEnEditor", () => {
  const OTRA = "d0000000-0000-0000-0000-000000000002";
  const listada: FacturaAsociable = {
    id: OTRA, tipo: "factura", letra: "A", punto_venta: 3, numero: 1, fecha: "2026-10-01", total: 100,
  };
  const guardada: NotaAsociada = {
    id: FACTURA, tipo: "factura", letra: "A", punto_venta: 3, numero: 12345, fecha: "2026-01-20", total: 2100,
    estado: "confirmado",
  };

  it("sin factura asociada, ofrece la lista sin aviso", () => {
    expect(facturaAsociadaEnEditor("", [listada], undefined)).toEqual({ opciones: [listada], aviso: null });
  });

  it("la asociada que está en la lista no lleva aviso", () => {
    expect(facturaAsociadaEnEditor(OTRA, [listada], undefined)).toEqual({ opciones: [listada], aviso: null });
  });

  it("la asociada confirmada que quedó fuera de la lista se agrega a las opciones, sin aviso", () => {
    const { opciones, aviso } = facturaAsociadaEnEditor(FACTURA, [listada], guardada);
    expect(aviso).toBeNull();
    expect(opciones.map((f) => f.id)).toEqual([FACTURA, OTRA]);
    expect(opciones[0]).toEqual({
      id: FACTURA, tipo: "factura", letra: "A", punto_venta: 3, numero: 12345, fecha: "2026-01-20", total: 2100,
    });
  });

  it("avisa que ya no está confirmada sólo si de verdad no lo está", () => {
    expect(facturaAsociadaEnEditor(FACTURA, [listada], { ...guardada, estado: "anulado" })).toEqual({
      opciones: [listada],
      aviso: "no_confirmada",
    });
  });

  it("avisa que no existe si no se encontró", () => {
    expect(facturaAsociadaEnEditor(FACTURA, [listada], null).aviso).toBe("inexistente");
  });

  it("sin los datos de la asociada (falló la lectura), el aviso es neutro", () => {
    expect(facturaAsociadaEnEditor(FACTURA, [], undefined)).toEqual({ opciones: [], aviso: "sin_datos" });
    expect(facturaAsociadaEnEditor(FACTURA, [], { ...guardada, id: OTRA }).aviso).toBe("sin_datos");
  });
});

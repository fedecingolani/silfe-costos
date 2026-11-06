import { describe, expect, it } from "vitest";
import type { RemitoCompraItemPendiente } from "@/lib/tipos";
import {
  agruparPorRemito,
  aplicarSeleccion,
  armarFacturacion,
  MENSAJE_SELECCION_DESACTUALIZADA,
  seleccionInicial,
  type CabeceraFacturaEnviada,
} from "./facturacion";

const PROVEEDOR = "a0000000-0000-0000-0000-000000000001";
const OTRO_PROVEEDOR = "a0000000-0000-0000-0000-000000000002";
const REMITO_1 = "d0000000-0000-0000-0000-000000000001";
const REMITO_2 = "d0000000-0000-0000-0000-000000000002";

const fila = (cambios: Partial<RemitoCompraItemPendiente>): RemitoCompraItemPendiente => ({
  remito_compra_item_id: "e0000000-0000-0000-0000-000000000001",
  remito_compra_id: REMITO_1,
  proveedor_id: PROVEEDOR,
  punto_venta: 3,
  numero: 123,
  fecha: "2026-11-01",
  estado_remito: "recibido",
  orden: 0,
  proveedor_articulo_id: "b0000000-0000-0000-0000-000000000001",
  materia_prima_id: "c0000000-0000-0000-0000-000000000001",
  codigo_proveedor: "SOGA8",
  descripcion: "SOGA PP diam 8MM",
  unidad: "rollo",
  cantidad: 10,
  facturada: 4,
  pendiente: 6,
  ...cambios,
});

const filas = [
  fila({ remito_compra_item_id: "e2", remito_compra_id: REMITO_2, numero: 200, fecha: "2026-11-03", orden: 0 }),
  fila({ remito_compra_item_id: "e1b", orden: 1, descripcion: "Malla", pendiente: "2.5" as unknown as number }),
  fila({ remito_compra_item_id: "e1a", orden: 0 }),
  fila({ remito_compra_item_id: "x-borrador", estado_remito: "borrador" }),
  fila({ remito_compra_item_id: "x-anulado", estado_remito: "anulado" }),
  fila({ remito_compra_item_id: "x-facturado", pendiente: 0 }),
];

const cabecera = (cambios: Partial<CabeceraFacturaEnviada> = {}): CabeceraFacturaEnviada => ({
  letra: "A",
  puntoVenta: "5",
  numero: "777",
  fecha: "2026-11-05",
  fechaVencimiento: "",
  observaciones: " ",
  ...cambios,
});

describe("seleccionInicial", () => {
  it("sólo renglones con algo pendiente de remitos recibidos, por remito y renglón, con todo lo pendiente", () => {
    const items = seleccionInicial(filas);
    expect(items.map((i) => i.remitoItemId)).toEqual(["e1a", "e1b", "e2"]);
    expect(items[0]).toEqual({
      remitoItemId: "e1a",
      remitoId: REMITO_1,
      proveedorId: PROVEEDOR,
      numeroRemito: "00003-00000123",
      fechaRemito: "2026-11-01",
      codigo: "SOGA8",
      descripcion: "SOGA PP diam 8MM",
      unidad: "rollo",
      cantidadRemito: 10,
      facturada: 4,
      pendiente: 6,
      elegido: true,
      cantidad: "6",
    });
    expect(items[1]).toMatchObject({ pendiente: 2.5, cantidad: "2.5" });
  });

  it("desde un remito, se eligen sólo sus renglones", () => {
    const items = seleccionInicial(filas, REMITO_2);
    expect(items.filter((i) => i.elegido).map((i) => i.remitoItemId)).toEqual(["e2"]);
  });
});

describe("armarFacturacion", () => {
  const items = seleccionInicial(filas);

  it("arma los parámetros de facturar_remitos_compra", () => {
    const resultado = armarFacturacion(
      items.map((i) => (i.remitoItemId === "e1b" ? { ...i, cantidad: "1,25" } : i)),
      cabecera({ fechaVencimiento: "2026-12-05", observaciones: " Pago a 30 días " }),
    );
    expect(resultado).toEqual({
      pedido: {
        p_items: [
          { remito_compra_item_id: "e1a", cantidad: 6 },
          { remito_compra_item_id: "e1b", cantidad: 1.25 },
          { remito_compra_item_id: "e2", cantidad: 6 },
        ],
        p_comprobante: {
          letra: "A",
          punto_venta: 5,
          numero: 777,
          fecha: "2026-11-05",
          fecha_vencimiento: "2026-12-05",
          observaciones: "Pago a 30 días",
        },
      },
    });
  });

  it("los renglones no elegidos no van", () => {
    const resultado = armarFacturacion(
      items.map((i) => ({ ...i, elegido: i.remitoItemId === "e2" })),
      cabecera(),
    );
    if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
    expect(resultado.pedido.p_items).toEqual([{ remito_compra_item_id: "e2", cantidad: 6 }]);
    expect(resultado.pedido.p_comprobante).toMatchObject({ fecha_vencimiento: null, observaciones: null });
  });

  it("valida las cantidades contra lo pendiente", () => {
    const resultado = armarFacturacion(
      items.map((i, n) => ({ ...i, cantidad: ["0", "2.50001", "7"][n] })),
      cabecera(),
    );
    expect(resultado).toEqual({
      errores: [
        "SOGA PP diam 8MM (remito 00003-00000123): la cantidad tiene que ser mayor que cero.",
        "Malla (remito 00003-00000123): la cantidad admite hasta 4 decimales.",
        "SOGA PP diam 8MM (remito 00003-00000200): quedan 6 pendientes, no se puede facturar 7.",
      ],
    });
  });

  it("pide al menos un renglón y un solo proveedor", () => {
    expect(armarFacturacion(items.map((i) => ({ ...i, elegido: false })), cabecera())).toEqual({
      errores: ["Elegí al menos un renglón para facturar."],
    });
    const mezclados = [...items, { ...items[0], remitoItemId: "otro", proveedorId: OTRO_PROVEEDOR }];
    expect(armarFacturacion(mezclados, cabecera())).toEqual({
      errores: ["Los renglones son de proveedores distintos: una factura junta remitos de un mismo proveedor."],
    });
  });

  it("valida la cabecera de la factura", () => {
    expect(
      armarFacturacion(items, {
        letra: "X",
        puntoVenta: "",
        numero: "0",
        fecha: "mañana",
        fechaVencimiento: "",
        observaciones: "",
      }),
    ).toEqual({
      errores: [
        "Elegí la letra de la factura.",
        "El punto de venta va de 1 a 99999.",
        "El número de la factura va de 1 a 99999999.",
        "La fecha de la factura no es válida.",
      ],
    });
    expect(armarFacturacion(items, cabecera({ fechaVencimiento: "2026-11-01" }))).toEqual({
      errores: ["El vencimiento no puede ser anterior a la fecha de la factura."],
    });
    expect(armarFacturacion(items, null)).toEqual({ errores: ["Los datos de la factura no son válidos."] });
  });
});

describe("aplicarSeleccion", () => {
  const base = seleccionInicial(filas);

  it("del navegador toma sólo si va y cuánto; lo que no manda queda sin elegir", () => {
    const resultado = aplicarSeleccion(base, [
      { remitoItemId: "e1a", elegido: true, cantidad: "3" },
      { remitoItemId: "e1b", elegido: false, cantidad: "1", pendiente: 99 },
    ]);
    if ("error" in resultado) throw new Error(resultado.error);
    expect(resultado.items.map((i) => [i.remitoItemId, i.elegido, i.cantidad, i.pendiente])).toEqual([
      ["e1a", true, "3", 6],
      ["e1b", false, "1", 2.5],
      ["e2", false, "6", 6],
    ]);
  });

  it("un renglón elegido que ya no está pendiente pide recargar", () => {
    expect(aplicarSeleccion(base, [{ remitoItemId: "x-facturado", elegido: true, cantidad: "1" }])).toEqual({
      error: MENSAJE_SELECCION_DESACTUALIZADA,
    });
  });

  it("rechaza lo que no tiene forma de selección", () => {
    expect(aplicarSeleccion(base, "todo")).toEqual({ error: "Los datos de la facturación no son válidos." });
    expect(aplicarSeleccion(base, [{ remitoItemId: "e1a", elegido: "sí", cantidad: "1" }])).toEqual({
      error: "Los datos de la facturación no son válidos.",
    });
  });
});

describe("agruparPorRemito", () => {
  it("junta los renglones de cada remito en el orden en que llegan", () => {
    const grupos = agruparPorRemito(seleccionInicial(filas));
    expect(grupos.map((g) => [g.remitoId, g.numeroRemito, g.items.length])).toEqual([
      [REMITO_1, "00003-00000123", 2],
      [REMITO_2, "00003-00000200", 1],
    ]);
  });
});

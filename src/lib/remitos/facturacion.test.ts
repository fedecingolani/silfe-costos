import { describe, expect, it } from "vitest";
import type { RemitoItemPendiente } from "@/lib/tipos";
import {
  MENSAJE_CLIENTE_SIN_CONDICION_IVA,
  armarFacturacion,
  seleccionInicial,
  subtotalFacturacion,
  type ItemAFacturar,
} from "./facturacion";

const CLIENTE = "c0000000-0000-0000-0000-000000000001";
const OTRO_CLIENTE = "c0000000-0000-0000-0000-000000000002";

const fila = (cambios: Partial<RemitoItemPendiente> = {}): RemitoItemPendiente => ({
  remito_item_id: "f0000000-0000-0000-0000-000000000001",
  remito_id: "e0000000-0000-0000-0000-000000000001",
  cliente_id: CLIENTE,
  punto_venta: 1,
  numero: 3,
  fecha: "2026-11-04",
  estado_remito: "emitido",
  orden: 0,
  producto_id: null,
  codigo: "LON-01",
  descripcion: "Lona",
  unidad: "Unidad",
  precio_unitario: 10,
  descuento_pct: 0,
  gravado: true,
  alicuota_iva: 21,
  bultos: 3,
  cantidad: 300,
  facturado: 0,
  pendiente: 300,
  ...cambios,
});

const filas = [
  fila(),
  fila({
    remito_item_id: "f0000000-0000-0000-0000-000000000002",
    remito_id: "e0000000-0000-0000-0000-000000000002",
    numero: 4,
    fecha: "2026-11-05",
    descripcion: "Correa",
    codigo: null,
    precio_unitario: 4,
    alicuota_iva: 10.5,
    cantidad: 150.25,
    facturado: 50,
    pendiente: 100.25,
  }),
];

const electronico = { numero: 5, electronico: true, activo: true };
const noElectronico = { numero: 9, electronico: false, activo: true };
const contexto = { puntoVenta: electronico, condicionIvaCliente: "Responsable Inscripto" as const };

const con = (items: ItemAFacturar[], i: number, cambios: Partial<ItemAFacturar>) =>
  items.map((item, j) => (j === i ? { ...item, ...cambios } : item));

describe("seleccionInicial", () => {
  it("elige cada ítem pendiente con todo lo pendiente", () => {
    const items = seleccionInicial(filas);
    expect(items.map((i) => [i.remitoItemId, i.elegido, i.cantidad, i.pendiente, i.numeroRemito])).toEqual([
      ["f0000000-0000-0000-0000-000000000001", true, "300", 300, "R-00001-00000003"],
      ["f0000000-0000-0000-0000-000000000002", true, "100.25", 100.25, "R-00001-00000004"],
    ]);
  });

  it("deja afuera lo que no tiene pendiente o no es de un remito emitido", () => {
    const items = seleccionInicial([
      fila({ remito_item_id: "a", pendiente: 0, facturado: 300 }),
      fila({ remito_item_id: "b", estado_remito: "anulado" }),
      fila({ remito_item_id: "c", estado_remito: "borrador", numero: null }),
      fila({ remito_item_id: "d" }),
    ]);
    expect(items.map((i) => i.remitoItemId)).toEqual(["d"]);
  });

  it("ordena por remito (fecha, punto de venta, número) y orden del ítem", () => {
    const items = seleccionInicial([
      fila({ remito_item_id: "z", fecha: "2026-11-06", numero: 1 }),
      fila({ remito_item_id: "y", numero: 3, orden: 1 }),
      fila({ remito_item_id: "x", numero: 3, orden: 0 }),
      fila({ remito_item_id: "w", numero: 2 }),
    ]);
    expect(items.map((i) => i.remitoItemId)).toEqual(["w", "x", "y", "z"]);
  });
});

describe("armarFacturacion", () => {
  it("arma los parámetros exactos de facturar_remitos con todo lo pendiente", () => {
    const resultado = armarFacturacion(seleccionInicial(filas), contexto);
    expect(resultado).toEqual({
      pedido: {
        p_items: [
          { remito_item_id: "f0000000-0000-0000-0000-000000000001", cantidad: 300 },
          { remito_item_id: "f0000000-0000-0000-0000-000000000002", cantidad: 100.25 },
        ],
        p_punto_venta: 5,
      },
      totales: expect.objectContaining({ neto: 3401, noGravado: 0, iva: 672.11, total: 4073.11 }),
    });
    if ("pedido" in resultado) {
      for (const item of resultado.pedido.p_items) expect(Object.keys(item).sort()).toEqual(["cantidad", "remito_item_id"]);
    }
  });

  it("factura cantidades parciales y decimales (0,5 y 100.25)", () => {
    const items = con(seleccionInicial(filas), 0, { cantidad: "0,5" });
    const resultado = armarFacturacion(items, contexto);
    expect("pedido" in resultado && resultado.pedido.p_items).toEqual([
      { remito_item_id: "f0000000-0000-0000-0000-000000000001", cantidad: 0.5 },
      { remito_item_id: "f0000000-0000-0000-0000-000000000002", cantidad: 100.25 },
    ]);
  });

  it("los no elegidos no se mandan", () => {
    const items = con(seleccionInicial(filas), 1, { elegido: false, cantidad: "basura" });
    const resultado = armarFacturacion(items, contexto);
    expect("pedido" in resultado && resultado.pedido.p_items).toEqual([
      { remito_item_id: "f0000000-0000-0000-0000-000000000001", cantidad: 300 },
    ]);
  });

  it("la cantidad tiene que ser mayor que cero", () => {
    for (const cantidad of ["0", "", "-1", "abc"]) {
      expect(armarFacturacion(con(seleccionInicial(filas), 0, { cantidad }), contexto)).toEqual({
        errores: ["Lona (R-00001-00000003): la cantidad tiene que ser mayor a cero."],
      });
    }
  });

  it("no se puede facturar más que lo pendiente; justo lo pendiente sí", () => {
    expect(armarFacturacion(con(seleccionInicial(filas), 1, { cantidad: "100.24999" }), contexto)).toEqual({
      errores: ["Correa (R-00001-00000004): la cantidad admite hasta 4 decimales."],
    });
    expect(armarFacturacion(con(seleccionInicial(filas), 1, { cantidad: "100.2501" }), contexto)).toEqual({
      errores: ["Correa (R-00001-00000004): quedan 100.25 pendientes, no se puede facturar 100.2501."],
    });
    expect(armarFacturacion(con(seleccionInicial(filas), 1, { cantidad: "100.26" }), contexto)).toEqual({
      errores: ["Correa (R-00001-00000004): quedan 100.25 pendientes, no se puede facturar 100.26."],
    });
    expect("pedido" in armarFacturacion(con(seleccionInicial(filas), 1, { cantidad: "100,2500" }), contexto)).toBe(true);
  });

  it("compara sin errores de coma flotante", () => {
    const items = seleccionInicial([fila({ pendiente: 0.3, cantidad: 0.3 })]);
    expect(armarFacturacion(con(items, 0, { cantidad: "0.1" }), contexto)).toMatchObject({ pedido: expect.anything() });
    expect(armarFacturacion(con(items, 0, { cantidad: "0.3" }), contexto)).toMatchObject({ pedido: expect.anything() });
    // 0.1 + 0.2 en coma flotante es 0.30000000000000004: más de 4 decimales, se rechaza en lugar de redondear.
    expect(armarFacturacion(con(items, 0, { cantidad: String(0.1 + 0.2) }), contexto)).toEqual({
      errores: ["Lona (R-00001-00000003): la cantidad admite hasta 4 decimales."],
    });
  });

  it("pide al menos un ítem elegido", () => {
    const items = seleccionInicial(filas).map((i) => ({ ...i, elegido: false }));
    expect(armarFacturacion(items, contexto)).toEqual({ errores: ["Elegí al menos un ítem para facturar."] });
    expect(armarFacturacion([], contexto)).toEqual({ errores: ["Elegí al menos un ítem para facturar."] });
  });

  it("todos del mismo cliente", () => {
    const items = con(seleccionInicial(filas), 1, { clienteId: OTRO_CLIENTE });
    expect(armarFacturacion(items, contexto)).toEqual({
      errores: ["Los ítems son de clientes distintos: una factura junta remitos de un mismo cliente."],
    });
  });

  it("pide el punto de venta, activo", () => {
    expect(armarFacturacion(seleccionInicial(filas), { ...contexto, puntoVenta: null })).toEqual({
      errores: ["Elegí el punto de venta de la factura."],
    });
    expect(armarFacturacion(seleccionInicial(filas), { ...contexto, puntoVenta: { ...electronico, activo: false } })).toEqual({
      errores: ["Elegí el punto de venta de la factura."],
    });
  });

  it("en un punto electrónico, un cliente sin condición de IVA da un error claro (la letra quedaría vacía)", () => {
    expect(armarFacturacion(seleccionInicial(filas), { ...contexto, condicionIvaCliente: null })).toEqual({
      errores: [MENSAJE_CLIENTE_SIN_CONDICION_IVA],
    });
    expect(MENSAJE_CLIENTE_SIN_CONDICION_IVA).toBe(
      "El cliente no tiene condición de IVA: cargala en el cliente para facturar en un punto de venta electrónico (define la letra A o B).",
    );
  });

  it("en un punto no electrónico (X) no hace falta la condición de IVA y no suma IVA", () => {
    const resultado = armarFacturacion(seleccionInicial(filas), { puntoVenta: noElectronico, condicionIvaCliente: null });
    expect(resultado).toMatchObject({
      pedido: { p_punto_venta: 9 },
      totales: { neto: 3401, iva: 0, total: 3401 },
    });
  });

  it("junta todos los errores", () => {
    const items = con(con(seleccionInicial(filas), 0, { cantidad: "0" }), 1, { clienteId: OTRO_CLIENTE });
    expect(armarFacturacion(items, { puntoVenta: null, condicionIvaCliente: null })).toEqual({
      errores: [
        "Elegí el punto de venta de la factura.",
        "Los ítems son de clientes distintos: una factura junta remitos de un mismo cliente.",
        "Lona (R-00001-00000003): la cantidad tiene que ser mayor a cero.",
      ],
    });
  });
});

describe("subtotalFacturacion", () => {
  it("suma los elegidos con cantidad válida, como calculo.ts", () => {
    const items = con(seleccionInicial(filas), 0, { cantidad: "0.5" });
    expect(subtotalFacturacion(items)).toMatchObject({ neto: 406, iva: 43.16, total: 449.16 });
  });

  it("ignora los no elegidos y las cantidades a medio cargar o que exceden lo pendiente", () => {
    const items = con(con(seleccionInicial(filas), 0, { elegido: false }), 1, { cantidad: "" });
    expect(subtotalFacturacion(items)).toMatchObject({ neto: 0, total: 0 });
    expect(subtotalFacturacion(con(seleccionInicial(filas), 0, { cantidad: "301" }))).toMatchObject({ neto: 401 });
  });

  it("sin IVA en un punto no electrónico", () => {
    expect(subtotalFacturacion(seleccionInicial(filas), { sinIva: true })).toMatchObject({ neto: 3401, iva: 0, total: 3401 });
  });

  it("un ítem no gravado suma en no gravado", () => {
    const items = seleccionInicial([fila({ gravado: false, alicuota_iva: null })]);
    expect(subtotalFacturacion(items)).toMatchObject({ neto: 0, noGravado: 3000, iva: 0, total: 3000 });
  });
});

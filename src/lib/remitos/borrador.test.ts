import { describe, expect, it } from "vitest";
import type { ProductoCatalogo } from "@/lib/comprobantes/borrador";
import type { ProductoVendible } from "@/lib/ventas/filas";
import type { Remito, RemitoItem } from "@/lib/tipos";
import {
  armarRemito,
  datosDeEntregaDelCliente,
  editorDeRemito,
  parametrosGuardarRemito,
  remitoEnviado,
  type RemitoEnviado,
} from "./borrador";

const CLIENTE = "c0000000-0000-0000-0000-000000000001";
const PRODUCTO = "b0000000-0000-0000-0000-000000000001";
const LISTA = "a0000000-0000-0000-0000-000000000001";
const TRANSPORTE = "d0000000-0000-0000-0000-000000000001";
const REMITO = "e0000000-0000-0000-0000-000000000001";

const productos = new Map<string, ProductoCatalogo>([
  [PRODUCTO, { id: PRODUCTO, codigo: "LON-01", nombre: "Lona cosechera", alicuota_iva: 21, unidad: "Docena" }],
]);

const contexto = { productos };

const enviado = (cambios: Partial<RemitoEnviado> = {}): RemitoEnviado => ({
  clienteId: CLIENTE,
  puntoVenta: "2",
  fecha: "2026-11-04",
  fechaVencimientoPago: "2026-12-04",
  condicionPago: "cuenta_corriente",
  listaPrecioId: LISTA,
  transporteId: TRANSPORTE,
  domicilioEntrega: "  Ruta 22 km 1200, Allen ",
  observaciones: " Frágil ",
  valorDeclarado: "",
  items: [
    {
      productoId: PRODUCTO,
      descripcion: "lo que mande el navegador",
      observaciones: "Color verde",
      cantidad: "2",
      precioUnitario: "1000,5",
      descuentoPct: "10",
      alicuotaIva: "10.5",
      bultos: "3",
    },
    {
      productoId: null,
      descripcion: " Correa ",
      observaciones: "",
      cantidad: "1",
      precioUnitario: "500",
      descuentoPct: "",
      alicuotaIva: "10.5",
      bultos: "",
    },
  ],
  ...cambios,
});

function armado(cambios: Partial<RemitoEnviado> = {}) {
  const resultado = armarRemito(enviado(cambios), contexto);
  if (!("remito" in resultado)) throw new Error(resultado.errores.join(" "));
  return resultado.remito;
}

describe("armarRemito", () => {
  it("arma la cabecera con las claves exactas de p_remito de guardar_remito", () => {
    const { cabecera } = armado();
    expect(Object.keys(cabecera).sort()).toEqual(
      [
        "punto_venta",
        "cliente_id",
        "fecha",
        "fecha_vencimiento_pago",
        "condicion_pago",
        "lista_precio_id",
        "transporte_id",
        "domicilio_entrega",
        "observaciones",
        "valor_declarado",
        "neto",
        "no_gravado",
        "iva",
        "total",
      ].sort(),
    );
    expect(cabecera).toEqual({
      punto_venta: 2,
      cliente_id: CLIENTE,
      fecha: "2026-11-04",
      fecha_vencimiento_pago: "2026-12-04",
      condicion_pago: "cuenta_corriente",
      lista_precio_id: LISTA,
      transporte_id: TRANSPORTE,
      domicilio_entrega: "Ruta 22 km 1200, Allen",
      observaciones: "Frágil",
      // Vacío: la suma de los importes.
      valor_declarado: 2300.9,
      neto: 2300.9,
      no_gravado: 0,
      iva: 430.69,
      total: 2731.59,
    });
  });

  it("arma los ítems con las claves exactas de p_items, bultos incluidos", () => {
    const { items } = armado();
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "producto_id",
          "codigo",
          "descripcion",
          "observaciones",
          "unidad",
          "cantidad",
          "precio_unitario",
          "descuento_pct",
          "gravado",
          "alicuota_iva",
          "importe",
          "iva",
          "bultos",
        ].sort(),
      );
    }
    expect(items[0]).toEqual({
      producto_id: PRODUCTO,
      codigo: "LON-01",
      descripcion: "Lona cosechera",
      observaciones: "Color verde",
      unidad: "Docena",
      cantidad: 2,
      precio_unitario: 1000.5,
      descuento_pct: 10,
      gravado: true,
      alicuota_iva: 21,
      importe: 1800.9,
      iva: 378.19,
      bultos: 3,
    });
    expect(items[1]).toMatchObject({ producto_id: null, descripcion: "Correa", importe: 500, iva: 52.5, bultos: 0 });
  });

  it("respeta un valor declarado cargado a mano, aunque difiera de la suma", () => {
    expect(armado({ valorDeclarado: "1500,50" }).cabecera.valor_declarado).toBe(1500.5);
    expect(armado({ valorDeclarado: "0" }).cabecera.valor_declarado).toBe(0);
  });

  it("con contado el vencimiento es la fecha; sin transporte ni domicilio van null", () => {
    const { cabecera } = armado({ condicionPago: "contado", fechaVencimientoPago: "", transporteId: "", domicilioEntrega: " " });
    expect(cabecera.fecha_vencimiento_pago).toBe("2026-11-04");
    expect(cabecera.transporte_id).toBeNull();
    expect(cabecera.domicilio_entrega).toBeNull();
  });

  it("junta los errores de cabecera, ítems, bultos y valor declarado", () => {
    const resultado = armarRemito(
      enviado({
        clienteId: "",
        puntoVenta: "",
        valorDeclarado: "-1",
        items: [{ ...enviado().items[1], bultos: "1.5" }, { ...enviado().items[1], cantidad: "0" }],
      }),
      contexto,
    );
    expect(resultado).toEqual({
      errores: [
        "Elegí el cliente.",
        "Elegí el punto de venta.",
        "Ítem 1: los bultos tienen que ser un número entero, 0 o más.",
        "Ítem 2: la cantidad tiene que ser mayor a cero.",
        "El valor declarado no puede ser negativo ni estar mal escrito.",
      ],
    });
  });

  it("rechaza un transporte o una lista de precios mal formados en vez de guardarlos vacíos", () => {
    expect(armarRemito(enviado({ transporteId: "no-es-un-id" }), contexto)).toEqual({
      errores: ["El transporte elegido no es válido."],
    });
    expect(armarRemito(enviado({ listaPrecioId: "no-es-un-id" }), contexto)).toEqual({
      errores: ["La lista de precios elegida no es válida."],
    });
  });

  it("pide al menos un ítem", () => {
    expect(armarRemito(enviado({ items: [] }), contexto)).toEqual({ errores: ["Agregá al menos un ítem."] });
  });

  it("rechaza datos que no son un remito", () => {
    expect(armarRemito(null, contexto)).toEqual({ errores: ["Los datos del remito no son válidos."] });
    expect(armarRemito({ items: "x" }, contexto)).toEqual({ errores: ["Los datos del remito no son válidos."] });
  });

  it("valida fecha, condición de pago y vencimiento como la factura", () => {
    const resultado = armarRemito(enviado({ fecha: "2026-02-30", condicionPago: "otra" as never }), contexto);
    expect(resultado).toEqual({ errores: ["La fecha del remito no es válida.", "Elegí la condición de pago."] });
    expect(armarRemito(enviado({ fechaVencimientoPago: "2026-11-01" }), contexto)).toEqual({
      errores: ["El vencimiento del cobro no puede ser anterior a la fecha."],
    });
  });
});

describe("parametrosGuardarRemito", () => {
  it("arma los parámetros exactos de la RPC", () => {
    const remito = armado();
    expect(parametrosGuardarRemito(null, remito)).toEqual({ p_id: null, p_remito: remito.cabecera, p_items: remito.items });
    expect(parametrosGuardarRemito(REMITO, remito).p_id).toBe(REMITO);
  });
});

describe("editor ↔ remito guardado", () => {
  const vendibles: ProductoVendible[] = [{ id: PRODUCTO, codigo: "LON-01", nombre: "Lona cosechera", alicuota: 21, alicuotaOriginal: 21 }];

  const remito: Remito = {
    id: REMITO,
    punto_venta: 2,
    numero: null,
    cliente_id: CLIENTE,
    fecha: "2026-11-04",
    fecha_vencimiento_pago: "2026-12-04",
    condicion_pago: "cuenta_corriente",
    lista_precio_id: LISTA,
    transporte_id: TRANSPORTE,
    domicilio_entrega: "Ruta 22 km 1200, Allen",
    observaciones: null,
    neto: 2300.9,
    no_gravado: 0,
    iva: 430.69,
    total: 2731.59,
    valor_declarado: 2300.9,
    bultos_total: 3,
    estado: "borrador",
    emitido_en: null,
    anulado_en: null,
    creado_por: null,
    creado_en: "2026-11-04T12:00:00Z",
    actualizado_en: "2026-11-04T12:00:00Z",
  };

  const item = (cambios: Partial<RemitoItem> = {}): RemitoItem => ({
    id: "f0000000-0000-0000-0000-000000000001",
    remito_id: REMITO,
    orden: 0,
    producto_id: PRODUCTO,
    codigo: "LON-01",
    descripcion: "Lona cosechera",
    observaciones: "Color verde",
    unidad: "Docena",
    cantidad: 2,
    precio_unitario: 1000.5,
    descuento_pct: 10,
    gravado: true,
    alicuota_iva: 21,
    importe: 1800.9,
    iva: 378.19,
    bultos: 3,
    ...cambios,
  });

  const items = [
    item(),
    item({ orden: 1, producto_id: null, codigo: null, descripcion: "Correa", observaciones: null, unidad: null, cantidad: 1, precio_unitario: 500, descuento_pct: 0, alicuota_iva: 10.5, importe: 500, iva: 52.5, bultos: 0 }),
  ];

  it("carga la cabecera, las filas con sus bultos y el valor declarado que sigue a la suma", () => {
    const editor = editorDeRemito(remito, items, vendibles);
    expect(editor).toMatchObject({
      clienteId: CLIENTE,
      puntoVenta: "2",
      fecha: "2026-11-04",
      fechaVencimientoPago: "2026-12-04",
      condicionPago: "cuenta_corriente",
      listaPrecioId: LISTA,
      transporteId: TRANSPORTE,
      domicilioEntrega: "Ruta 22 km 1200, Allen",
      observaciones: "",
      valorDeclarado: { valor: "2300.90", manual: false },
    });
    expect(editor.filas.map((f) => [f.descripcion, f.cantidad, f.bultos])).toEqual([
      ["Lona cosechera", "2", "3"],
      ["Correa", "1", "0"],
    ]);
  });

  it("un valor declarado distinto de la suma se carga como manual", () => {
    expect(editorDeRemito({ ...remito, valor_declarado: 5000 }, items, vendibles).valorDeclarado).toEqual({
      valor: "5000.00",
      manual: true,
    });
  });

  it("ida y vuelta: lo cargado se vuelve a armar igual", () => {
    const vuelta = armarRemito(remitoEnviado(editorDeRemito(remito, items, vendibles)), contexto);
    expect(vuelta).toEqual({ remito: armado({ observaciones: "", valorDeclarado: "2300.90" }) });
  });
});

describe("datosDeEntregaDelCliente", () => {
  it("toma el transporte y arma el domicilio con los datos del cliente", () => {
    expect(
      datosDeEntregaDelCliente({ transporte_id: TRANSPORTE, direccion: "Ruta 22 km 1200", localidad: "Allen", provincia: "Río Negro" }),
    ).toEqual({ transporteId: TRANSPORTE, domicilioEntrega: "Ruta 22 km 1200, Allen, Río Negro" });
  });

  it("omite lo vacío", () => {
    expect(datosDeEntregaDelCliente({ transporte_id: null, direccion: null, localidad: " ", provincia: "Neuquén" })).toEqual({
      transporteId: "",
      domicilioEntrega: "Neuquén",
    });
  });
});

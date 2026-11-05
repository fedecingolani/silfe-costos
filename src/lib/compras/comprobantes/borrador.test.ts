import { describe, expect, it } from "vitest";
import type { ComprobanteCompra, ComprobanteCompraItem, ComprobanteCompraPercepcion, ProveedorArticulo } from "@/lib/tipos";
import {
  armarComprobanteCompra,
  buscarArticulos,
  cambiosAlElegirArticulo,
  comprobanteEnviado,
  editorComprobanteCompraNuevo,
  editorDeComprobanteCompra,
  filaCompraVacia,
  parametrosGuardarComprobanteCompra,
  renglonCalculable,
  type ComprobanteCompraEnviado,
  type RenglonEnviado,
} from "./borrador";

const PROVEEDOR = "a0000000-0000-0000-0000-000000000001";
const ARTICULO = "b0000000-0000-0000-0000-000000000001";
const MATERIA_PRIMA = "c0000000-0000-0000-0000-000000000001";
const COMPROBANTE = "d0000000-0000-0000-0000-000000000001";

const renglon = (cambios: Partial<RenglonEnviado> = {}): RenglonEnviado => ({
  modo: "libre",
  articuloId: null,
  codigo: "",
  descripcion: "Flete",
  unidad: "",
  materiaPrimaId: "",
  factor: "1",
  cantidad: "1",
  precioUnitario: "100",
  descuentoPct: "",
  alicuotaIva: "21",
  exento: false,
  ...cambios,
});

const enviado = (cambios: Partial<ComprobanteCompraEnviado> = {}): ComprobanteCompraEnviado => ({
  proveedorId: PROVEEDOR,
  tipo: "factura",
  letra: "A",
  puntoVenta: "3",
  numero: "12345",
  fecha: "2026-11-05",
  fechaVencimiento: "2026-12-05",
  observaciones: "  Entrega parcial ",
  renglones: [
    renglon({
      modo: "articulo",
      articuloId: ARTICULO,
      codigo: "SOGA8",
      descripcion: "SOGA PP diam 8MM",
      unidad: "rollo",
      cantidad: "2",
      precioUnitario: "1000,5",
      descuentoPct: "10",
      alicuotaIva: "21",
    }),
    renglon({
      modo: "nuevo",
      codigo: " MALLA-1 ",
      descripcion: "MALLA 50% NEGRA",
      unidad: "m",
      materiaPrimaId: MATERIA_PRIMA,
      factor: "2,5",
      cantidad: "10",
      precioUnitario: "50",
      alicuotaIva: "10.5",
    }),
    renglon({ descripcion: "Flete", alicuotaIva: "no_gravado" }),
    renglon({ descripcion: "Servicio exento", alicuotaIva: "21", exento: true }),
  ],
  percepciones: [
    { tipo: "iva", jurisdiccion: "", descripcion: "", importe: "15" },
    { tipo: "iibb", jurisdiccion: "Buenos Aires", descripcion: " RG 1 ", importe: "20,5" },
  ],
  ...cambios,
});

function armado(cambios: Partial<ComprobanteCompraEnviado> = {}) {
  const resultado = armarComprobanteCompra(enviado(cambios));
  if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
  return resultado.armado;
}

function errores(valor: unknown): string[] {
  const resultado = armarComprobanteCompra(valor);
  return "errores" in resultado ? resultado.errores : [];
}

describe("armarComprobanteCompra", () => {
  it("arma p_comprobante con las claves que lee guardar_comprobante_compra", () => {
    expect(armado().comprobante).toEqual({
      proveedor_id: PROVEEDOR,
      tipo: "factura",
      letra: "A",
      punto_venta: 3,
      numero: 12345,
      fecha: "2026-11-05",
      fecha_vencimiento: "2026-12-05",
      observaciones: "Entrega parcial",
    });
  });

  it("un artículo existente va con proveedor_articulo_id y sin articulo_nuevo", () => {
    expect(armado().items[0]).toEqual({
      proveedor_articulo_id: ARTICULO,
      codigo_proveedor: "SOGA8",
      descripcion: "SOGA PP diam 8MM",
      unidad: "rollo",
      cantidad: 2,
      precio_unitario: 1000.5,
      descuento_pct: 10,
      alicuota_iva: 21,
      exento: false,
    });
  });

  it("un artículo nuevo va con articulo_nuevo y sin proveedor_articulo_id", () => {
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
      cantidad: 10,
      precio_unitario: 50,
      descuento_pct: 0,
      alicuota_iva: 10.5,
      exento: false,
    });
  });

  it("un renglón libre no lleva artículo; no gravado y exento van sin alícuota", () => {
    const [, , flete, exento] = armado().items;
    expect(flete).toEqual({
      codigo_proveedor: null,
      descripcion: "Flete",
      unidad: null,
      cantidad: 1,
      precio_unitario: 100,
      descuento_pct: 0,
      alicuota_iva: null,
      exento: false,
    });
    expect(exento).toMatchObject({ alicuota_iva: null, exento: true });
  });

  it("la descripción del renglón se guarda tal cual la escribió el proveedor", () => {
    const items = armado({ renglones: [renglon({ descripcion: "  SOGA  8MM " })] }).items;
    expect(items[0].descripcion).toBe("  SOGA  8MM ");
  });

  it("arma p_percepciones: jurisdicción y descripción vacías van null", () => {
    expect(armado().percepciones).toEqual([
      { tipo: "iva", jurisdiccion: null, descripcion: null, importe: 15 },
      { tipo: "iibb", jurisdiccion: "Buenos Aires", descripcion: "RG 1", importe: 20.5 },
    ]);
  });

  it("sin vencimiento ni observaciones van null", () => {
    expect(armado({ fechaVencimiento: "", observaciones: " " }).comprobante).toMatchObject({
      fecha_vencimiento: null,
      observaciones: null,
    });
  });

  it("valida la cabecera", () => {
    expect(
      errores(
        enviado({
          proveedorId: "",
          tipo: "recibo" as never,
          letra: "X" as never,
          puntoVenta: "0",
          numero: "0",
          fecha: "2026-13-01",
          fechaVencimiento: "mañana",
        }),
      ),
    ).toEqual([
      "Elegí el proveedor.",
      "Elegí el tipo de comprobante.",
      "Elegí la letra del comprobante.",
      "El punto de venta va de 1 a 99999.",
      "El número del comprobante va de 1 a 99999999.",
      "La fecha del comprobante no es válida.",
      "El vencimiento no es una fecha válida.",
    ]);
    expect(errores(enviado({ puntoVenta: "100000", numero: "1.5" }))).toEqual([
      "El punto de venta va de 1 a 99999.",
      "El número del comprobante va de 1 a 99999999.",
    ]);
  });

  it("el vencimiento no puede ser anterior a la fecha", () => {
    expect(errores(enviado({ fechaVencimiento: "2026-11-04" }))).toEqual([
      "El vencimiento no puede ser anterior a la fecha del comprobante.",
    ]);
    expect(errores(enviado({ fechaVencimiento: "2026-11-05" }))).toEqual([]);
  });

  it("pide al menos un renglón", () => {
    expect(errores(enviado({ renglones: [] }))).toEqual(["Agregá al menos un renglón."]);
  });

  it("valida los renglones, con su número", () => {
    expect(
      errores(
        enviado({
          renglones: [
            renglon({ modo: "articulo", articuloId: null }),
            renglon({ descripcion: " ", cantidad: "0", precioUnitario: "-1", descuentoPct: "101" }),
            renglon({ modo: "nuevo", materiaPrimaId: "", factor: "0" }),
            renglon({ alicuotaIva: "22" }),
          ],
        }),
      ),
    ).toEqual([
      "Renglón 1: elegí el artículo del proveedor.",
      "Renglón 2: escribí la descripción.",
      "Renglón 2: la cantidad tiene que ser mayor que cero.",
      "Renglón 2: el precio tiene que ser un número, 0 o más.",
      "Renglón 2: el descuento va de 0 a 100.",
      "Renglón 3: elegí la materia prima del artículo nuevo.",
      "Renglón 3: el factor de conversión tiene que ser un número mayor que cero.",
      "Renglón 4: la alícuota de IVA no es válida.",
    ]);
  });

  it("en B y C un renglón con alícuota es un error", () => {
    expect(errores(enviado({ letra: "B", renglones: [renglon({ alicuotaIva: "21" })] }))).toEqual([
      "Renglón 1: los comprobantes B y C no discriminan IVA: el renglón no lleva alícuota.",
    ]);
    expect(armado({ letra: "C", renglones: [renglon({ alicuotaIva: "no_gravado" })] }).items[0].alicuota_iva).toBeNull();
  });

  it("valida las percepciones, con su número", () => {
    expect(
      errores(
        enviado({
          percepciones: [
            { tipo: "" as never, jurisdiccion: "", descripcion: "", importe: "1" },
            { tipo: "iibb", jurisdiccion: " ", descripcion: "", importe: "0" },
          ],
        }),
      ),
    ).toEqual([
      "Percepción 1: elegí el tipo.",
      "Percepción 2: indicá la jurisdicción de ingresos brutos.",
      "Percepción 2: el importe tiene que ser mayor que cero.",
    ]);
  });

  it("rechaza lo que no tiene forma de comprobante", () => {
    expect(errores(null)).toEqual(["Los datos del comprobante no son válidos."]);
    expect(errores({ renglones: "x" })).toEqual(["Los datos del comprobante no son válidos."]);
  });
});

describe("parametrosGuardarComprobanteCompra", () => {
  it("tiene exactamente los parámetros de la RPC", () => {
    const a = armado();
    expect(parametrosGuardarComprobanteCompra(null, a)).toEqual({
      p_id: null,
      p_comprobante: a.comprobante,
      p_items: a.items,
      p_percepciones: a.percepciones,
    });
    expect(parametrosGuardarComprobanteCompra(COMPROBANTE, a).p_id).toBe(COMPROBANTE);
  });
});

describe("comprobanteEnviado", () => {
  it("en B y C manda los renglones sin alícuota (el editor la recuerda por si se vuelve a A)", () => {
    const editor = { ...editorComprobanteCompraNuevo("2026-11-05"), letra: "B" as const };
    editor.filas = [{ ...filaCompraVacia(), alicuotaIva: "21" }];
    expect(comprobanteEnviado(editor).renglones[0].alicuotaIva).toBe("no_gravado");
    expect(comprobanteEnviado({ ...editor, letra: "A" }).renglones[0].alicuotaIva).toBe("21");
  });

  it("un renglón exento se manda sin alícuota", () => {
    const editor = editorComprobanteCompraNuevo("2026-11-05");
    editor.filas = [{ ...filaCompraVacia(), alicuotaIva: "21", exento: true }];
    expect(comprobanteEnviado(editor).renglones[0].alicuotaIva).toBe("no_gravado");
  });

  it("no manda los datos que sólo sirven en pantalla", () => {
    const editor = editorComprobanteCompraNuevo("2026-11-05");
    const [fila] = comprobanteEnviado(editor).renglones;
    expect(fila).not.toHaveProperty("clave");
    expect(fila).not.toHaveProperty("busqueda");
  });
});

describe("editorComprobanteCompraNuevo", () => {
  it("arranca como factura A de hoy con un renglón vacío", () => {
    const editor = editorComprobanteCompraNuevo("2026-11-05");
    expect(editor).toMatchObject({
      proveedorId: "",
      tipo: "factura",
      letra: "A",
      puntoVenta: "",
      numero: "",
      fecha: "2026-11-05",
      fechaVencimiento: "",
      observaciones: "",
      percepciones: [],
    });
    expect(editor.filas).toHaveLength(1);
    expect(editor.filas[0]).toMatchObject({ modo: "articulo", cantidad: "1", alicuotaIva: "21", factor: "1" });
  });
});

describe("artículos del proveedor", () => {
  const articulo = (cambios: Partial<ProveedorArticulo>): ProveedorArticulo => ({
    id: ARTICULO,
    proveedor_id: PROVEEDOR,
    codigo: "SOGA8",
    descripcion: "SOGA PP diam 8MM",
    unidad: "rollo",
    factor_conversion: 1,
    materia_prima_id: MATERIA_PRIMA,
    activo: true,
    ...cambios,
  });
  const articulos = [
    articulo({}),
    articulo({ id: "b0000000-0000-0000-0000-000000000002", codigo: null, descripcion: "Malla negra" }),
    articulo({ id: "b0000000-0000-0000-0000-000000000003", codigo: "SOGA6", activo: false }),
  ];

  it("busca entre los activos por código o descripción, sin mayúsculas", () => {
    expect(buscarArticulos(articulos, "soga").map((a) => a.codigo)).toEqual(["SOGA8"]);
    expect(buscarArticulos(articulos, "MALLA").map((a) => a.descripcion)).toEqual(["Malla negra"]);
    expect(buscarArticulos(articulos, "  ")).toEqual([]);
  });

  it("al elegir un artículo, el renglón toma su código, descripción y unidad", () => {
    expect(cambiosAlElegirArticulo(articulo({ codigo: null, unidad: null }))).toEqual({
      articuloId: ARTICULO,
      busqueda: "",
      codigo: "",
      descripcion: "SOGA PP diam 8MM",
      unidad: "",
    });
  });
});

describe("renglonCalculable", () => {
  it("pasa la alícuota del renglón a número; no gravado es null", () => {
    expect(renglonCalculable({ ...filaCompraVacia(), alicuotaIva: "10.5" }).alicuotaIva).toBe(10.5);
    expect(renglonCalculable({ ...filaCompraVacia(), alicuotaIva: "no_gravado" }).alicuotaIva).toBeNull();
  });
});

describe("ida y vuelta: comprobante guardado → editor → lo que se guarda", () => {
  const comprobante: ComprobanteCompra = {
    id: COMPROBANTE,
    proveedor_id: PROVEEDOR,
    tipo: "nota_debito",
    letra: "A",
    punto_venta: 7,
    numero: 99,
    fecha: "2026-11-01",
    fecha_vencimiento: null,
    observaciones: null,
    neto_gravado: 0,
    no_gravado: 0,
    exento: 0,
    iva: 0,
    percepcion_iva: 0,
    percepcion_iibb: 0,
    otros_impuestos: 0,
    total: 0,
    estado: "borrador",
    confirmado_en: null,
    anulado_en: null,
    creado_por: null,
    creado_en: "2026-11-01T10:00:00Z",
    actualizado_en: "2026-11-01T10:00:00Z",
  };
  const item = (cambios: Partial<ComprobanteCompraItem>): ComprobanteCompraItem => ({
    id: "e0000000-0000-0000-0000-000000000001",
    comprobante_compra_id: COMPROBANTE,
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
    ...cambios,
  });
  const items = [
    item({ orden: 1 }),
    item({
      orden: 0,
      proveedor_articulo_id: ARTICULO,
      materia_prima_id: MATERIA_PRIMA,
      codigo_proveedor: "SOGA8",
      descripcion: "SOGA PP diam 8MM",
      unidad: "rollo",
      cantidad: 2.5,
      precio_unitario: 1000.1234,
      descuento_pct: 5.5,
      alicuota_iva: 21,
    }),
  ];
  const percepciones: ComprobanteCompraPercepcion[] = [
    {
      id: "f0000000-0000-0000-0000-000000000001",
      comprobante_compra_id: COMPROBANTE,
      tipo: "iibb",
      jurisdiccion: "Neuquén",
      descripcion: null,
      importe: 12.34,
    },
  ];

  it("carga la cabecera, los renglones en orden y las percepciones", () => {
    const editor = editorDeComprobanteCompra(comprobante, items, percepciones);
    expect(editor).toMatchObject({
      proveedorId: PROVEEDOR,
      tipo: "nota_debito",
      letra: "A",
      puntoVenta: "7",
      numero: "99",
      fecha: "2026-11-01",
      fechaVencimiento: "",
      observaciones: "",
    });
    expect(editor.filas.map((f) => f.modo)).toEqual(["articulo", "libre"]);
    expect(editor.percepciones[0]).toMatchObject({ tipo: "iibb", jurisdiccion: "Neuquén", descripcion: "", importe: "12.34" });
  });

  it("vuelve a guardar lo mismo que estaba guardado", () => {
    const editor = editorDeComprobanteCompra(comprobante, items, percepciones);
    const resultado = armarComprobanteCompra(comprobanteEnviado(editor));
    if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
    const p = parametrosGuardarComprobanteCompra(COMPROBANTE, resultado.armado);
    expect(p.p_comprobante).toEqual({
      proveedor_id: PROVEEDOR,
      tipo: "nota_debito",
      letra: "A",
      punto_venta: 7,
      numero: 99,
      fecha: "2026-11-01",
      fecha_vencimiento: null,
      observaciones: null,
    });
    expect(p.p_items).toEqual([
      {
        proveedor_articulo_id: ARTICULO,
        codigo_proveedor: "SOGA8",
        descripcion: "SOGA PP diam 8MM",
        unidad: "rollo",
        cantidad: 2.5,
        precio_unitario: 1000.1234,
        descuento_pct: 5.5,
        alicuota_iva: 21,
        exento: false,
      },
      {
        codigo_proveedor: null,
        descripcion: "Flete",
        unidad: null,
        cantidad: 1,
        precio_unitario: 100,
        descuento_pct: 0,
        alicuota_iva: null,
        exento: false,
      },
    ]);
    expect(p.p_percepciones).toEqual([{ tipo: "iibb", jurisdiccion: "Neuquén", descripcion: null, importe: 12.34 }]);
  });

  it("sin renglones guardados, el editor arranca con uno vacío", () => {
    expect(editorDeComprobanteCompra(comprobante, [], []).filas).toHaveLength(1);
  });
});

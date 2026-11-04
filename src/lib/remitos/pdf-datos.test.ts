import { describe, expect, it } from "vitest";
import { EMISOR_EJEMPLO, IDENTIDAD_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import { MOSTRAR_PRECIOS_REMITO, armarDatosPdfRemito, puedeImprimirRemito } from "./pdf-datos";
import { CLIENTE_REMITO_EJEMPLO, ITEM_REMITO_EJEMPLO, REMITO_EJEMPLO } from "./pdf-fixtures";

function armar(cambios: Partial<Parameters<typeof armarDatosPdfRemito>[0]> = {}) {
  return armarDatosPdfRemito({
    remito: REMITO_EJEMPLO,
    cliente: CLIENTE_REMITO_EJEMPLO,
    transporte: "Expreso Alto Valle",
    items: [ITEM_REMITO_EJEMPLO],
    emisor: EMISOR_EJEMPLO,
    ...cambios,
  });
}

describe("armarDatosPdfRemito", () => {
  it("titula REMITO, con la letra R, la leyenda de no válido como factura, número y fecha", () => {
    const datos = armar();
    expect(datos.titulo).toBe("REMITO");
    expect(datos.letra).toBe("R");
    expect(datos.leyenda).toBe("Documento no válido como factura");
    expect(datos.numero).toBe("R-00001-00000001");
    expect(datos.fecha).toBe("04/11/2026");
    expect(datos.nombreArchivo).toBe("Remito R-00001-00000001");
  });

  it("formatea el número con el punto de venta y el correlativo", () => {
    const datos = armar({ remito: { ...REMITO_EJEMPLO, punto_venta: 7, numero: 1234 } });
    expect(datos.numero).toBe("R-00007-00001234");
  });

  it("no lleva nada fiscal: ni CAE, ni QR, ni código de ARCA", () => {
    const datos = armar();
    const claves = Object.keys(datos);
    for (const fiscal of ["cae", "caeVencimiento", "qrUrl", "codigoArca", "homologacion"]) {
      expect(claves).not.toContain(fiscal);
    }
    expect(JSON.stringify(datos)).not.toMatch(/CAE|ARCA/);
  });

  it("toma el cliente: domicilio armado, CUIT con guiones y condición de IVA", () => {
    expect(armar().receptor).toEqual({
      razonSocial: "Frutícola del Valle S.R.L.",
      domicilio: "Av. Roca 1234, Cipolletti, Río Negro",
      cuit: "30-69876543-2",
      condicionIva: "Responsable Inscripto",
    });
  });

  it("un cliente sin CUIT ni domicilio sale con —", () => {
    const { receptor } = armar({
      cliente: { ...CLIENTE_REMITO_EJEMPLO, cuit: null, direccion: null, localidad: null, provincia: null },
    });
    expect(receptor.cuit).toBe("—");
    expect(receptor.domicilio).toBe("—");
  });

  it("lleva el transporte y el domicilio de entrega", () => {
    expect(armar().entrega).toEqual({
      transporte: "Expreso Alto Valle",
      domicilio: "Ruta 151 Km 4, Cinco Saltos, Río Negro",
    });
  });

  it("sin transporte ni domicilio de entrega, sale —", () => {
    const datos = armar({ transporte: null, remito: { ...REMITO_EJEMPLO, domicilio_entrega: "  " } });
    expect(datos.entrega).toEqual({ transporte: "—", domicilio: "—" });
  });

  it("lleva los bultos de cada ítem y el total de bultos", () => {
    const datos = armar({
      items: [ITEM_REMITO_EJEMPLO, { ...ITEM_REMITO_EJEMPLO, codigo: "LC-002", bultos: 0 }],
      remito: { ...REMITO_EJEMPLO, bultos_total: 12 },
    });
    expect(datos.items.map((i) => i.bultos)).toEqual(["12", "0"]);
    expect(datos.bultosTotal).toBe("12");
  });

  it("lleva código, artículo, observaciones y cantidad con unidad", () => {
    expect(armar().items[0]).toMatchObject({
      codigo: "LC-001",
      articulo: "Lona de cosecha reforzada 2 x 3 m",
      observaciones: "Color verde",
      cantidad: "100,00 un",
    });
  });

  it("el valor declarado es el guardado, distinto del total de los ítems", () => {
    const datos = armar();
    expect(datos.valorDeclarado).toBe("$ 1.500.000,00");
    expect(datos.precios?.total).toBe("$ 1.694.000,00");
  });

  it("lleva las observaciones del remito, vacías si no tiene", () => {
    expect(armar().observaciones).toBe("Entregar por la tarde");
    expect(armar({ remito: { ...REMITO_EJEMPLO, observaciones: null } }).observaciones).toBe("");
  });

  it("lleva el bloque de recibí conforme con firma, aclaración y fecha", () => {
    expect(armar().conforme).toEqual({ titulo: "Recibí conforme", campos: ["Firma", "Aclaración", "Fecha"] });
  });

  it("por defecto muestra los precios", () => {
    expect(MOSTRAR_PRECIOS_REMITO).toBe(true);
    expect(armar().precios).not.toBeNull();
  });

  it("con precios: ítems valorizados, IVA por alícuota y totales como la factura", () => {
    const datos = armar({ conPrecios: true });
    expect(datos.items[0]).toMatchObject({ precio: "14.000,00", importe: "1.400.000,00", alicuota: "21%" });
    expect(datos.precios).toMatchObject({
      bruto: "1.400.000,00",
      noGravado: "0,00",
      impuestos: "294.000,00",
      total: "$ 1.694.000,00",
    });
    expect(datos.precios?.ivaPorAlicuota.find((a) => a.etiqueta === "IVA 21")?.importe).toBe("294.000,00");
    expect(datos.inconsistencias).toEqual([]);
  });

  it("sin precios: los ítems no llevan importes y no hay totales; bultos y valor declarado siguen", () => {
    const datos = armar({ conPrecios: false });
    expect(datos.precios).toBeNull();
    expect(datos.items[0]).toMatchObject({
      precio: "",
      descuento: "",
      precioConDescuento: "",
      importe: "",
      alicuota: "",
      importeConIva: "",
      bultos: "12",
    });
    expect(datos.bultosTotal).toBe("12");
    expect(datos.valorDeclarado).toBe("$ 1.500.000,00");
  });

  it("marca el remito anulado", () => {
    expect(armar().anulado).toBe(false);
    expect(armar({ remito: { ...REMITO_EJEMPLO, estado: "anulado" } }).anulado).toBe(true);
  });

  it("lleva el emisor, y el nombre de fantasía y el contacto sólo si se pasan", () => {
    expect(armar().emisor).toMatchObject({ razonSocial: "EMPRESA DE EJEMPLO S.A.", cuit: "30-71234567-1", contacto: "" });
    expect(armar({ identidad: IDENTIDAD_EJEMPLO }).emisor).toMatchObject({ nombreFantasia: "SIL - FE" });
    expect(armar({ emisor: null }).emisor.razonSocial).toBe("");
  });
});

describe("puedeImprimirRemito", () => {
  it("un borrador no se imprime (no tiene número)", () => {
    expect(puedeImprimirRemito({ estado: "borrador", numero: null })).toEqual({
      ok: false,
      status: 409,
      motivo: "Un remito en borrador no se imprime: emitilo primero.",
    });
  });

  it("un emitido o anulado con número se imprime", () => {
    expect(puedeImprimirRemito({ estado: "emitido", numero: 1 })).toEqual({ ok: true });
    expect(puedeImprimirRemito({ estado: "anulado", numero: 3 })).toEqual({ ok: true });
  });

  it("un emitido sin número no se imprime", () => {
    expect(puedeImprimirRemito({ estado: "emitido", numero: null })).toMatchObject({ ok: false, status: 409 });
  });
});

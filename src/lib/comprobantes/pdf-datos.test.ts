import { describe, expect, it } from "vitest";
import { URL_QR_ARCA } from "./qr";
import {
  armarDatosPdf,
  dispositionEnLinea,
  fechaCorta,
  formatearCuit,
  formatearImporte,
  paginar,
  puedeImprimir,
} from "./pdf-datos";
import { COMPROBANTE_EJEMPLO, EMISOR_EJEMPLO, ITEM_EJEMPLO, ejemploConItems } from "./pdf-fixtures";

describe("formatos", () => {
  it("formatea importes con punto de miles y coma decimal", () => {
    expect(formatearImporte(1400000)).toBe("1.400.000,00");
    expect(formatearImporte(1400)).toBe("1.400,00");
    expect(formatearImporte(0.5)).toBe("0,50");
  });

  it("formatea el CUIT con guiones y deja como está lo que no tiene 11 dígitos", () => {
    expect(formatearCuit("30712345671")).toBe("30-71234567-1");
    expect(formatearCuit("30-71234567-1")).toBe("30-71234567-1");
    expect(formatearCuit("12345678")).toBe("12345678");
  });

  it("pasa yyyy-mm-dd a dd/mm/aaaa", () => {
    expect(fechaCorta("2026-10-16")).toBe("16/10/2026");
    expect(fechaCorta(null)).toBe("");
  });
});

describe("puedeImprimir", () => {
  const imprimible = { ...COMPROBANTE_EJEMPLO, puntoVentaElectronico: true, cuitEmisor: EMISOR_EJEMPLO.cuit };

  it("acepta un comprobante autorizado de un punto de venta electrónico, con CAE y CUIT del emisor", () => {
    expect(puedeImprimir(imprimible)).toEqual({ ok: true });
  });

  it("rechaza con 409 un comprobante que no está autorizado", () => {
    const r = puedeImprimir({ ...imprimible, estado: "borrador" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.motivo).toMatch(/autorizado/);
    }
  });

  it("rechaza un punto de venta no electrónico", () => {
    const r = puedeImprimir({ ...imprimible, puntoVentaElectronico: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/no electrónico/);
  });

  it("rechaza si falta el CAE o el CUIT del emisor", () => {
    expect(puedeImprimir({ ...imprimible, cae: null }).ok).toBe(false);
    const sinCuit = puedeImprimir({ ...imprimible, cuitEmisor: null });
    expect(sinCuit.ok).toBe(false);
    if (!sinCuit.ok) expect(sinCuit.motivo).toMatch(/CUIT/);
  });
});

describe("IVA por alícuota del PDF", () => {
  it("usa el IVA por alícuota autorizado en lugar de recalcularlo de los ítems", () => {
    // Guardado distinto de lo que da recalcular los ítems (1.400.000 al 21%): manda lo autorizado.
    const datos = armarDatosPdf({
      comprobante: {
        ...COMPROBANTE_EJEMPLO,
        neto: 1400000,
        iva: 147000,
        total: 1547000,
        iva_detalle: [{ id: 4, alicuota: 10.5, base: 1400000, importe: 147000 }],
      },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(datos.ivaPorAlicuota.find((a) => a.etiqueta === "IVA 10,5")?.importe).toBe("147.000,00");
    expect(datos.ivaPorAlicuota.find((a) => a.etiqueta === "IVA 21")?.importe).toBe("0,00");
    expect(datos.inconsistencias).toEqual([]);
  });

  it("recalcula de los ítems si el comprobante no tiene el IVA guardado (anteriores a guardarlo)", () => {
    const datos = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, iva_detalle: null },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(datos.ivaPorAlicuota.find((a) => a.etiqueta === "IVA 21")?.importe).toBe("294.000,00");
    expect(datos.inconsistencias).toEqual([]);
  });

  it("informa si el IVA por alícuota no suma el IVA guardado", () => {
    const datos = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, iva_detalle: [{ id: 5, alicuota: 21, base: 1400000, importe: 293999.99 }] },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(datos.inconsistencias).toHaveLength(1);
    expect(datos.inconsistencias[0]).toMatch(/293\.999,99.*294\.000,00/);
  });

  it("informa si el recalculado de un comprobante viejo no coincide con el IVA guardado", () => {
    const datos = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, iva: 293000, iva_detalle: null },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(datos.inconsistencias).toHaveLength(1);
  });
});

describe("armarDatosPdf", () => {
  const datos = armarDatosPdf({ comprobante: COMPROBANTE_EJEMPLO, items: [ITEM_EJEMPLO], emisor: EMISOR_EJEMPLO });

  it("arma el encabezado con la letra, el código de ARCA con 3 dígitos y los datos del emisor", () => {
    expect(datos.titulo).toBe("FACTURA DE VENTA");
    expect(datos.letra).toBe("A");
    expect(datos.codigoArca).toBe("001");
    expect(datos.numero).toBe("A-00007-00000361");
    expect(datos.fecha).toBe("16/10/2026");
    expect(datos.emisor).toEqual({
      razonSocial: "SILFE S.A.",
      domicilio: "Ruta 22 Km 1200, General Roca, Río Negro",
      condicionIva: "Responsable Inscripto",
      cuit: "30-71234567-1",
      ingresosBrutos: "30-71234567-1",
      inicioActividades: "01/03/2005",
    });
  });

  it("usa la copia del receptor guardada en el comprobante", () => {
    expect(datos.receptor).toEqual({
      razonSocial: "Frutícola del Valle S.R.L.",
      domicilio: "Av. Roca 1234, Cipolletti",
      documentoEtiqueta: "CUIT",
      documento: "30-69876543-2",
      condicionIva: "Responsable Inscripto",
    });
    expect(datos.provinciaDestino).toBe("Río Negro");
    expect(datos.moneda).toBe("Pesos Argentinos");
    expect(datos.fechaVencimientoPago).toBe("15/11/2026");
    expect(datos.formaPago).toBe("Cuenta Corriente");
  });

  it("nombra la nota de crédito y la de débito, con su código", () => {
    const nc = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, clase: "nota_credito", letra: "B", tipo_arca: 8 },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(nc.titulo).toBe("NOTA DE CRÉDITO");
    expect(nc.codigoArca).toBe("008");
    expect(nc.nombreArchivo).toBe("Nota de crédito B-00007-00000361");
    const nd = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, clase: "nota_debito", tipo_arca: 2 },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(nd.titulo).toBe("NOTA DE DÉBITO");
    expect(nd.codigoArca).toBe("002");
  });

  it("muestra el DNI y el consumidor sin identificar", () => {
    const dni = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, receptor_doc_tipo: 96, receptor_doc_nro: "28123456", condicion_pago: "contado" },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(dni.receptor.documentoEtiqueta).toBe("DNI");
    expect(dni.receptor.documento).toBe("28123456");
    expect(dni.formaPago).toBe("Contado");
    const sinId = armarDatosPdf({
      comprobante: { ...COMPROBANTE_EJEMPLO, receptor_doc_tipo: 99, receptor_doc_nro: "0" },
      items: [ITEM_EJEMPLO],
      emisor: EMISOR_EJEMPLO,
    });
    expect(sinId.receptor.documentoEtiqueta).toBe("Doc.");
    expect(sinId.receptor.documento).toBe("Sin identificar");
  });

  it("formatea los renglones", () => {
    expect(datos.items).toEqual([
      {
        codigo: "LC-001",
        articulo: "Lona de cosecha reforzada 2 x 3 m",
        observaciones: "Color verde",
        cantidad: "100,00 un",
        precio: "14.000,00",
        descuento: "0,00",
        importe: "1.400.000,00",
        alicuota: "21%",
        importeConIva: "1.694.000,00",
      },
    ]);
  });

  it("muestra el IVA de todas las alícuotas gravadas, con cero las que no tiene", () => {
    const mixto = armarDatosPdf({
      comprobante: {
        ...COMPROBANTE_EJEMPLO,
        neto: 1100,
        iva: 220.5,
        total: 1320.5,
        iva_detalle: [
          { id: 4, alicuota: 10.5, base: 100, importe: 10.5 },
          { id: 5, alicuota: 21, base: 1000, importe: 210 },
        ],
      },
      items: [
        { ...ITEM_EJEMPLO, cantidad: 1, precio_unitario: 1000, importe: 1000, iva: 210, alicuota_iva: 21 },
        { ...ITEM_EJEMPLO, cantidad: 1, precio_unitario: 100, importe: 100, iva: 10.5, alicuota_iva: 10.5 },
      ],
      emisor: EMISOR_EJEMPLO,
    });
    expect(mixto.ivaPorAlicuota).toEqual([
      { etiqueta: "IVA 2,5", importe: "0,00" },
      { etiqueta: "IVA 5", importe: "0,00" },
      { etiqueta: "IVA 10,5", importe: "10,50" },
      { etiqueta: "IVA 21", importe: "210,00" },
      { etiqueta: "IVA 27", importe: "0,00" },
    ]);
    expect(mixto.bruto).toBe("1.100,00");
    expect(mixto.impuestos).toBe("220,50");
    expect(mixto.total).toBe("$ 1.320,50");
  });

  it("arma el pie con el CAE, su vencimiento y el QR de ARCA", () => {
    expect(datos.cae).toBe("76123456789012");
    expect(datos.caeVencimiento).toBe("26/10/2026");
    expect(datos.qrUrl.startsWith(`${URL_QR_ARCA}?p=`)).toBe(true);
    const json = JSON.parse(atob(datos.qrUrl.split("?p=")[1]));
    expect(json).toMatchObject({ cuit: 30712345671, ptoVta: 7, tipoCmp: 1, nroCmp: 361, importe: 1694000, codAut: 76123456789012 });
  });

  it("marca la homologación y arma el nombre del archivo", () => {
    expect(datos.homologacion).toBe(false);
    expect(datos.nombreArchivo).toBe("Factura A-00007-00000361");
    const homo = armarDatosPdf(ejemploConItems(1, "homologacion"));
    expect(homo.homologacion).toBe(true);
  });
});

describe("paginar", () => {
  it("deja todo en una página si entra con el pie", () => {
    expect(paginar([10, 10, 10], 100, 50)).toEqual([[0, 1, 2]]);
  });

  it("corta en páginas llenas y deja en la última lo que entra con el pie", () => {
    // Página completa: 100; la última, con el pie, 25.
    const paginas = paginar(Array(12).fill(10), 100, 25);
    expect(paginas).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10, 11],
    ]);
  });

  it("pasa el último renglón a una página nueva si la última no deja lugar para el pie", () => {
    const paginas = paginar(Array(9).fill(10), 100, 50);
    expect(paginas).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [8]]);
  });

  it("agrega una última página sólo con el pie si el último renglón no entra con él", () => {
    expect(paginar([95], 100, 50)).toEqual([[0], []]);
  });

  it("sin renglones, una página vacía", () => {
    expect(paginar([], 100, 50)).toEqual([[]]);
  });
});

describe("dispositionEnLinea", () => {
  it("abre el PDF en el navegador con nombre ASCII y nombre UTF-8", () => {
    expect(dispositionEnLinea("Factura A-00007-00000361")).toBe(
      `inline; filename="Factura A-00007-00000361.pdf"; filename*=UTF-8''Factura%20A-00007-00000361.pdf`,
    );
    expect(dispositionEnLinea("Nota de crédito B-00007-00000001")).toBe(
      `inline; filename="Nota de credito B-00007-00000001.pdf"; filename*=UTF-8''Nota%20de%20cr%C3%A9dito%20B-00007-00000001.pdf`,
    );
  });
});

import { describe, expect, it } from "vitest";
import { armarDatosPdfRecibo, detalleMedio, puedeImprimirRecibo } from "./pdf-recibo-datos";
import { MEDIOS_EJEMPLO, ejemploRecibo, ejemploReciboAnulado } from "./pdf-recibo-fixtures";

describe("puedeImprimirRecibo", () => {
  it("imprime emitidos y anulados, nunca un borrador", () => {
    expect(puedeImprimirRecibo("emitido")).toEqual({ ok: true });
    expect(puedeImprimirRecibo("anulado")).toEqual({ ok: true });
    expect(puedeImprimirRecibo("borrador")).toEqual({
      ok: false,
      status: 409,
      motivo: "Un recibo en borrador no se imprime: emitilo primero.",
    });
  });
});

describe("detalleMedio", () => {
  it("efectivo no lleva detalle", () => {
    expect(detalleMedio(MEDIOS_EJEMPLO[0])).toBe("");
  });

  it("transferencia: banco o cuenta y referencia", () => {
    expect(detalleMedio(MEDIOS_EJEMPLO[1])).toBe("Banco Patagonia cta. 123-456/7 · Ref. TRF 998877");
  });

  it("cheque: banco, número, fecha de pago y librador con su CUIT", () => {
    expect(detalleMedio(MEDIOS_EJEMPLO[2])).toBe(
      "Banco Nación N° 00012345 · Pago 15/11/2026 · Librador Distribuidora Sur S.A. (CUIT 30-71111111-2)",
    );
  });

  it("e-cheq sin librador", () => {
    expect(detalleMedio(MEDIOS_EJEMPLO[3])).toBe("Banco Galicia N° E-778899 · Pago 01/12/2026");
  });

  it("retención: tipo con jurisdicción, certificado y fecha", () => {
    expect(detalleMedio(MEDIOS_EJEMPLO[4])).toBe("IIBB (Río Negro) · Certificado RN-0001-000123 · 18/10/2026");
  });
});

describe("armarDatosPdfRecibo", () => {
  it("arma encabezado, cliente, importe en letras, medios, imputaciones y lo que queda a favor", () => {
    const datos = armarDatosPdfRecibo(ejemploRecibo());
    expect(datos.numero).toBe("R-00001-00000042");
    expect(datos.fecha).toBe("18/10/2026");
    expect(datos.emisor.cuit).toBe("30-71234567-1");
    expect(datos.cliente).toEqual({
      razonSocial: "Frutícola del Valle S.R.L.",
      cuit: "30-69876543-2",
      domicilio: "Av. Roca 1234 · General Roca, Río Negro · CP 8332",
      condicionIva: "Responsable Inscripto",
    });
    expect(datos.recibimos).toBe(
      "Recibimos de Frutícola del Valle S.R.L. la suma de pesos UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL " +
        "QUINIENTOS SESENTA Y SIETE CON 89/100 ($ 1.234.567,89).",
    );
    expect(datos.medios.map((m) => m.medio)).toEqual([
      "Efectivo",
      "Transferencia / depósito",
      "Cheque",
      "E-cheq",
      "Retención",
    ]);
    expect(datos.medios[1].importe).toBe("534.567,89");
    expect(datos.imputaciones).toEqual([
      { comprobante: "Factura A-00007-00000361", fecha: "10/09/2026", importe: "600.000,00" },
      { comprobante: "Factura A-00007-00000375", fecha: "25/09/2026", importe: "400.000,00" },
    ]);
    expect(datos.total).toBe("$ 1.234.567,89");
    expect(datos.imputado).toBe("$ 1.000.000,00");
    expect(datos.aFavor).toBe("$ 234.567,89");
    expect(datos.anulado).toBeNull();
    expect(datos.observaciones).toBe("Pago de las facturas de septiembre.");
    expect(datos.nombreArchivo).toBe("Recibo R-00001-00000042");
  });

  it("sin nada a favor no muestra la línea", () => {
    const ejemplo = ejemploRecibo({ total: 1_000_000 });
    expect(armarDatosPdfRecibo(ejemplo).aFavor).toBeNull();
  });

  it("marca la aplicación automática de saldo a favor", () => {
    const ejemplo = ejemploRecibo();
    const datos = armarDatosPdfRecibo({
      ...ejemplo,
      imputaciones: [{ ...ejemplo.imputaciones[0], automatica: true }],
    });
    expect(datos.imputaciones[0].comprobante).toBe("Factura A-00007-00000361 (saldo a favor)");
  });

  it("un recibo anulado lleva la fecha (de Argentina) y el motivo", () => {
    const datos = armarDatosPdfRecibo(ejemploReciboAnulado());
    expect(datos.anulado).toEqual({ fecha: "18/10/2026", motivo: "Cargado al cliente equivocado." });
    expect(datos.imputaciones).toEqual([]);
    expect(datos.aFavor).toBeNull();
  });

  it("sin datos del emisor deja los campos vacíos en lugar de fallar", () => {
    const datos = armarDatosPdfRecibo({ ...ejemploRecibo(), emisor: null });
    expect(datos.emisor.razonSocial).toBe("");
    expect(datos.emisor.cuit).toBe("");
  });
});

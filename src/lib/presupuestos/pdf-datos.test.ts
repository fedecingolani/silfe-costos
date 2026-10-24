import { describe, expect, it } from "vitest";
import { EMISOR_EJEMPLO, ITEM_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import { armarDatosPdfPresupuesto, type ClientePdfPresupuesto, type FilaPresupuestoPdf } from "./pdf-datos";

const PRESUPUESTO: FilaPresupuestoPdf = {
  numero: 49,
  fecha: "2026-10-24",
  valido_hasta: "2026-11-08",
  fecha_vencimiento_pago: "2026-11-23",
  condicion_pago: "cuenta_corriente",
  neto: 1400000,
  no_gravado: 0,
  iva: 294000,
  total: 1694000,
};

const CLIENTE: ClientePdfPresupuesto = {
  razon_social: "Frutícola del Valle S.R.L.",
  cuit: "30698765432",
  condicion_iva: "Responsable Inscripto",
  direccion: "Av. Roca 1234",
  localidad: "Cipolletti",
  provincia: "Río Negro",
};

function armar(cambios: Partial<Parameters<typeof armarDatosPdfPresupuesto>[0]> = {}) {
  return armarDatosPdfPresupuesto({
    presupuesto: PRESUPUESTO,
    cliente: CLIENTE,
    items: [ITEM_EJEMPLO],
    emisor: EMISOR_EJEMPLO,
    ...cambios,
  });
}

describe("armarDatosPdfPresupuesto", () => {
  it("titula PRESUPUESTO, con número P-… y la validez, sin letra ni código de ARCA", () => {
    const datos = armar();
    expect(datos.titulo).toBe("PRESUPUESTO");
    expect(datos.numero).toBe("P-00000049");
    expect(datos.fecha).toBe("24/10/2026");
    expect(datos.presupuesto).toEqual({ validoHasta: "08/11/2026" });
    expect(datos.letra).toBe("");
    expect(datos.codigoArca).toBe("");
    expect(datos.nombreArchivo).toBe("Presupuesto P-00000049");
  });

  it("no lleva CAE, vencimiento del CAE, QR ni marca de homologación", () => {
    const datos = armar();
    expect(datos.cae).toBe("");
    expect(datos.caeVencimiento).toBe("");
    expect(datos.qrUrl).toBe("");
    expect(datos.homologacion).toBe(false);
    expect(datos.asociados).toEqual([]);
    expect(datos.periodoAsociado).toBeNull();
  });

  it("toma el receptor del cliente: domicilio armado, CUIT con guiones y condición de IVA", () => {
    const { receptor, provinciaDestino } = armar();
    expect(receptor).toEqual({
      razonSocial: "Frutícola del Valle S.R.L.",
      domicilio: "Av. Roca 1234, Cipolletti, Río Negro",
      documentoEtiqueta: "CUIT",
      documento: "30-69876543-2",
      condicionIva: "Responsable Inscripto",
    });
    expect(provinciaDestino).toBe("Río Negro");
  });

  it("un cliente sin CUIT sale sin identificar", () => {
    const { receptor } = armar({ cliente: { ...CLIENTE, cuit: null, direccion: null, localidad: null } });
    expect(receptor.documento).toBe("Sin identificar");
    expect(receptor.domicilio).toBe("Río Negro");
  });

  it("formatea ítems, IVA por alícuota y totales como la factura", () => {
    const datos = armar();
    expect(datos.items[0]).toMatchObject({ codigo: "LC-001", importe: "1.400.000,00", alicuota: "21%" });
    expect(datos.ivaPorAlicuota.find((a) => a.etiqueta === "IVA 21")?.importe).toBe("294.000,00");
    expect(datos.bruto).toBe("1.400.000,00");
    expect(datos.impuestos).toBe("294.000,00");
    expect(datos.total).toBe("$ 1.694.000,00");
    expect(datos.formaPago).toBe("Cuenta Corriente");
    expect(datos.fechaVencimientoPago).toBe("23/11/2026");
    expect(datos.inconsistencias).toEqual([]);
  });

  it("sale aunque no estén cargados los datos del emisor", () => {
    const datos = armar({ emisor: null });
    expect(datos.emisor.razonSocial).toBe("");
    expect(datos.emisor.cuit).toBe("");
  });
});

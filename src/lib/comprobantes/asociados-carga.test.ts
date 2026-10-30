import { describe, expect, it } from "vitest";
import { asociadosParaGuardar, datosAsociado, saldoDe, type AsociadoLeido, type ComprobanteRelacionado } from "./asociados-carga";

const FACTURA: ComprobanteRelacionado = {
  id: "f0000000-0000-0000-0000-000000000001",
  estado: "autorizado",
  clase: "factura",
  letra: "A",
  tipo_arca: 1,
  punto_venta: 7,
  numero: 361,
  fecha: "2026-10-10",
  total: 1210,
  ambiente: "produccion",
};

const interno: AsociadoLeido = {
  asociado_id: FACTURA.id,
  tipo_arca: null,
  punto_venta: null,
  numero: null,
  fecha: null,
  cuit: null,
  interno: FACTURA,
};

const manual: AsociadoLeido = {
  asociado_id: null,
  tipo_arca: 6,
  punto_venta: 7,
  numero: 150,
  fecha: "2026-01-09",
  cuit: "23334771229",
  interno: null,
};

const nota = (cambios: Partial<ComprobanteRelacionado>): ComprobanteRelacionado => ({
  ...FACTURA,
  id: "n0000000-0000-0000-0000-000000000001",
  clase: "nota_credito",
  tipo_arca: 3,
  ...cambios,
});

describe("saldoDe", () => {
  it("descuenta las notas de crédito autorizadas o en verificación, no los borradores ni las de débito", () => {
    const notas = [
      nota({ total: 100 }),
      nota({ id: "n2", total: 10, estado: "verificando" }),
      nota({ id: "n3", total: 500, estado: "borrador" }),
      nota({ id: "n4", total: 500, estado: "rechazado" }),
      nota({ id: "n5", total: 300, clase: "nota_debito" }),
    ];
    expect(saldoDe([interno], notas)).toEqual({ saldo: 1100, asociado: "A-00007-00000361" });
  });

  it("sin asociados de la base no hay control de importe", () => {
    expect(saldoDe([manual], [])).toBeNull();
    expect(saldoDe([], [])).toBeNull();
  });
});

describe("datosAsociado y asociadosParaGuardar", () => {
  it("usa los datos del comprobante de la base, o los cargados a mano", () => {
    expect(datosAsociado(interno)).toEqual({ tipo_arca: 1, letra: "A", punto_venta: 7, numero: 361, fecha: "2026-10-10" });
    expect(datosAsociado(manual)).toEqual({ tipo_arca: 6, letra: "B", punto_venta: 7, numero: 150, fecha: "2026-01-09" });
  });

  it("un X de la base no tiene código de ARCA: lleva su letra", () => {
    const facturaX: ComprobanteRelacionado = { ...FACTURA, letra: "X", tipo_arca: null, punto_venta: 9999, numero: 3, ambiente: null };
    expect(datosAsociado({ ...interno, interno: facturaX })).toEqual({
      tipo_arca: null,
      letra: "X",
      punto_venta: 9999,
      numero: 3,
      fecha: "2026-10-10",
    });
    expect(saldoDe([{ ...interno, interno: facturaX }], [])).toEqual({ saldo: 1210, asociado: "X-09999-00000003" });
  });

  it("copia los asociados para guardarlos en otro comprobante", () => {
    expect(asociadosParaGuardar([interno, manual])).toEqual([
      { asociado_id: FACTURA.id },
      { tipo_arca: 6, punto_venta: 7, numero: 150, fecha: "2026-01-09", cuit: "23334771229" },
    ]);
  });
});

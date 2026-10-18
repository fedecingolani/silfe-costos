import { describe, expect, it } from "vitest";
import { armarRecibo, leerReciboEnviado, type ReciboEnviado } from "./guardado";
import { leerFiltrosCobranzas, resumenEmision } from "./listado";
import { mensajeErrorCobranza } from "./errores";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const F1 = "22222222-2222-2222-2222-222222222221";
const F2 = "22222222-2222-2222-2222-222222222222";

const base: ReciboEnviado = {
  clienteId: CLIENTE,
  fecha: "2026-10-18",
  observaciones: null,
  contadoId: null,
  medios: [{ tipo: "efectivo", importe: 100 }],
  imputaciones: [],
};

const debitos = [
  { comprobanteId: F1, fecha: "2026-10-01", saldo: 60 },
  { comprobanteId: F2, fecha: "2026-10-02", saldo: 70 },
];

describe("leerReciboEnviado", () => {
  it("lee medios de cada tipo y descarta textos vacíos", () => {
    const leido = leerReciboEnviado({
      clienteId: CLIENTE,
      fecha: "2026-10-18",
      observaciones: "  ",
      contadoId: null,
      medios: [
        { tipo: "transferencia", importe: 10, banco: " Galicia ", referencia: "" },
        {
          tipo: "echeq",
          importe: 20,
          cheque: { banco: "Macro", numero: "E-1", fechaPago: "2026-11-01", libradorCuit: "" },
        },
        { tipo: "retencion", importe: 5, retencion: { tipo: "iibb", jurisdiccion: "Río Negro", certificado: "1", fecha: "2026-10-18" } },
      ],
      imputaciones: [{ comprobanteId: F1, importe: 10 }],
    });
    expect(leido?.observaciones).toBeNull();
    expect(leido?.medios[0]).toMatchObject({ tipo: "transferencia", banco: "Galicia", referencia: null, cheque: null });
    expect(leido?.medios[1].cheque).toMatchObject({ banco: "Macro", numero: "E-1", libradorCuit: null });
    expect(leido?.medios[2].retencion).toMatchObject({ tipo: "iibb", jurisdiccion: "Río Negro" });
  });

  it("rechaza una forma inesperada o un tipo de medio desconocido", () => {
    expect(leerReciboEnviado(null)).toBeNull();
    expect(leerReciboEnviado({ medios: [], imputaciones: "x" })).toBeNull();
    expect(leerReciboEnviado({ medios: [{ tipo: "bitcoin", importe: 1 }], imputaciones: [] })).toBeNull();
  });

  it("un importe que no es número queda inválido (NaN)", () => {
    const leido = leerReciboEnviado({ ...base, medios: [{ tipo: "efectivo", importe: "100" }] });
    expect(Number.isNaN(leido?.medios[0].importe)).toBe(true);
  });
});

describe("armarRecibo", () => {
  it("una cobranza imputa lo elegido y deja el resto a favor", () => {
    const r = armarRecibo(
      { ...base, imputaciones: [{ comprobanteId: F1, importe: 60 }, { comprobanteId: F2, importe: 0 }] },
      { debitos, contado: null },
    );
    expect(r).toEqual({
      guardar: expect.objectContaining({
        total: 100,
        imputaciones: [{ comprobante_id: F1, importe: 60 }],
        recibo: { cliente_id: CLIENTE, fecha: "2026-10-18", observaciones: null, comprobante_contado_id: null },
      }),
    });
  });

  it("no imputa más que el saldo ni más que el total", () => {
    const r = armarRecibo({ ...base, imputaciones: [{ comprobanteId: F2, importe: 71 }] }, { debitos, contado: null });
    expect("errores" in r && r.errores.join(" ")).toMatch(/supera su saldo pendiente/);
    const r2 = armarRecibo(
      { ...base, imputaciones: [{ comprobanteId: F1, importe: 60 }, { comprobanteId: F2, importe: 50 }] },
      { debitos, contado: null },
    );
    expect("errores" in r2 && r2.errores.join(" ")).toMatch(/supera el total del recibo/);
  });

  it("valida medios y cabecera", () => {
    const r = armarRecibo(
      { ...base, clienteId: null, medios: [{ tipo: "cheque", importe: 10, cheque: { banco: "", numero: "", fechaPago: "" } }] },
      { debitos: [], contado: null },
    );
    expect("errores" in r && r.errores).toEqual(
      expect.arrayContaining(["Elegí el cliente.", "Medio 1: completá el banco del cheque."]),
    );
  });

  it("el pago de contado lleva una única imputación por el total, ignorando las enviadas", () => {
    const contado = { id: F1, total: 100, condicionPago: "contado" as const };
    const r = armarRecibo(
      { ...base, contadoId: F1, imputaciones: [{ comprobanteId: F2, importe: 5 }] },
      { debitos: [], contado },
    );
    expect("guardar" in r && r.guardar.imputaciones).toEqual([{ comprobante_id: F1, importe: 100 }]);
    expect("guardar" in r && r.guardar.recibo.comprobante_contado_id).toBe(F1);
  });

  it("el pago de contado exige el total exacto", () => {
    const contado = { id: F1, total: 120, condicionPago: "contado" as const };
    const r = armarRecibo({ ...base, contadoId: F1 }, { debitos: [], contado });
    expect("errores" in r && r.errores.join(" ")).toMatch(/total exacto/);
  });

  it("un contadoId sin comprobante de contado es un error", () => {
    const r = armarRecibo({ ...base, contadoId: F1 }, { debitos, contado: null });
    expect("errores" in r && r.errores).toContain("No se encontró el comprobante de contado.");
  });

  it("normaliza cheques y retenciones para la base", () => {
    const r = armarRecibo(
      {
        ...base,
        medios: [
          {
            tipo: "cheque",
            importe: 60,
            cheque: { banco: "Nación", numero: "123", fechaPago: "2026-11-01", libradorCuit: "20-12345678-9" },
          },
          { tipo: "retencion", importe: 40, retencion: { tipo: "ganancias", jurisdiccion: "X", certificado: "C1", fecha: "2026-10-18" } },
        ],
      },
      { debitos, contado: null },
    );
    expect("guardar" in r && r.guardar.medios).toEqual([
      expect.objectContaining({
        tipo: "cheque",
        cheque: expect.objectContaining({ librador_cuit: "20123456789", fecha_emision: null }),
        retencion_tipo: null,
      }),
      expect.objectContaining({
        tipo: "retencion",
        cheque: null,
        retencion_tipo: "ganancias",
        retencion_jurisdiccion: null,
        certificado: "C1",
      }),
    ]);
  });
});

describe("listado de cobranzas", () => {
  it("lee los filtros e ignora valores desconocidos", () => {
    expect(leerFiltrosCobranzas({ desde: "2026-10-01", hasta: "x", cliente: [" acme "], estado: "emitido" })).toEqual({
      desde: "2026-10-01",
      hasta: "",
      cliente: "acme",
      estado: "emitido",
    });
    expect(leerFiltrosCobranzas({ estado: "otro" }).estado).toBe("");
  });

  it("arma el resumen de la emisión", () => {
    expect(resumenEmision("$ 100,00", "ACME")).toBe(
      "Se va a emitir el recibo por $ 100,00 a ACME. No se puede modificar después.",
    );
  });
});

describe("mensajeErrorCobranza", () => {
  it("usa el mensaje de la base cuando dice el detalle", () => {
    expect(mensajeErrorCobranza({ code: "CB006", message: "La imputación supera el saldo pendiente ($ 30)." })).toBe(
      "La imputación supera el saldo pendiente ($ 30).",
    );
  });

  it("traduce los demás", () => {
    expect(mensajeErrorCobranza({ code: "CB001", message: "x" })).toMatch(/ya no es un borrador/);
    expect(mensajeErrorCobranza({ code: "XX000", message: "boom" }, "emitir el recibo")).toBe(
      "No se pudo emitir el recibo: boom",
    );
  });
});

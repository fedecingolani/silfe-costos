import { describe, expect, it } from "vitest";
import {
  completarEnOrden,
  pagoContado,
  saldoAFavor,
  validarImputaciones,
  type DebitoPendiente,
} from "./imputacion";

const F1: DebitoPendiente = { comprobanteId: "f1", fecha: "2026-10-01", saldo: 60 };
const F2: DebitoPendiente = { comprobanteId: "f2", fecha: "2026-10-02", saldo: 70 };
const DEBITOS = [F1, F2];

describe("validarImputaciones", () => {
  it("acepta 60 + 40 sobre un recibo de 100", () => {
    const elegidas = [
      { comprobanteId: "f1", importe: 60 },
      { comprobanteId: "f2", importe: 40 },
    ];
    expect(validarImputaciones(DEBITOS, elegidas, 100)).toEqual([]);
    expect(saldoAFavor(100, elegidas)).toBe(0);
  });

  it("no supera el saldo de cada débito", () => {
    expect(validarImputaciones(DEBITOS, [{ comprobanteId: "f1", importe: 60.01 }], 100)).toEqual([
      "La imputación a un comprobante supera su saldo pendiente ($ 60,00).",
    ]);
  });

  it("no supera el total del recibo", () => {
    expect(
      validarImputaciones(
        DEBITOS,
        [
          { comprobanteId: "f1", importe: 60 },
          { comprobanteId: "f2", importe: 50 },
        ],
        100,
      ),
    ).toEqual(["Lo imputado ($ 110,00) supera el total del recibo ($ 100,00)."]);
  });

  it("rechaza negativos, duplicados y comprobantes que no están pendientes", () => {
    expect(
      validarImputaciones(
        DEBITOS,
        [
          { comprobanteId: "f1", importe: -1 },
          { comprobanteId: "f2", importe: 10 },
          { comprobanteId: "f2", importe: 5 },
          { comprobanteId: "f9", importe: 5 },
        ],
        100,
      ),
    ).toEqual([
      "Un importe imputado no puede ser negativo.",
      "Cada comprobante se imputa una sola vez.",
      "Uno de los comprobantes no tiene saldo pendiente.",
    ]);
  });

  it("ignora los importes en cero", () => {
    expect(validarImputaciones(DEBITOS, [{ comprobanteId: "f9", importe: 0 }], 100)).toEqual([]);
  });
});

describe("saldoAFavor", () => {
  it("es lo no imputado del recibo", () => {
    expect(saldoAFavor(100.3, [{ comprobanteId: "f1", importe: 60.1 }])).toBe(40.2);
    expect(saldoAFavor(80, [])).toBe(80);
  });
});

describe("completarEnOrden", () => {
  it("llena de la más vieja a la más nueva hasta agotar el total", () => {
    expect(completarEnOrden([F2, F1], 100)).toEqual([
      { comprobanteId: "f1", importe: 60 },
      { comprobanteId: "f2", importe: 40 },
    ]);
  });

  it("si sobra, cubre todo y el resto queda a favor", () => {
    const elegidas = completarEnOrden(DEBITOS, 150);
    expect(elegidas).toEqual([
      { comprobanteId: "f1", importe: 60 },
      { comprobanteId: "f2", importe: 70 },
    ]);
    expect(saldoAFavor(150, elegidas)).toBe(20);
  });

  it("no imputa con total cero y salta débitos sin saldo", () => {
    expect(completarEnOrden(DEBITOS, 0)).toEqual([]);
    expect(completarEnOrden([{ ...F1, saldo: 0 }, F2], 10)).toEqual([{ comprobanteId: "f2", importe: 10 }]);
  });
});

describe("pagoContado", () => {
  const FC = { id: "fc", total: 1210.5, condicionPago: "contado" as const };

  it("exige que los medios sumen exactamente el total", () => {
    expect(pagoContado(FC, [{ importe: 1000 }, { importe: 210.5 }])).toEqual({
      imputacion: { comprobanteId: "fc", importe: 1210.5 },
    });
    expect(pagoContado(FC, [{ importe: 1000 }])).toEqual({
      error: "El pago de contado es por el total exacto ($ 1.210,50); los medios suman $ 1.000,00.",
    });
  });

  it("sólo para comprobantes de contado", () => {
    expect(pagoContado({ ...FC, condicionPago: "cuenta_corriente" }, [{ importe: 1210.5 }])).toEqual({
      error: "El comprobante es de cuenta corriente: se cobra con una cobranza.",
    });
  });
});

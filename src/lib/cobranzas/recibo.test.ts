import { describe, expect, it } from "vitest";
import { formatearNumeroRecibo, totalRecibo, validarRecibo, type MedioBorrador, type ReciboBorrador } from "./recibo";

const CLIENTE = "c0000000-0000-0000-0000-000000000001";

const efectivo = (importe: number): MedioBorrador => ({ tipo: "efectivo", importe });

const cheque = (extra: Partial<NonNullable<MedioBorrador["cheque"]>> = {}): MedioBorrador => ({
  tipo: "cheque",
  importe: 1500,
  cheque: { banco: "Galicia", numero: "0001", fechaPago: "2026-11-01", ...extra },
});

const retencion = (extra: Partial<NonNullable<MedioBorrador["retencion"]>> = {}): MedioBorrador => ({
  tipo: "retencion",
  importe: 120,
  retencion: { tipo: "ganancias", certificado: "C-1", fecha: "2026-10-15", ...extra },
});

const recibo = (medios: MedioBorrador[], extra: Partial<ReciboBorrador> = {}): ReciboBorrador => ({
  clienteId: CLIENTE,
  fecha: "2026-10-17",
  medios,
  ...extra,
});

describe("validarRecibo", () => {
  it("acepta un recibo completo con varios medios", () => {
    expect(
      validarRecibo(
        recibo([
          efectivo(100),
          { tipo: "transferencia", importe: 200, banco: "Nación", referencia: "TR-1" },
          cheque(),
          { ...cheque(), tipo: "echeq" },
          retencion(),
          retencion({ tipo: "iibb", jurisdiccion: "Río Negro" }),
        ]),
      ),
    ).toEqual([]);
  });

  it("exige cliente, fecha y al menos un medio", () => {
    expect(validarRecibo(recibo([], { clienteId: null, fecha: "" }))).toEqual([
      "Elegí el cliente.",
      "Completá la fecha.",
      "Cargá al menos un medio de pago.",
    ]);
  });

  it("exige importes positivos", () => {
    expect(validarRecibo(recibo([efectivo(0), efectivo(-5), efectivo(Number.NaN)]))).toEqual([
      "Medio 1: el importe tiene que ser mayor a cero.",
      "Medio 2: el importe tiene que ser mayor a cero.",
      "Medio 3: el importe tiene que ser mayor a cero.",
    ]);
  });

  it("exige los datos del cheque", () => {
    expect(validarRecibo(recibo([cheque({ banco: " ", numero: "", fechaPago: "" })]))).toEqual([
      "Medio 1: completá el banco del cheque.",
      "Medio 1: completá el número del cheque.",
      "Medio 1: completá la fecha de pago del cheque.",
    ]);
    expect(validarRecibo(recibo([{ tipo: "echeq", importe: 10 }]))).toEqual([
      "Medio 1: completá el banco del cheque.",
      "Medio 1: completá el número del cheque.",
      "Medio 1: completá la fecha de pago del cheque.",
    ]);
  });

  it("valida la CUIT del librador si se carga", () => {
    expect(validarRecibo(recibo([cheque({ libradorCuit: "30-71234567-1" })]))).toEqual([]);
    expect(validarRecibo(recibo([cheque({ libradorCuit: "123" })]))).toEqual([
      "Medio 1: la CUIT del librador tiene 11 dígitos.",
    ]);
  });

  it("exige tipo, certificado, fecha y, en IIBB, jurisdicción de la retención", () => {
    expect(
      validarRecibo(recibo([retencion({ tipo: null, certificado: "", fecha: "" }), retencion({ tipo: "iibb" })])),
    ).toEqual([
      "Medio 1: elegí el tipo de retención.",
      "Medio 1: completá el número de certificado.",
      "Medio 1: completá la fecha de la retención.",
      "Medio 2: una retención de IIBB necesita la jurisdicción.",
    ]);
  });
});

describe("totalRecibo", () => {
  it("suma en centavos, sin errores de coma flotante", () => {
    expect(totalRecibo([efectivo(0.1), efectivo(0.2)])).toBe(0.3);
    expect(totalRecibo([efectivo(1234.56), efectivo(0.44), cheque()])).toBe(2735);
    expect(totalRecibo([])).toBe(0);
  });
});

describe("formatearNumeroRecibo", () => {
  it("formatea R-00001-00000001", () => {
    expect(formatearNumeroRecibo(1, 1)).toBe("R-00001-00000001");
    expect(formatearNumeroRecibo(12, 345)).toBe("R-00012-00000345");
  });
});

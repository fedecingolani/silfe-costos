import { describe, expect, it } from "vitest";
import { cuentaDeTransferencia, gruposCuentasDestino, validarTransferencia, type EntradaTransferencia } from "./transferencias";

const ORIGEN = "00000000-0000-4000-8000-000000000001";
const DESTINO = "00000000-0000-4000-8000-000000000002";

const TRANSFERENCIA: EntradaTransferencia = {
  fecha: "2026-11-10",
  cuenta_destino_id: DESTINO,
  importe: "150.000",
  concepto: " Depósito de efectivo ",
  observacion: " ",
};

describe("validarTransferencia", () => {
  it("normaliza una transferencia válida", () => {
    expect(validarTransferencia(ORIGEN, TRANSFERENCIA)).toEqual({
      datos: {
        fecha: "2026-11-10",
        cuenta_origen_id: ORIGEN,
        cuenta_destino_id: DESTINO,
        importe: 150000,
        concepto: "Depósito de efectivo",
        observacion: null,
      },
    });
  });

  it("el concepto es opcional", () => {
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, concepto: "" })).toMatchObject({ datos: { concepto: null } });
  });

  it("exige la cuenta destino, distinta del origen", () => {
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, cuenta_destino_id: "" })).toEqual({
      error: "Elegí la cuenta destino.",
    });
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, cuenta_destino_id: "x" })).toEqual({
      error: "Elegí la cuenta destino.",
    });
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, cuenta_destino_id: ORIGEN })).toEqual({
      error: "La cuenta destino tiene que ser distinta de la de origen.",
    });
  });

  it("exige un importe mayor que cero, con hasta 2 decimales", () => {
    const mensaje = { error: "El importe tiene que ser mayor que cero." };
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, importe: "0" })).toEqual(mensaje);
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, importe: "-5" })).toEqual(mensaje);
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, importe: "abc" })).toEqual(mensaje);
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, importe: "10,005" })).toEqual({
      error: "El importe admite hasta 2 decimales.",
    });
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, importe: "1000000000000" })).toEqual({
      error: "El importe no puede superar $ 999.999.999.999,99.",
    });
  });

  it("exige una fecha válida", () => {
    expect(validarTransferencia(ORIGEN, { ...TRANSFERENCIA, fecha: "2026-02-30" })).toEqual({
      error: "La fecha no es válida.",
    });
  });
});

describe("gruposCuentasDestino", () => {
  it("separa bancos y cajas, sin la cuenta origen ni grupos vacíos", () => {
    const cuentas = [
      { id: ORIGEN, tipo: "caja" as const, nombre: "Caja chica" },
      { id: DESTINO, tipo: "banco" as const, nombre: "Galicia" },
      { id: "c", tipo: "banco" as const, nombre: "Nación" },
    ];
    expect(gruposCuentasDestino(cuentas, ORIGEN)).toEqual([
      { etiqueta: "Bancos", cuentas: [cuentas[1], cuentas[2]] },
    ]);
    expect(gruposCuentasDestino(cuentas, "c")).toEqual([
      { etiqueta: "Bancos", cuentas: [cuentas[1]] },
      { etiqueta: "Cajas", cuentas: [cuentas[0]] },
    ]);
  });
});

describe("cuentaDeTransferencia", () => {
  const transferencia = {
    cuenta_origen_id: ORIGEN,
    cuenta_destino_id: DESTINO,
    origen: { tipo: "caja" as const },
    destino: { tipo: "banco" as const },
  };

  it("desde el origen, la otra cuenta es el destino", () => {
    expect(cuentaDeTransferencia(transferencia, ORIGEN)).toBe(`/bancos/${DESTINO}`);
  });

  it("desde el destino, la otra cuenta es el origen", () => {
    expect(cuentaDeTransferencia(transferencia, DESTINO)).toBe(`/caja/${ORIGEN}`);
  });

  it("sin datos de la otra cuenta no hay enlace", () => {
    expect(cuentaDeTransferencia({ ...transferencia, destino: null }, ORIGEN)).toBeNull();
  });
});

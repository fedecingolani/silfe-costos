import { describe, expect, it } from "vitest";
import { validarCuenta, type EntradaCuenta } from "./cuentas";

const BANCO: EntradaCuenta = {
  nombre: " Galicia cuenta corriente ",
  banco: "Banco Galicia",
  numero_cuenta: "123-456/7",
  cbu: "0070 0000 0000 0000 0000 01",
  alias: "charoli.galicia",
  observacion: "",
  activa: true,
};

describe("validarCuenta", () => {
  it("normaliza una cuenta bancaria", () => {
    expect(validarCuenta("banco", BANCO)).toEqual({
      datos: {
        tipo: "banco",
        nombre: "Galicia cuenta corriente",
        banco: "Banco Galicia",
        numero_cuenta: "123-456/7",
        cbu: "0070000000000000000001",
        alias: "charoli.galicia",
        observacion: null,
        activa: true,
      },
    });
  });

  it("exige el nombre", () => {
    expect(validarCuenta("banco", { ...BANCO, nombre: "   " })).toEqual({ error: "El nombre de la cuenta es obligatorio." });
    expect(validarCuenta("caja", { ...BANCO, nombre: null })).toEqual({ error: "El nombre de la cuenta es obligatorio." });
  });

  it("exige que el CBU tenga 22 dígitos", () => {
    expect(validarCuenta("banco", { ...BANCO, cbu: "123" })).toEqual({ error: "El CBU tiene que tener 22 dígitos." });
    expect(validarCuenta("banco", { ...BANCO, cbu: "007000000000000000000A" })).toEqual({
      error: "El CBU tiene que tener 22 dígitos.",
    });
  });

  it("acepta una cuenta bancaria sin datos bancarios", () => {
    const r = validarCuenta("banco", { ...BANCO, banco: "", numero_cuenta: null, cbu: " ", alias: "" });
    expect(r).toMatchObject({ datos: { banco: null, numero_cuenta: null, cbu: null, alias: null } });
  });

  it("valida el alias", () => {
    expect(validarCuenta("banco", { ...BANCO, alias: "corto" })).toEqual({
      error: "El alias tiene que tener de 6 a 20 caracteres: letras, números, puntos o guiones.",
    });
  });

  it("una caja no guarda datos bancarios", () => {
    expect(validarCuenta("caja", { ...BANCO, nombre: "Caja chica", cbu: "123", activa: false })).toEqual({
      datos: {
        tipo: "caja",
        nombre: "Caja chica",
        banco: null,
        numero_cuenta: null,
        cbu: null,
        alias: null,
        observacion: null,
        activa: false,
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { parsearImporte, validarAjuste, type EntradaAjuste } from "./ajustes";

const AJUSTE: EntradaAjuste = {
  fecha: "2026-11-10",
  tipo: "ingreso",
  importe: "1.500,25",
  concepto: " Saldo inicial ",
  observacion: " ",
};

describe("parsearImporte", () => {
  it("acepta coma o punto decimal y separador de miles", () => {
    expect(parsearImporte("1500.25")).toBe(1500.25);
    expect(parsearImporte("1500,25")).toBe(1500.25);
    expect(parsearImporte("1.500,25")).toBe(1500.25);
    expect(parsearImporte("$ 10")).toBe(10);
  });

  it("sin coma, los puntos en grupos de tres son de miles", () => {
    expect(parsearImporte("150.000")).toBe(150000);
    expect(parsearImporte("1.500")).toBe(1500);
    expect(parsearImporte("1.234.567")).toBe(1234567);
    expect(parsearImporte("1500.5")).toBe(1500.5);
  });

  it("devuelve null si no es un número", () => {
    expect(parsearImporte("")).toBeNull();
    expect(parsearImporte("abc")).toBeNull();
  });
});

describe("validarAjuste", () => {
  it("normaliza un ajuste válido", () => {
    expect(validarAjuste(AJUSTE)).toEqual({
      datos: { fecha: "2026-11-10", tipo: "ingreso", importe: 1500.25, concepto: "Saldo inicial", observacion: null },
    });
  });

  it("exige un importe mayor que cero, con hasta 2 decimales", () => {
    const mensaje = { error: "El importe tiene que ser mayor que cero." };
    expect(validarAjuste({ ...AJUSTE, importe: "0" })).toEqual(mensaje);
    expect(validarAjuste({ ...AJUSTE, importe: "-5" })).toEqual(mensaje);
    expect(validarAjuste({ ...AJUSTE, importe: "" })).toEqual(mensaje);
    expect(validarAjuste({ ...AJUSTE, importe: "10,005" })).toEqual({
      error: "El importe admite hasta 2 decimales.",
    });
    expect(validarAjuste({ ...AJUSTE, importe: "1000000000000" })).toEqual({
      error: "El importe no puede superar $ 999.999.999.999,99.",
    });
  });

  it("exige el concepto", () => {
    expect(validarAjuste({ ...AJUSTE, concepto: "  " })).toEqual({ error: "El concepto es obligatorio." });
  });

  it("exige una fecha válida", () => {
    expect(validarAjuste({ ...AJUSTE, fecha: "" })).toEqual({ error: "La fecha no es válida." });
    expect(validarAjuste({ ...AJUSTE, fecha: "2026-02-30" })).toEqual({ error: "La fecha no es válida." });
  });

  it("exige ingreso o egreso", () => {
    expect(validarAjuste({ ...AJUSTE, tipo: "otro" })).toEqual({ error: "El ajuste tiene que ser un ingreso o un egreso." });
    expect(validarAjuste({ ...AJUSTE, tipo: "egreso" })).toMatchObject({ datos: { tipo: "egreso" } });
  });
});

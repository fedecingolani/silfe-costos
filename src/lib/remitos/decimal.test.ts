import { describe, expect, it } from "vitest";
import { desescalar, escalarDecimal } from "./decimal";

describe("escalarDecimal", () => {
  it("pasa un texto decimal a entero escalado, sin coma flotante", () => {
    expect(escalarDecimal("100.25", 4)).toBe(1002500n);
    expect(escalarDecimal("0,5", 4)).toBe(5000n);
    expect(escalarDecimal(" 3 ", 2)).toBe(300n);
    expect(escalarDecimal("0.0001", 4)).toBe(1n);
    expect(escalarDecimal(".5", 2)).toBe(50n);
  });

  it("acepta números (como llegan de Postgres)", () => {
    expect(escalarDecimal(200.25, 4)).toBe(2002500n);
    expect(escalarDecimal(0.1 + 0.2, 2)).toBe(30n);
  });

  it("con más decimales que la escala redondea mitad hacia arriba, o devuelve null si se pide exacto", () => {
    expect(escalarDecimal("10.005", 2)).toBe(1001n);
    expect(escalarDecimal("10.004", 2)).toBe(1000n);
    expect(escalarDecimal("1.00005", 4, { exacto: true })).toBeNull();
    expect(escalarDecimal("1.50000", 4, { exacto: true })).toBe(15000n);
  });

  it("negativos y vacíos", () => {
    expect(escalarDecimal("-2.5", 2)).toBe(-250n);
    expect(escalarDecimal("-10.005", 2)).toBe(-1001n);
    expect(escalarDecimal("", 2)).toBeNull();
    expect(escalarDecimal("1.2.3", 2)).toBeNull();
    expect(escalarDecimal("abc", 2)).toBeNull();
    expect(escalarDecimal(Number.NaN, 2)).toBeNull();
  });
});

describe("desescalar", () => {
  it("vuelve al número", () => {
    expect(desescalar(1002500n, 4)).toBe(100.25);
    expect(desescalar(-250n, 2)).toBe(-2.5);
    expect(desescalar(0n, 4)).toBe(0);
  });
});

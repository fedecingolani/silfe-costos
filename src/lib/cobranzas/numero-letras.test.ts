import { describe, expect, it } from "vitest";
import { numeroEnLetras } from "./numero-letras";

describe("numeroEnLetras", () => {
  it.each([
    [0, "CERO CON 00/100"],
    [1, "UNO CON 00/100"],
    [2, "DOS CON 00/100"],
    [10, "DIEZ CON 00/100"],
    [15, "QUINCE CON 00/100"],
    [16, "DIECISÉIS CON 00/100"],
    [21, "VEINTIUNO CON 00/100"],
    [22, "VEINTIDÓS CON 00/100"],
    [23, "VEINTITRÉS CON 00/100"],
    [26, "VEINTISÉIS CON 00/100"],
    [30, "TREINTA CON 00/100"],
    [31, "TREINTA Y UNO CON 00/100"],
    [99, "NOVENTA Y NUEVE CON 00/100"],
    [100, "CIEN CON 00/100"],
    [101, "CIENTO UNO CON 00/100"],
    [115, "CIENTO QUINCE CON 00/100"],
    [500, "QUINIENTOS CON 00/100"],
    [700, "SETECIENTOS CON 00/100"],
    [900, "NOVECIENTOS CON 00/100"],
    [999, "NOVECIENTOS NOVENTA Y NUEVE CON 00/100"],
  ])("unidades, decenas y centenas: %d", (valor, texto) => {
    expect(numeroEnLetras(valor)).toBe(texto);
  });

  it.each([
    [1000, "MIL CON 00/100"],
    [1001, "MIL UNO CON 00/100"],
    [2000, "DOS MIL CON 00/100"],
    [21000, "VEINTIÚN MIL CON 00/100"],
    [31000, "TREINTA Y UN MIL CON 00/100"],
    [100000, "CIEN MIL CON 00/100"],
    [101000, "CIENTO UN MIL CON 00/100"],
    [121121, "CIENTO VEINTIÚN MIL CIENTO VEINTIUNO CON 00/100"],
    [999999, "NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE CON 00/100"],
  ])("miles: %d", (valor, texto) => {
    expect(numeroEnLetras(valor)).toBe(texto);
  });

  it.each([
    [1_000_000, "UN MILLÓN CON 00/100"],
    [1_000_001, "UN MILLÓN UNO CON 00/100"],
    [1_001_001, "UN MILLÓN MIL UNO CON 00/100"],
    [2_000_000, "DOS MILLONES CON 00/100"],
    [21_000_000, "VEINTIÚN MILLONES CON 00/100"],
    [100_000_000, "CIEN MILLONES CON 00/100"],
    [1_000_000_000, "MIL MILLONES CON 00/100"],
    [21_500_000_000, "VEINTIÚN MIL QUINIENTOS MILLONES CON 00/100"],
  ])("millones: %d", (valor, texto) => {
    expect(numeroEnLetras(valor)).toBe(texto);
  });

  it("lleva los centavos como fracción de 100", () => {
    expect(numeroEnLetras(123456.78)).toBe("CIENTO VEINTITRÉS MIL CUATROCIENTOS CINCUENTA Y SEIS CON 78/100");
    expect(numeroEnLetras(0.99)).toBe("CERO CON 99/100");
    expect(numeroEnLetras(1.01)).toBe("UNO CON 01/100");
    expect(numeroEnLetras(2_500_000.5)).toBe("DOS MILLONES QUINIENTOS MIL CON 50/100");
    expect(numeroEnLetras(21_000_000.05)).toBe("VEINTIÚN MILLONES CON 05/100");
  });

  it("redondea a centavos sin arrastrar errores de coma flotante", () => {
    expect(numeroEnLetras(0.1 + 0.2)).toBe("CERO CON 30/100");
    expect(numeroEnLetras(1210.499999999)).toBe("MIL DOSCIENTOS DIEZ CON 50/100");
  });

  it("rechaza negativos, no finitos y montos de un billón o más", () => {
    expect(() => numeroEnLetras(-1)).toThrow(RangeError);
    expect(() => numeroEnLetras(Number.NaN)).toThrow(RangeError);
    expect(() => numeroEnLetras(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => numeroEnLetras(1_000_000_000_000)).toThrow(RangeError);
    expect(numeroEnLetras(999_999_999_999.99)).toBe(
      "NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE CON 99/100",
    );
  });
});

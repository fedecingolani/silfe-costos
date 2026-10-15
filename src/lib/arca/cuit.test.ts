import { describe, expect, it } from "vitest";
import { esCuitValida, normalizarCuit } from "./cuit";

describe("normalizarCuit", () => {
  it("saca guiones y espacios", () => {
    expect(normalizarCuit("23-33477122-9")).toBe("23334771229");
    expect(normalizarCuit(" 23 33477122 9 ")).toBe("23334771229");
  });

  it("deja igual una CUIT ya limpia", () => {
    expect(normalizarCuit("23334771229")).toBe("23334771229");
  });
});

describe("esCuitValida", () => {
  it("acepta una CUIT con el dígito verificador correcto", () => {
    expect(esCuitValida("23334771229")).toBe(true);
    expect(esCuitValida("23-33477122-9")).toBe(true);
  });

  it("rechaza un dígito verificador incorrecto", () => {
    expect(esCuitValida("23334771228")).toBe(false);
  });

  it("rechaza largos distintos de 11 dígitos o letras", () => {
    expect(esCuitValida("2333477122")).toBe(false);
    expect(esCuitValida("233347712290")).toBe(false);
    expect(esCuitValida("2333477122A")).toBe(false);
    expect(esCuitValida("")).toBe(false);
  });
});

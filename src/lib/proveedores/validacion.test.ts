import { describe, expect, it } from "vitest";
import { esAliasValido, normalizarCbu, parsearFactor, validarArticulo, validarDatosFiscales } from "./validacion";

describe("normalizarCbu", () => {
  it("quita los espacios", () => {
    expect(normalizarCbu(" 0110 5995 2000 0001 2345 67 ")).toBe("0110599520000001234567");
  });

  it("vacío es null", () => {
    expect(normalizarCbu("   ")).toBeNull();
    expect(normalizarCbu(null)).toBeNull();
  });
});

describe("esAliasValido", () => {
  it("acepta letras, números, puntos y guiones de 6 a 20 caracteres", () => {
    expect(esAliasValido("SOGAS.ANDINAS-1")).toBe(true);
    expect(esAliasValido("abc123")).toBe(true);
  });

  it("rechaza los muy cortos, los muy largos y los caracteres raros", () => {
    expect(esAliasValido("corto")).toBe(false);
    expect(esAliasValido("a".repeat(21))).toBe(false);
    expect(esAliasValido("sogas andinas")).toBe(false);
    expect(esAliasValido("sogas_andinas")).toBe(false);
  });
});

describe("validarDatosFiscales", () => {
  const vacio = { condicion_iva: null, domicilio: null, cbu: null, alias: null };

  it("todo vacío es válido y queda en null", () => {
    expect(validarDatosFiscales({ ...vacio, domicilio: "  " })).toEqual({ datos: vacio });
  });

  it("normaliza CBU, alias y domicilio", () => {
    expect(
      validarDatosFiscales({
        condicion_iva: "Monotributista",
        domicilio: " Ruta 40 km 3 ",
        cbu: "0110 5995 2000 0001 2345 67",
        alias: " sogas.andinas ",
      }),
    ).toEqual({
      datos: {
        condicion_iva: "Monotributista",
        domicilio: "Ruta 40 km 3",
        cbu: "0110599520000001234567",
        alias: "sogas.andinas",
      },
    });
  });

  it("rechaza una condición frente al IVA desconocida", () => {
    expect(validarDatosFiscales({ ...vacio, condicion_iva: "Inscripto" })).toEqual({
      error: "La condición frente al IVA no es válida.",
    });
  });

  it("rechaza un CBU que no tiene 22 dígitos", () => {
    expect(validarDatosFiscales({ ...vacio, cbu: "12345" })).toEqual({
      error: "El CBU tiene que tener 22 dígitos.",
    });
    expect(validarDatosFiscales({ ...vacio, cbu: "011059952000000123456A" })).toEqual({
      error: "El CBU tiene que tener 22 dígitos.",
    });
  });

  it("rechaza un alias inválido", () => {
    expect(validarDatosFiscales({ ...vacio, alias: "mal alias" })).toEqual({
      error: "El alias tiene que tener de 6 a 20 caracteres: letras, números, puntos o guiones.",
    });
  });
});

describe("parsearFactor", () => {
  it("vacío es 1", () => {
    expect(parsearFactor("")).toBe(1);
    expect(parsearFactor(null)).toBe(1);
  });

  it("acepta coma o punto decimal", () => {
    expect(parsearFactor("2,5")).toBe(2.5);
    expect(parsearFactor(" 0.25 ")).toBe(0.25);
  });

  it("devuelve null si no es un número mayor que cero", () => {
    expect(parsearFactor("0")).toBeNull();
    expect(parsearFactor("-1")).toBeNull();
    expect(parsearFactor("abc")).toBeNull();
  });
});

describe("validarArticulo", () => {
  const base = { codigo: null, descripcion: "SOGA PP diam 8MM", unidad: null, factor: null, materia_prima_id: null };

  it("recorta los textos, vacíos a null y factor 1 por defecto", () => {
    expect(
      validarArticulo({ codigo: " SG-8 ", descripcion: " SOGA PP diam 8MM ", unidad: "  ", factor: "", materia_prima_id: "" }),
    ).toEqual({
      datos: { codigo: "SG-8", descripcion: "SOGA PP diam 8MM", unidad: null, factor_conversion: 1, materia_prima_id: null },
    });
  });

  it("conserva la materia prima y el factor con coma", () => {
    expect(validarArticulo({ ...base, unidad: "rollo", factor: "12,5", materia_prima_id: "mp-1" })).toEqual({
      datos: {
        codigo: null,
        descripcion: "SOGA PP diam 8MM",
        unidad: "rollo",
        factor_conversion: 12.5,
        materia_prima_id: "mp-1",
      },
    });
  });

  it("exige la descripción", () => {
    expect(validarArticulo({ ...base, descripcion: "   " })).toEqual({
      error: "La descripción del artículo es obligatoria.",
    });
  });

  it("exige un factor mayor que cero", () => {
    expect(validarArticulo({ ...base, factor: "0" })).toEqual({
      error: "El factor de conversión tiene que ser un número mayor que cero.",
    });
  });
});

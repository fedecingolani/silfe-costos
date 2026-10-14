import { describe, expect, it } from "vitest";
import { validarAlias, validarCbu, validarCuit, validarCvu } from "./validaciones";

// Los números válidos se arman acá calculando sus dígitos verificadores, para
// no depender de datos reales de personas o cuentas.

/** CUIT con el dígito verificador de AFIP (módulo 11, pesos 5432765432). */
function cuitValido(diez: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...diez].reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
  const dv = (11 - (suma % 11)) % 11;
  if (dv === 10) throw new Error("Base de CUIT sin dígito verificador posible");
  return `${diez}${dv}`;
}

/** Dígito verificador de un bloque de CBU (clave 10, ponderador 9713 desde la derecha). */
function verificador(bloque: string): number {
  const pesos = [3, 1, 7, 9];
  const suma = [...bloque]
    .reverse()
    .reduce((acc, d, i) => acc + Number(d) * pesos[i % 4], 0);
  return (10 - (suma % 10)) % 10;
}

/** CBU de 22 dígitos a partir de 7 dígitos de banco y sucursal y 13 de cuenta. */
function cbuValido(siete: string, trece: string): string {
  return `${siete}${verificador(siete)}${trece}${verificador(trece)}`;
}

/** Cambia el último dígito por otro, para romper el verificador. */
function conUltimoCambiado(texto: string): string {
  const ultimo = Number(texto.at(-1));
  return `${texto.slice(0, -1)}${(ultimo + 1) % 10}`;
}

describe("validarCuit", () => {
  const cuit = cuitValido("2012345678");

  it("acepta un CUIT válido sin guiones y lo normaliza a 11 dígitos", () => {
    expect(validarCuit(cuit)).toEqual({ valido: true, normalizado: cuit, mensaje: null });
  });

  it("acepta un CUIT válido con guiones", () => {
    const conGuiones = `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
    expect(validarCuit(` ${conGuiones} `)).toEqual({ valido: true, normalizado: cuit, mensaje: null });
  });

  it("acepta un CUIT cuyo verificador da 0", () => {
    // Busca una base cuyo verificador sea 0 (11 - resto = 11).
    const base = Array.from({ length: 100 }, (_, i) => `30${String(10000000 + i)}`).find(
      (b) => cuitValido(b).endsWith("0"),
    )!;
    expect(validarCuit(cuitValido(base)).valido).toBe(true);
  });

  it("avisa si el dígito verificador no cierra", () => {
    const resultado = validarCuit(conUltimoCambiado(cuit));
    expect(resultado.valido).toBe(false);
    expect(resultado.normalizado).toBe(conUltimoCambiado(cuit));
    expect(resultado.mensaje).toMatch(/verificador/);
  });

  it("avisa si no tiene 11 dígitos", () => {
    const resultado = validarCuit("20-1234567-8");
    expect(resultado).toEqual({
      valido: false,
      normalizado: null,
      mensaje: expect.stringMatching(/11 dígitos/),
    });
  });

  it("rechaza letras y guiones mal ubicados", () => {
    expect(validarCuit("20A23456789").valido).toBe(false);
    expect(validarCuit("201-2345678-9").valido).toBe(false);
  });

  it("toma como válido un campo vacío (el CUIT es opcional)", () => {
    expect(validarCuit("")).toEqual({ valido: true, normalizado: null, mensaje: null });
    expect(validarCuit(null)).toEqual({ valido: true, normalizado: null, mensaje: null });
  });
});

describe("validarCbu", () => {
  const cbu = cbuValido("0110599", "2000000123456");

  it("acepta un CBU con los dos verificadores correctos", () => {
    expect(validarCbu(cbu)).toEqual({ valido: true, normalizado: cbu, mensaje: null });
  });

  it("quita espacios al normalizar", () => {
    expect(validarCbu(`${cbu.slice(0, 8)} ${cbu.slice(8)}`).normalizado).toBe(cbu);
  });

  it("avisa si falla el verificador del primer bloque", () => {
    const roto = `${conUltimoCambiado(cbu.slice(0, 8))}${cbu.slice(8)}`;
    const resultado = validarCbu(roto);
    expect(resultado.valido).toBe(false);
    expect(resultado.normalizado).toBe(roto);
    expect(resultado.mensaje).toMatch(/verificador/);
  });

  it("avisa si falla el verificador del segundo bloque", () => {
    expect(validarCbu(conUltimoCambiado(cbu)).valido).toBe(false);
  });

  it("avisa si no tiene 22 dígitos", () => {
    expect(validarCbu(cbu.slice(1))).toEqual({
      valido: false,
      normalizado: null,
      mensaje: expect.stringMatching(/22 dígitos/),
    });
    expect(validarCbu(`${cbu.slice(0, 21)}A`).valido).toBe(false);
  });

  it("toma como válido un campo vacío", () => {
    expect(validarCbu("  ")).toEqual({ valido: true, normalizado: null, mensaje: null });
  });
});

describe("validarCvu", () => {
  const cvu = cbuValido("0000031", "0000000012345");

  it("acepta un CVU que empieza con 000 y tiene los verificadores correctos", () => {
    expect(validarCvu(cvu)).toEqual({ valido: true, normalizado: cvu, mensaje: null });
  });

  it("avisa si no empieza con 000", () => {
    const resultado = validarCvu(cbuValido("0110599", "0000000012345"));
    expect(resultado.valido).toBe(false);
    expect(resultado.mensaje).toMatch(/000/);
  });

  it("avisa si un verificador no cierra", () => {
    expect(validarCvu(conUltimoCambiado(cvu)).valido).toBe(false);
  });

  it("avisa si no tiene 22 dígitos", () => {
    expect(validarCvu("000003").mensaje).toMatch(/22 dígitos/);
  });

  it("toma como válido un campo vacío", () => {
    expect(validarCvu(undefined)).toEqual({ valido: true, normalizado: null, mensaje: null });
  });
});

describe("validarAlias", () => {
  it("acepta letras, números, punto y guion, de 6 a 20 caracteres", () => {
    expect(validarAlias(" silfe.cosecha-01 ")).toEqual({
      valido: true,
      normalizado: "silfe.cosecha-01",
      mensaje: null,
    });
    expect(validarAlias("abcdef").valido).toBe(true);
    expect(validarAlias("a".repeat(20)).valido).toBe(true);
  });

  it("rechaza alias muy cortos o muy largos", () => {
    expect(validarAlias("abcde").valido).toBe(false);
    expect(validarAlias("a".repeat(21)).valido).toBe(false);
  });

  it("rechaza espacios y otros caracteres", () => {
    expect(validarAlias("silfe cosecha").valido).toBe(false);
    expect(validarAlias("silfe_cosecha").valido).toBe(false);
    expect(validarAlias("cosecha.ñandú").valido).toBe(false);
  });

  it("toma como válido un campo vacío", () => {
    expect(validarAlias("")).toEqual({ valido: true, normalizado: null, mensaje: null });
  });
});

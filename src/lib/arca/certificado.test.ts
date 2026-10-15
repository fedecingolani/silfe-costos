import { describe, expect, it } from "vitest";
import { analizarCertificado, claveCorrespondeACertificado, validarCredencial } from "./certificado";
import { generarParPrueba } from "./certificados-prueba";

const AHORA = new Date("2026-10-15T12:00:00Z");
const par = generarParPrueba();
const otroPar = generarParPrueba("otra");

describe("analizarCertificado", () => {
  it("lee titular, CUIT, emisor y vencimiento", () => {
    const datos = analizarCertificado(par.certificadoPem);
    expect(datos).toEqual({
      titular: "silfeerphomo",
      cuit: "23334771229",
      emisor: "Computadores Test",
      vence: new Date("2028-01-01T00:00:00Z"),
    });
  });

  it("falla con un texto que no es un certificado", () => {
    expect(() => analizarCertificado("hola")).toThrow(/certificado/);
  });
});

describe("claveCorrespondeACertificado", () => {
  it("reconoce la clave del certificado", () => {
    expect(claveCorrespondeACertificado(par.clavePem, par.certificadoPem)).toBe(true);
  });

  it("detecta una clave de otro certificado", () => {
    expect(claveCorrespondeACertificado(otroPar.clavePem, par.certificadoPem)).toBe(false);
  });
});

describe("validarCredencial", () => {
  const base = { certificadoPem: par.certificadoPem, clavePem: par.clavePem, cuitEmisor: "23334771229", ahora: AHORA };

  it("no informa errores con una credencial correcta", () => {
    expect(validarCredencial(base)).toEqual([]);
  });

  it("acepta la CUIT del emisor con guiones", () => {
    expect(validarCredencial({ ...base, cuitEmisor: "23-33477122-9" })).toEqual([]);
  });

  it("informa un certificado ilegible", () => {
    expect(validarCredencial({ ...base, certificadoPem: "no es un PEM" })).toEqual([
      "No se pudo leer el certificado. Subí el archivo .crt que descargaste de ARCA.",
    ]);
  });

  it("informa una clave ilegible", () => {
    expect(validarCredencial({ ...base, clavePem: "no es una clave" })).toEqual([
      "No se pudo leer la clave privada. Subí el archivo .key con el que generaste el pedido del certificado.",
    ]);
  });

  it("informa una clave que no corresponde al certificado", () => {
    expect(validarCredencial({ ...base, clavePem: otroPar.clavePem })).toEqual([
      "La clave privada no corresponde a este certificado.",
    ]);
  });

  it("informa un certificado de otra CUIT", () => {
    expect(validarCredencial({ ...base, cuitEmisor: "20123456786" })).toEqual([
      "El certificado es de la CUIT 23334771229 y el emisor está configurado con 20123456786.",
    ]);
  });

  it("informa un certificado vencido", () => {
    const vencido = generarParPrueba("principal", { hasta: new Date("2026-10-01T15:00:00Z") });
    expect(validarCredencial({ ...base, certificadoPem: vencido.certificadoPem })).toEqual([
      "El certificado venció el 01/10/2026.",
    ]);
  });

  it("informa un certificado que todavía no empezó a valer", () => {
    const futuro = generarParPrueba("principal", { desde: new Date("2026-11-20T15:00:00Z") });
    expect(validarCredencial({ ...base, certificadoPem: futuro.certificadoPem })).toEqual([
      "El certificado empieza a valer el 20/11/2026.",
    ]);
  });

  it("junta varios errores", () => {
    expect(validarCredencial({ ...base, clavePem: otroPar.clavePem, cuitEmisor: "20123456786" })).toHaveLength(2);
  });
});

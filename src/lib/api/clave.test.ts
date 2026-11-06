import { describe, expect, it } from "vitest";
import { esFormatoClave, generarClave, hashClave, leerBearer, prefijoClave } from "./clave";

describe("generarClave", () => {
  it("empieza con chg_ y trae 32 bytes en base64url", () => {
    const clave = generarClave();
    expect(clave).toMatch(/^chg_[A-Za-z0-9_-]{43}$/);
    expect(esFormatoClave(clave)).toBe(true);
  });

  it("no repite claves", () => {
    const claves = new Set(Array.from({ length: 50 }, () => generarClave()));
    expect(claves.size).toBe(50);
  });
});

describe("esFormatoClave", () => {
  it("rechaza otro prefijo, otro largo y caracteres fuera de base64url", () => {
    expect(esFormatoClave("abc_" + "A".repeat(43))).toBe(false);
    expect(esFormatoClave("chg_" + "A".repeat(42))).toBe(false);
    expect(esFormatoClave("chg_" + "A".repeat(42) + "+")).toBe(false);
    expect(esFormatoClave("")).toBe(false);
  });
});

describe("hashClave", () => {
  it("es el SHA-256 en hexadecimal", async () => {
    // echo -n abc | shasum -a 256
    expect(await hashClave("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("da 64 caracteres hexadecimales para una clave generada", async () => {
    expect(await hashClave(generarClave())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("prefijoClave", () => {
  it("son los primeros 12 caracteres", () => {
    expect(prefijoClave("chg_ABCDEFGHijklmnop")).toBe("chg_ABCDEFGH");
  });
});

describe("leerBearer", () => {
  it("lee la clave del encabezado Authorization", () => {
    expect(leerBearer("Bearer chg_abc")).toBe("chg_abc");
    expect(leerBearer("bearer   chg_abc  ")).toBe("chg_abc");
  });

  it("sin encabezado, con otro esquema o vacío es null", () => {
    expect(leerBearer(null)).toBeNull();
    expect(leerBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(leerBearer("Bearer ")).toBeNull();
    expect(leerBearer("chg_abc")).toBeNull();
  });
});

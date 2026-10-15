import { describe, expect, it } from "vitest";
import { cifrar, descifrar, generarClaveCifrado } from "./cifrado";

const CLAVE = Buffer.alloc(32, 7).toString("base64");
const OTRA_CLAVE = Buffer.alloc(32, 9).toString("base64");
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\n";

describe("cifrar y descifrar", () => {
  it("vuelve al texto original", async () => {
    const cifrado = await cifrar(PEM, CLAVE);
    expect(await descifrar(cifrado, CLAVE)).toBe(PEM);
  });

  it("usa el formato v1.<iv>.<datos> sin el texto en claro", async () => {
    const cifrado = await cifrar(PEM, CLAVE);
    const partes = cifrado.split(".");
    expect(partes).toHaveLength(3);
    expect(partes[0]).toBe("v1");
    expect(Buffer.from(partes[1], "base64")).toHaveLength(12);
    expect(cifrado).not.toContain("PRIVATE KEY");
  });

  it("usa un IV distinto en cada cifrado", async () => {
    expect(await cifrar(PEM, CLAVE)).not.toBe(await cifrar(PEM, CLAVE));
  });

  it("falla con otra clave", async () => {
    const cifrado = await cifrar(PEM, CLAVE);
    await expect(descifrar(cifrado, OTRA_CLAVE)).rejects.toThrow(/descifrar/);
  });

  it("falla si se alteran los datos cifrados", async () => {
    const [version, iv, datos] = (await cifrar(PEM, CLAVE)).split(".");
    const bytes = Buffer.from(datos, "base64");
    bytes[0] ^= 1;
    await expect(descifrar([version, iv, bytes.toString("base64")].join("."), CLAVE)).rejects.toThrow(
      /descifrar/,
    );
  });

  it("rechaza un texto que no tiene el formato v1", async () => {
    await expect(descifrar(PEM, CLAVE)).rejects.toThrow(/formato/);
  });

  it("rechaza claves que no son de 32 bytes", async () => {
    const corta = Buffer.alloc(16, 1).toString("base64");
    await expect(cifrar(PEM, corta)).rejects.toThrow(/32 bytes/);
    await expect(descifrar("v1.a.b", corta)).rejects.toThrow(/32 bytes/);
    await expect(cifrar(PEM, "")).rejects.toThrow(/32 bytes/);
  });
});

describe("generarClaveCifrado", () => {
  it("genera una clave de 32 bytes en base64 que sirve para cifrar", async () => {
    const clave = generarClaveCifrado();
    expect(Buffer.from(clave, "base64")).toHaveLength(32);
    expect(await descifrar(await cifrar("hola", clave), clave)).toBe("hola");
  });
});

import { describe, expect, it } from "vitest";
import { claveBanco, LARGO_MAXIMO_NOMBRE_BANCO, validarBanco } from "./validacion";

describe("validarBanco", () => {
  it("recorta y colapsa los espacios del nombre", () => {
    expect(validarBanco({ nombre: "  Banco   Macro ", activo: true })).toEqual({
      datos: { nombre: "Banco Macro", activo: true },
    });
  });

  it("conserva el estado inactivo", () => {
    expect(validarBanco({ nombre: "Banco Piano", activo: false })).toEqual({
      datos: { nombre: "Banco Piano", activo: false },
    });
  });

  it("exige el nombre", () => {
    expect(validarBanco({ nombre: "   ", activo: true })).toEqual({ error: "El nombre del banco es obligatorio." });
    expect(validarBanco({ nombre: null, activo: true })).toEqual({ error: "El nombre del banco es obligatorio." });
  });

  it("limita el largo del nombre", () => {
    const largo = "B".repeat(LARGO_MAXIMO_NOMBRE_BANCO + 1);
    expect(validarBanco({ nombre: largo, activo: true })).toEqual({
      error: `El nombre del banco puede tener hasta ${LARGO_MAXIMO_NOMBRE_BANCO} caracteres.`,
    });
    expect(validarBanco({ nombre: "B".repeat(LARGO_MAXIMO_NOMBRE_BANCO), activo: true })).toHaveProperty("datos");
  });
});

describe("claveBanco", () => {
  it("ignora mayúsculas, tildes y espacios de más, como el índice único de la base", () => {
    expect(claveBanco("  Banco de la NACIÓN   Argentina ")).toBe("banco de la nacion argentina");
    expect(claveBanco("Banco de Entre Ríos")).toBe(claveBanco("banco de entre rios"));
  });
});

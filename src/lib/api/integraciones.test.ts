import { describe, expect, it } from "vitest";
import type { ApiClaveVisible } from "@/lib/tipos";
import { estadoClave, filaClave, urlBaseApi, validarNombreClave } from "./integraciones";

describe("estadoClave", () => {
  it("es activa sin fecha de revocación", () => {
    expect(estadoClave({ revocada_en: null })).toBe("activa");
  });

  it("es revocada con fecha de revocación", () => {
    expect(estadoClave({ revocada_en: "2026-11-06T12:00:00Z" })).toBe("revocada");
  });
});

describe("validarNombreClave", () => {
  it("recorta los espacios", () => {
    expect(validarNombreClave("  Factura Digital ")).toEqual({ nombre: "Factura Digital" });
  });

  it("rechaza vacío o ausente", () => {
    expect(validarNombreClave("   ")).toHaveProperty("error");
    expect(validarNombreClave(null)).toHaveProperty("error");
  });

  it("rechaza nombres de más de 100 caracteres", () => {
    expect(validarNombreClave("a".repeat(101))).toHaveProperty("error");
    expect(validarNombreClave("a".repeat(100))).toEqual({ nombre: "a".repeat(100) });
  });
});

describe("urlBaseApi", () => {
  it("usa el protocolo informado por el proxy", () => {
    expect(urlBaseApi("gestion.ejemplo.com", "https")).toBe("https://gestion.ejemplo.com/api/v1");
  });

  it("toma el primer protocolo si vienen varios", () => {
    expect(urlBaseApi("gestion.ejemplo.com", "https,http")).toBe("https://gestion.ejemplo.com/api/v1");
  });

  it("sin protocolo usa http en localhost y https en el resto", () => {
    expect(urlBaseApi("localhost:3000", null)).toBe("http://localhost:3000/api/v1");
    expect(urlBaseApi("127.0.0.1:8787", null)).toBe("http://127.0.0.1:8787/api/v1");
    expect(urlBaseApi("silfe-costos.workers.dev", null)).toBe("https://silfe-costos.workers.dev/api/v1");
  });

  it("sin host devuelve null", () => {
    expect(urlBaseApi(null, "https")).toBeNull();
  });
});

describe("filaClave", () => {
  const formatear = (valor: string) => `f(${valor})`;
  const base: ApiClaveVisible = {
    id: "1",
    nombre: "Factura Digital",
    prefijo: "chg_abcdefgh",
    creado_en: "2026-11-06T12:00:00Z",
    revocada_en: null,
    ultimo_uso_en: null,
  };

  it("arma una clave activa sin uso", () => {
    expect(filaClave(base, formatear)).toEqual({
      id: "1",
      nombre: "Factura Digital",
      prefijo: "chg_abcdefgh",
      creada: "f(2026-11-06T12:00:00Z)",
      ultimoUso: "Nunca",
      estado: "activa",
      revocada: null,
    });
  });

  it("arma una clave revocada y usada", () => {
    const fila = filaClave(
      { ...base, revocada_en: "2026-11-07T10:00:00Z", ultimo_uso_en: "2026-11-06T15:00:00Z" },
      formatear,
    );
    expect(fila.estado).toBe("revocada");
    expect(fila.revocada).toBe("f(2026-11-07T10:00:00Z)");
    expect(fila.ultimoUso).toBe("f(2026-11-06T15:00:00Z)");
  });

  it("nunca incluye el hash aunque venga en la fila", () => {
    const fila = filaClave({ ...base, hash: "a".repeat(64) } as typeof base, formatear);
    expect(fila).not.toHaveProperty("hash");
  });
});

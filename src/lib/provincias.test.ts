import { describe, expect, it } from "vitest";
import { normalizarProvincia, PROVINCIAS, provinciaAdmitida } from "./provincias";

describe("PROVINCIAS", () => {
  it("tiene las 24 jurisdicciones", () => {
    expect(PROVINCIAS).toHaveLength(24);
  });
});

describe("normalizarProvincia", () => {
  it("devuelve el nombre de la lista tal cual", () => {
    expect(normalizarProvincia("Córdoba")).toBe("Córdoba");
  });

  it("ignora mayúsculas, tildes y espacios alrededor", () => {
    expect(normalizarProvincia("cordoba")).toBe("Córdoba");
    expect(normalizarProvincia("  NEUQUEN ")).toBe("Neuquén");
    expect(normalizarProvincia("entre rios")).toBe("Entre Ríos");
    expect(normalizarProvincia("santiago  del estero")).toBe("Santiago del Estero");
  });

  it("reconoce los nombres usuales de la Ciudad Autónoma de Buenos Aires", () => {
    expect(normalizarProvincia("CABA")).toBe("Ciudad Autónoma de Buenos Aires");
    expect(normalizarProvincia("Capital Federal")).toBe("Ciudad Autónoma de Buenos Aires");
    expect(normalizarProvincia("ciudad autonoma de buenos aires")).toBe("Ciudad Autónoma de Buenos Aires");
  });

  it("devuelve null si no coincide o está vacío", () => {
    expect(normalizarProvincia("Patagonia")).toBeNull();
    expect(normalizarProvincia("")).toBeNull();
    expect(normalizarProvincia("   ")).toBeNull();
    expect(normalizarProvincia(null)).toBeNull();
  });
});

describe("provinciaAdmitida", () => {
  it("admite vacío y los valores de la lista", () => {
    expect(provinciaAdmitida(null, null)).toBe(true);
    expect(provinciaAdmitida("Río Negro", null)).toBe(true);
  });

  it("rechaza un valor fuera de la lista", () => {
    expect(provinciaAdmitida("rio negro", null)).toBe(false);
    expect(provinciaAdmitida("Patagonia", "Río Negro")).toBe(false);
  });

  it("admite un valor viejo fuera de la lista si no cambió", () => {
    expect(provinciaAdmitida("Patagonia", "Patagonia")).toBe(true);
  });
});

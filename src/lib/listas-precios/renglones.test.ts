import { describe, expect, it } from "vitest";
import { armarRenglones, formatearPrecio, formatearIva, formatearPresentacion } from "./renglones";
import { itemsDeReferencia } from "./fixtures";

describe("formatearPrecio", () => {
  it("usa separador de miles es-AR y sin decimales si es entero", () => {
    expect(formatearPrecio(24500)).toBe("$ 24.500");
    expect(formatearPrecio(2450)).toBe("$ 2.450");
    expect(formatearPrecio(1250000)).toBe("$ 1.250.000");
    expect(formatearPrecio(0)).toBe("$ 0");
  });

  it("muestra dos decimales si el precio no es entero", () => {
    expect(formatearPrecio(9750.5)).toBe("$ 9.750,50");
    expect(formatearPrecio(12.345)).toBe("$ 12,35");
  });
});

describe("formatearIva", () => {
  it("muestra la alícuota con coma decimal", () => {
    expect(formatearIva(21)).toBe("+ IVA (21%)");
    expect(formatearIva(10.5)).toBe("+ IVA (10,5%)");
  });
});

describe("formatearPresentacion", () => {
  it("antepone 'x ' y pasa a minúsculas", () => {
    expect(formatearPresentacion("Docena")).toBe("x docena");
    expect(formatearPresentacion("Par")).toBe("x par");
  });

  it("omite la unidad base y la presentación vacía", () => {
    expect(formatearPresentacion("Unidad")).toBeNull();
    expect(formatearPresentacion("unidad")).toBeNull();
    expect(formatearPresentacion(null)).toBeNull();
    expect(formatearPresentacion("  ")).toBeNull();
  });
});

describe("armarRenglones", () => {
  it("antepone 'Repuestos:' a cada tanda de repuestos", () => {
    const renglones = armarRenglones(itemsDeReferencia);
    expect(renglones.map((r) => (r.tipo === "etiqueta" ? r.texto : r.descripcion))).toEqual([
      "Recolector grande con correa reforzada",
      "Repuestos:",
      "Correa para recolector",
      "Malla de repuesto",
      "Aro de fondo",
      "Lona cosechera 4 x 4 m",
      "Flete a cargo del cliente – consultar",
    ]);
  });

  it("formatea cada ítem para imprimir", () => {
    const renglones = armarRenglones(itemsDeReferencia);
    expect(renglones[0]).toEqual({
      tipo: "item",
      repuesto: false,
      separarAntes: false,
      codigo: "001",
      descripcion: "Recolector grande con correa reforzada",
      presentacion: null,
      precio: "$ 24.500",
      iva: "+ IVA (21%)",
    });
    expect(renglones[3]).toMatchObject({
      tipo: "item",
      repuesto: true,
      separarAntes: false,
      codigo: "102",
      presentacion: "x docena",
      precio: "$ 9.750,50",
      iva: "+ IVA (10,5%)",
    });
  });

  it("separa los grupos de primer nivel, salvo el primero", () => {
    const renglones = armarRenglones(itemsDeReferencia);
    const separados = renglones.filter((r) => r.tipo === "item" && r.separarAntes);
    expect(separados.map((r) => r.tipo === "item" && r.codigo)).toEqual(["002", null]);
    expect(renglones[1]).toEqual({ tipo: "etiqueta", texto: "Repuestos:" });
  });

  it("etiqueta también los repuestos sueltos del final", () => {
    const renglones = armarRenglones([
      { ...itemsDeReferencia[0] },
      { ...itemsDeReferencia[1] },
      { ...itemsDeReferencia[4] },
      { ...itemsDeReferencia[2] },
    ]);
    expect(renglones.filter((r) => r.tipo === "etiqueta")).toHaveLength(2);
  });

  it("devuelve una lista vacía si no hay ítems", () => {
    expect(armarRenglones([])).toEqual([]);
  });
});

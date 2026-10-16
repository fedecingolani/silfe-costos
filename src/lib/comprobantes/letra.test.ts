import { describe, expect, it } from "vitest";
import { condicionIvaReceptorId, documentoReceptor, letraYTipo } from "./letra";

describe("letraYTipo", () => {
  it("da letra A a Responsable Inscripto y Monotributista", () => {
    expect(letraYTipo("Responsable Inscripto", "factura")).toEqual({ letra: "A", tipoArca: 1 });
    expect(letraYTipo("Responsable Inscripto", "nota_debito")).toEqual({ letra: "A", tipoArca: 2 });
    expect(letraYTipo("Monotributista", "nota_credito")).toEqual({ letra: "A", tipoArca: 3 });
  });

  it("da letra B a Exento y Consumidor Final", () => {
    expect(letraYTipo("Consumidor Final", "factura")).toEqual({ letra: "B", tipoArca: 6 });
    expect(letraYTipo("Exento", "nota_debito")).toEqual({ letra: "B", tipoArca: 7 });
    expect(letraYTipo("Consumidor Final", "nota_credito")).toEqual({ letra: "B", tipoArca: 8 });
  });

  it("pide completar la condición IVA si falta", () => {
    expect(() => letraYTipo(null, "factura")).toThrow("Completá la condición frente al IVA del cliente");
    expect(() => letraYTipo(undefined, "factura")).toThrow(/condición frente al IVA/);
  });
});

describe("condicionIvaReceptorId", () => {
  it("usa los códigos de ARCA", () => {
    expect(condicionIvaReceptorId("Responsable Inscripto")).toBe(1);
    expect(condicionIvaReceptorId("Exento")).toBe(4);
    expect(condicionIvaReceptorId("Consumidor Final")).toBe(5);
    expect(condicionIvaReceptorId("Monotributista")).toBe(6);
  });
});

describe("documentoReceptor", () => {
  it("en letra A usa la CUIT (80), sin guiones", () => {
    expect(documentoReceptor("20-11111111-2", "Responsable Inscripto", "A")).toEqual({
      docTipo: 80,
      docNro: "20111111112",
    });
  });

  it("en letra A rechaza una CUIT faltante o inválida", () => {
    expect(() => documentoReceptor(null, "Responsable Inscripto", "A")).toThrow(/CUIT válida/);
    expect(() => documentoReceptor("20111111113", "Monotributista", "A")).toThrow(/CUIT válida/);
  });

  it("en letra B usa la CUIT si es válida", () => {
    expect(documentoReceptor("20111111112", "Exento", "B")).toEqual({ docTipo: 80, docNro: "20111111112" });
  });

  it("en letra B sin CUIT válida usa 99 con número 0", () => {
    expect(documentoReceptor(null, "Consumidor Final", "B")).toEqual({ docTipo: 99, docNro: "0" });
    expect(documentoReceptor("123", "Consumidor Final", "B")).toEqual({ docTipo: 99, docNro: "0" });
  });
});

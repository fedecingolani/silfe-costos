import { describe, expect, it } from "vitest";
import { discriminaIva, letraSugerida } from "./letra";

describe("letraSugerida", () => {
  it("un responsable inscripto factura A", () => {
    expect(letraSugerida("Responsable Inscripto")).toBe("A");
  });

  it("un monotributista o un exento factura C", () => {
    expect(letraSugerida("Monotributista")).toBe("C");
    expect(letraSugerida("Exento")).toBe("C");
  });

  it("cualquier otra condición, o ninguna, sugiere B", () => {
    expect(letraSugerida("Consumidor Final")).toBe("B");
    expect(letraSugerida(null)).toBe("B");
    expect(letraSugerida(undefined)).toBe("B");
  });
});

describe("discriminaIva", () => {
  it("sólo A y M discriminan IVA", () => {
    expect(discriminaIva("A")).toBe(true);
    expect(discriminaIva("M")).toBe(true);
    expect(discriminaIva("B")).toBe(false);
    expect(discriminaIva("C")).toBe(false);
  });
});

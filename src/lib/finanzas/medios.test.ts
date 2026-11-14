import { describe, expect, it } from "vitest";
import { cuentaPorDefecto, cuentasDelMedio, tipoCuentaDelMedio, type CuentaElegible } from "./medios";

const CUENTAS: CuentaElegible[] = [
  { id: "b1", tipo: "banco", nombre: "Galicia" },
  { id: "c1", tipo: "caja", nombre: "Caja oficina" },
  { id: "b2", tipo: "banco", nombre: "Nación" },
];

describe("tipoCuentaDelMedio", () => {
  it("el efectivo va a una caja y la transferencia a un banco", () => {
    expect(tipoCuentaDelMedio("efectivo")).toBe("caja");
    expect(tipoCuentaDelMedio("transferencia")).toBe("banco");
  });

  it("cheques, e-cheq y retenciones no mueven fondos al cobrarlos", () => {
    expect(tipoCuentaDelMedio("cheque")).toBeNull();
    expect(tipoCuentaDelMedio("echeq")).toBeNull();
    expect(tipoCuentaDelMedio("retencion")).toBeNull();
  });
});

describe("tipoCuentaDelMedio en una orden de pago", () => {
  it("el efectivo sale de una caja; la transferencia y el cheque propio, de un banco", () => {
    expect(tipoCuentaDelMedio("cheque_propio")).toBe("banco");
  });

  it("el cheque de terceros sale de la cartera, no de una cuenta", () => {
    expect(tipoCuentaDelMedio("cheque_tercero")).toBeNull();
  });
});

describe("cuentasDelMedio", () => {
  it("filtra por el tipo que corresponde al medio", () => {
    expect(cuentasDelMedio(CUENTAS, "transferencia").map((c) => c.id)).toEqual(["b1", "b2"]);
    expect(cuentasDelMedio(CUENTAS, "efectivo").map((c) => c.id)).toEqual(["c1"]);
    expect(cuentasDelMedio(CUENTAS, "cheque")).toEqual([]);
    expect(cuentasDelMedio(CUENTAS, "cheque_propio").map((c) => c.id)).toEqual(["b1", "b2"]);
    expect(cuentasDelMedio(CUENTAS, "cheque_tercero")).toEqual([]);
  });
});

describe("cuentaPorDefecto", () => {
  it("elige la única cuenta del tipo", () => {
    expect(cuentaPorDefecto(CUENTAS, "efectivo")).toBe("c1");
  });

  it("con varias o ninguna, no elige", () => {
    expect(cuentaPorDefecto(CUENTAS, "transferencia")).toBeNull();
    expect(cuentaPorDefecto([], "efectivo")).toBeNull();
    expect(cuentaPorDefecto(CUENTAS, "retencion")).toBeNull();
  });
});

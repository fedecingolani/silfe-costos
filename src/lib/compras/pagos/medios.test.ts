import { describe, expect, it } from "vitest";
import {
  buscarCheques,
  chequesElegibles,
  importeMedio,
  medioParaGuardar,
  textoCheque,
  totalMedios,
  validarMedios,
  type ChequeCartera,
  type MedioBorrador,
} from "./medios";

const cheque = (id: string, cambios: Partial<ChequeCartera> = {}): ChequeCartera => ({
  id,
  banco: "Nación",
  numero: `000${id}`,
  fechaPago: "2026-12-01",
  importe: 1000,
  librador: "Agro SA",
  cliente: "Finca Los Álamos",
  estado: "en_cartera",
  ...cambios,
});

const medio = (cambios: Partial<MedioBorrador>): MedioBorrador => ({
  tipo: "efectivo",
  importe: 0,
  referencia: null,
  chequeId: null,
  banco: null,
  numero: null,
  fechaPago: null,
  ...cambios,
});

const cartera = new Map([cheque("1"), cheque("2", { importe: 2500.5, banco: "Galicia" })].map((c) => [c.id, c]));

describe("importeMedio", () => {
  it("un cheque de terceros va por el importe del cheque, no por lo escrito", () => {
    expect(importeMedio(medio({ tipo: "cheque_tercero", chequeId: "2", importe: 1 }), cartera)).toBe(2500.5);
  });

  it("un cheque de terceros sin elegir o desconocido no tiene importe (NaN)", () => {
    expect(Number.isNaN(importeMedio(medio({ tipo: "cheque_tercero" }), cartera))).toBe(true);
    expect(Number.isNaN(importeMedio(medio({ tipo: "cheque_tercero", chequeId: "x" }), cartera))).toBe(true);
  });

  it("los demás medios van por lo escrito", () => {
    expect(importeMedio(medio({ tipo: "cheque_propio", importe: 300 }), cartera)).toBe(300);
  });
});

describe("totalMedios", () => {
  it("suma exacta a centavos e ignora los importes ilegibles", () => {
    const medios = [
      medio({ importe: 0.1 }),
      medio({ tipo: "transferencia", importe: 0.2 }),
      medio({ tipo: "cheque_tercero", chequeId: "2" }),
      medio({ importe: Number.NaN }),
    ];
    expect(totalMedios(medios, cartera)).toBe(2500.8);
  });
});

describe("validarMedios", () => {
  it("pide al menos un medio", () => {
    expect(validarMedios([], cartera)).toEqual(["Cargá al menos un medio de pago."]);
  });

  it("todo bien: efectivo, transferencia, cheque de terceros y cheque propio", () => {
    expect(
      validarMedios(
        [
          medio({ importe: 10 }),
          medio({ tipo: "transferencia", importe: 20, referencia: "op 123" }),
          medio({ tipo: "cheque_tercero", chequeId: "1" }),
          medio({ tipo: "cheque_propio", importe: 50, banco: "Macro", numero: "77", fechaPago: "2026-12-10" }),
        ],
        cartera,
      ),
    ).toEqual([]);
  });

  it("importes en cero, negativos o ilegibles", () => {
    expect(validarMedios([medio({ importe: 0 }), medio({ importe: Number.NaN })], cartera)).toEqual([
      "El importe de cada medio de pago tiene que ser mayor que cero.",
    ]);
  });

  it("cheque de terceros sin elegir, fuera de la cartera o repetido", () => {
    expect(validarMedios([medio({ tipo: "cheque_tercero" })], cartera)).toEqual([
      "Elegí el cheque de terceros de la cartera.",
    ]);
    const entregado = new Map([["9", cheque("9", { estado: "entregado", banco: "Macro", numero: "55" })]]);
    expect(validarMedios([medio({ tipo: "cheque_tercero", chequeId: "9" })], entregado)).toEqual([
      "El cheque Macro N° 55 ya no está en la cartera.",
    ]);
    expect(validarMedios([medio({ tipo: "cheque_tercero", chequeId: "x" })], cartera)).toEqual([
      "Uno de los cheques elegidos ya no está en la cartera.",
    ]);
    expect(
      validarMedios([medio({ tipo: "cheque_tercero", chequeId: "1" }), medio({ tipo: "cheque_tercero", chequeId: "1" })], cartera),
    ).toEqual(["Cada cheque de terceros se entrega una sola vez."]);
  });

  it("cheque propio sin banco, número o fecha de pago válida", () => {
    const error = "Cada cheque propio lleva banco, número y fecha de pago.";
    expect(validarMedios([medio({ tipo: "cheque_propio", importe: 5, numero: "1", fechaPago: "2026-12-01" })], cartera)).toEqual([
      error,
    ]);
    expect(
      validarMedios([medio({ tipo: "cheque_propio", importe: 5, banco: "Macro", numero: "1", fechaPago: "2026-13-01" })], cartera),
    ).toEqual([error]);
  });
});

describe("chequesElegibles y buscarCheques", () => {
  const lista = [cheque("1"), cheque("2", { banco: "Galicia", librador: "Pérez" }), cheque("3", { cliente: "Chacra Sur" })];

  it("no ofrece los cheques elegidos en otros medios, pero sí el del propio medio", () => {
    expect(chequesElegibles(lista, ["1", "2", null], "2").map((c) => c.id)).toEqual(["2", "3"]);
  });

  it("busca por banco, número, librador o cliente, sin tildes ni mayúsculas", () => {
    expect(buscarCheques(lista, "galicia").map((c) => c.id)).toEqual(["2"]);
    expect(buscarCheques(lista, "perez").map((c) => c.id)).toEqual(["2"]);
    expect(buscarCheques(lista, "chacra").map((c) => c.id)).toEqual(["3"]);
    expect(buscarCheques(lista, "0003").map((c) => c.id)).toEqual(["3"]);
    expect(buscarCheques(lista, "  ").map((c) => c.id)).toEqual(["1", "2", "3"]);
  });

  it("textoCheque resume banco, número, fecha de pago e importe", () => {
    expect(textoCheque(cheque("1"))).toBe("Nación N° 0001 · pago 01/12/2026 · $ 1.000,00");
  });
});

describe("medioParaGuardar", () => {
  it("arma cada forma de p_medios de guardar_orden_pago", () => {
    expect(medioParaGuardar(medio({ importe: 10 }))).toEqual({ tipo: "efectivo", importe: 10 });
    expect(medioParaGuardar(medio({ tipo: "transferencia", importe: 20, referencia: " op 1 " }))).toEqual({
      tipo: "transferencia",
      importe: 20,
      referencia: "op 1",
    });
    expect(medioParaGuardar(medio({ tipo: "transferencia", importe: 20, referencia: "  " }))).toEqual({
      tipo: "transferencia",
      importe: 20,
      referencia: null,
    });
    expect(medioParaGuardar(medio({ tipo: "cheque_tercero", chequeId: "1", importe: 99 }))).toEqual({
      tipo: "cheque_tercero",
      cheque_id: "1",
    });
    expect(
      medioParaGuardar(medio({ tipo: "cheque_propio", importe: 50, banco: " Macro ", numero: "77", fechaPago: "2026-12-10" })),
    ).toEqual({ tipo: "cheque_propio", importe: 50, banco: "Macro", numero: "77", fecha_pago: "2026-12-10" });
  });
});

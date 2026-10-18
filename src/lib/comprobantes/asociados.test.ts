import { describe, expect, it } from "vitest";
import { feCAESolicitar } from "@/lib/arca/wsfe";
import {
  asociadoInterno,
  asociadoManual,
  claseDeTipoArca,
  leerAsociadoManual,
  letraDeTipoArca,
  mensajeExcedeSaldo,
  notasPermitidas,
  saldoNotaCredito,
  textoAsociado,
  validarAsociadosNota,
} from "./asociados";

const completo = { tipo_arca: 1, punto_venta: 7, numero: 157, fecha: "2026-09-30", cuit: "23334771229" };

describe("asociadoManual", () => {
  it("arma el CbteAsoc de un comprobante cargado a mano", () => {
    expect(asociadoManual(completo)).toEqual({
      tipo: 1,
      puntoVenta: 7,
      numero: 157,
      fecha: "2026-09-30",
      cuit: "23334771229",
    });
  });

  it("acepta los números que llegan de Postgres como texto (bigint)", () => {
    expect(asociadoManual({ ...completo, numero: "157" }).numero).toBe(157);
  });

  it.each([
    ["sin tipo", { tipo_arca: null }, "tipo"],
    ["con un tipo que no es de ARCA", { tipo_arca: 11 }, "tipo"],
    ["sin punto de venta", { punto_venta: null }, "punto de venta"],
    ["con punto de venta fuera de rango", { punto_venta: 100000 }, "punto de venta"],
    ["sin número", { numero: null }, "número"],
    ["con número cero", { numero: 0 }, "número"],
    ["con número no entero", { numero: 1.5 }, "número"],
    ["sin fecha", { fecha: null }, "fecha"],
    ["con fecha mal formada", { fecha: "30/09/2026" }, "fecha"],
    ["con una fecha que no existe", { fecha: "2026-02-30" }, "fecha"],
    ["sin CUIT", { cuit: null }, "CUIT del emisor"],
  ])("rechaza un asociado %s, con un mensaje legible", (_caso, cambio, falta) => {
    expect(() => asociadoManual({ ...completo, ...cambio })).toThrow(
      `El comprobante asociado cargado a mano está incompleto. Revisá: ${falta}.`,
    );
  });

  it("junta todos los datos que faltan en un solo mensaje", () => {
    expect(() => asociadoManual({ tipo_arca: 1, punto_venta: 7, numero: null, fecha: null, cuit: "23334771229" })).toThrow(
      "El comprobante asociado cargado a mano está incompleto. Revisá: número, fecha.",
    );
  });
});

describe("letra y clase de un código de ARCA", () => {
  it("da la letra y la clase de cada tipo", () => {
    expect([1, 2, 3, 6, 7, 8].map(letraDeTipoArca)).toEqual(["A", "A", "A", "B", "B", "B"]);
    expect([1, 2, 3].map(claseDeTipoArca)).toEqual(["factura", "nota_debito", "nota_credito"]);
    expect(letraDeTipoArca(11)).toBeNull();
    expect(claseDeTipoArca(null)).toBeNull();
  });
});

describe("notasPermitidas", () => {
  it("desde una factura autorizada se generan notas de crédito y de débito", () => {
    expect(notasPermitidas({ clase: "factura", estado: "autorizado" })).toEqual(["nota_credito", "nota_debito"]);
  });

  it("desde una nota de débito autorizada, sólo la nota de crédito que la anula", () => {
    expect(notasPermitidas({ clase: "nota_debito", estado: "autorizado" })).toEqual(["nota_credito"]);
  });

  it("no se genera ninguna nota desde una nota de crédito ni desde un comprobante sin autorizar", () => {
    expect(notasPermitidas({ clase: "nota_credito", estado: "autorizado" })).toEqual([]);
    expect(notasPermitidas({ clase: "factura", estado: "borrador" })).toEqual([]);
    expect(notasPermitidas({ clase: "factura", estado: "verificando" })).toEqual([]);
  });
});

describe("validarAsociadosNota", () => {
  it("exige al menos un comprobante asociado en una nota de crédito o de débito", () => {
    expect(validarAsociadosNota("nota_credito", [])).toEqual({
      error: "Una nota de crédito necesita el comprobante asociado (la factura que corrige).",
    });
    expect(validarAsociadosNota("nota_debito", [])).toHaveProperty("error");
  });

  it("devuelve la letra de los asociados, que es la que tiene que llevar la nota", () => {
    expect(validarAsociadosNota("nota_credito", [1])).toEqual({ letra: "A" });
    expect(validarAsociadosNota("nota_credito", [7])).toEqual({ letra: "B" });
    expect(validarAsociadosNota("nota_debito", [6])).toEqual({ letra: "B" });
  });

  it("no acepta una nota de crédito sobre otra ni una nota de débito sobre una nota", () => {
    expect(validarAsociadosNota("nota_credito", [3])).toEqual({
      error: "Una nota de crédito no puede asociarse a una nota de crédito A.",
    });
    expect(validarAsociadosNota("nota_debito", [2])).toHaveProperty("error");
  });

  it("no acepta asociados con letras distintas", () => {
    expect(validarAsociadosNota("nota_credito", [1, 6])).toEqual({
      error: "Los comprobantes asociados tienen letras distintas: la nota lleva una sola letra.",
    });
  });

  it("una factura no lleva asociados", () => {
    expect(validarAsociadosNota("factura", [])).toEqual({ letra: null });
    expect(validarAsociadosNota("factura", [1])).toEqual({ error: "Una factura no lleva comprobante asociado." });
  });
});

describe("asociadoInterno", () => {
  const factura = { estado: "autorizado" as const, tipo_arca: 1, punto_venta: 7, numero: 361, fecha: "2026-10-10" };

  it("arma el CbteAsoc de un comprobante de la base con la CUIT del emisor y la fecha", () => {
    expect(asociadoInterno(factura, "23334771229")).toEqual({
      tipo: 1,
      puntoVenta: 7,
      numero: 361,
      fecha: "2026-10-10",
      cuit: "23334771229",
    });
  });

  it("rechaza un asociado sin autorizar o sin número", () => {
    expect(() => asociadoInterno({ ...factura, estado: "borrador" }, "23334771229")).toThrow(/no está autorizado/);
    expect(() => asociadoInterno({ ...factura, numero: null }, "23334771229")).toThrow(/no está autorizado/);
  });

  it("pide la CUIT del emisor", () => {
    expect(() => asociadoInterno(factura, null)).toThrow(/CUIT del emisor/);
  });
});

describe("saldo de la nota de crédito", () => {
  it("es el total del asociado menos las otras notas de crédito", () => {
    expect(saldoNotaCredito([1210], [100.1, 200.2])).toBe(909.7);
    expect(saldoNotaCredito([1000, 210], [])).toBe(1210);
  });

  it("informa si la nota supera el saldo, con el saldo disponible", () => {
    expect(mensajeExcedeSaldo(1000, 909.7, "A-00007-00000361")).toBe(
      "La nota de crédito ($ 1.000,00) supera el saldo disponible de A-00007-00000361: $ 909,70.",
    );
    expect(mensajeExcedeSaldo(909.7, 909.7, "A-00007-00000361")).toBeNull();
    expect(mensajeExcedeSaldo(10, 0, "A-00007-00000361")).toMatch(/\$ 0,00/);
  });
});

describe("textoAsociado", () => {
  it("formatea el número con la letra del tipo y la fecha", () => {
    expect(textoAsociado({ tipo_arca: 1, punto_venta: 7, numero: 361, fecha: "2026-10-16" })).toBe(
      "A-00007-00000361 del 16/10/2026",
    );
    expect(textoAsociado({ tipo_arca: 7, punto_venta: 2, numero: "15", fecha: "2026-01-02" })).toBe(
      "B-00002-00000015 del 02/01/2026",
    );
  });
});

describe("leerAsociadoManual", () => {
  const manual = { tipoArca: "1", puntoVenta: "7", numero: "150", fecha: "2026-01-10" };

  it("arma el asociado manual con la CUIT del emisor (es una factura propia)", () => {
    expect(leerAsociadoManual(manual, "nota_credito", "2026-10-16", "23334771229")).toEqual({
      asociado: { tipo_arca: 1, punto_venta: 7, numero: 150, fecha: "2026-01-10", cuit: "23334771229" },
    });
  });

  it("sin datos no hay asociado (se puede guardar el borrador; para autorizar se exige)", () => {
    const vacio = { tipoArca: "", puntoVenta: "", numero: "", fecha: "" };
    expect(leerAsociadoManual(vacio, "nota_credito", "2026-10-16", "23334771229")).toEqual({ asociado: null });
    expect(leerAsociadoManual(null, "nota_credito", "2026-10-16", "23334771229")).toEqual({ asociado: null });
  });

  it("acepta notas de débito como asociado de una nota de crédito, pero no de una de débito", () => {
    expect(leerAsociadoManual({ ...manual, tipoArca: "2" }, "nota_credito", "2026-10-16", "23334771229")).toHaveProperty(
      "asociado",
    );
    expect(leerAsociadoManual({ ...manual, tipoArca: "2" }, "nota_debito", "2026-10-16", "23334771229")).toEqual({
      errores: ["Comprobante asociado: elegí el tipo."],
    });
  });

  it("valida los datos con mensajes legibles", () => {
    const r = leerAsociadoManual(
      { tipoArca: "3", puntoVenta: "0", numero: "x", fecha: "2026-11-01" },
      "nota_credito",
      "2026-10-16",
      null,
    );
    expect(r).toEqual({
      errores: [
        "Comprobante asociado: elegí el tipo.",
        "Comprobante asociado: el punto de venta va de 1 a 99999.",
        "Comprobante asociado: el número tiene que ser un entero mayor a cero.",
        "Comprobante asociado: la fecha no puede ser posterior a la de la nota.",
        "Completá la CUIT del emisor en Configuración → ARCA: va en el comprobante asociado.",
      ],
    });
  });
});

describe("CbtesAsoc en el pedido a ARCA", () => {
  it("manda Tipo, PtoVta, Nro, Cuit del emisor y CbteFch tanto del asociado de la base como del cargado a mano", async () => {
    const cuerpos: string[] = [];
    const fetchFalso = async (_url: string, init: RequestInit) => {
      cuerpos.push(String(init.body));
      return new Response("<html>no importa</html>", { status: 503 });
    };
    const asociados = [
      asociadoInterno({ estado: "autorizado", tipo_arca: 1, punto_venta: 7, numero: 361, fecha: "2026-10-10" }, "23334771229"),
      asociadoManual({ tipo_arca: 6, punto_venta: 7, numero: 150, fecha: "2026-01-09", cuit: "23334771229" }),
    ];
    await feCAESolicitar(fetchFalso, "homologacion", { token: "T", sign: "S", cuit: "23334771229" }, {
      puntoVenta: 7,
      tipoComprobante: 3,
      numero: 1,
      fecha: "2026-10-16",
      docTipo: 80,
      docNro: "20111111112",
      condicionIvaReceptorId: 1,
      neto: 100,
      iva: 21,
      total: 121,
      alicuotas: [{ id: 5, base: 100, importe: 21 }],
      asociados,
    }).catch(() => undefined);

    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toContain(
      "<CbtesAsoc>" +
        "<CbteAsoc><Tipo>1</Tipo><PtoVta>7</PtoVta><Nro>361</Nro><Cuit>23334771229</Cuit><CbteFch>20261010</CbteFch></CbteAsoc>" +
        "<CbteAsoc><Tipo>6</Tipo><PtoVta>7</PtoVta><Nro>150</Nro><Cuit>23334771229</Cuit><CbteFch>20260109</CbteFch></CbteAsoc>" +
        "</CbtesAsoc>",
    );
  });
});

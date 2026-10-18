import { describe, expect, it } from "vitest";
import {
  chequesFueraDeCartera,
  efectosAnulacion,
  mensajeErrorAnulacion,
  textoChequesFueraDeCartera,
  validarMotivoAnulacion,
} from "./anulacion";

const CHEQUES = [
  { banco: "Banco Nación", numero: "123", estado: "en_cartera" as const },
  { banco: "Banco Galicia", numero: "456", estado: "depositado" as const },
  { banco: "Banco Macro", numero: "789", estado: "rechazado" as const },
];

describe("validarMotivoAnulacion", () => {
  it("exige un motivo", () => {
    expect(validarMotivoAnulacion("")).toBe("Escribí el motivo de la anulación.");
    expect(validarMotivoAnulacion("   ")).toBe("Escribí el motivo de la anulación.");
    expect(validarMotivoAnulacion("Cargado al cliente equivocado")).toBeNull();
  });

  it("limita el largo del motivo", () => {
    expect(validarMotivoAnulacion("x".repeat(500))).toBeNull();
    expect(validarMotivoAnulacion("x".repeat(501))).toBe("El motivo no puede superar los 500 caracteres.");
  });
});

describe("cheques fuera de cartera", () => {
  it("lista los que ya no están en cartera, con su estado", () => {
    expect(chequesFueraDeCartera(CHEQUES).map((c) => c.numero)).toEqual(["456", "789"]);
    expect(textoChequesFueraDeCartera(CHEQUES)).toBe(
      "No se puede anular: estos cheques ya salieron de la cartera: Banco Galicia N° 456 (Depositado), " +
        "Banco Macro N° 789 (Rechazado). Para anular el recibo, todos sus cheques tienen que estar en cartera.",
    );
  });

  it("sin cheques movidos no hay texto", () => {
    expect(textoChequesFueraDeCartera([CHEQUES[0]])).toBeNull();
    expect(textoChequesFueraDeCartera([])).toBeNull();
  });
});

describe("mensajeErrorAnulacion", () => {
  it("CB010: dice qué cheques y en qué estado", () => {
    expect(mensajeErrorAnulacion({ code: "CB010", message: "mensaje de la base" }, CHEQUES)).toContain(
      "Banco Galicia N° 456 (Depositado)",
    );
  });

  it("CB010 sin poder leer los cheques: el mensaje de la base", () => {
    expect(mensajeErrorAnulacion({ code: "CB010", message: "El cheque 456 ya no está en cartera." }, [])).toBe(
      "El cheque 456 ya no está en cartera.",
    );
  });

  it("CB019 y CB002 con textos propios", () => {
    expect(mensajeErrorAnulacion({ code: "CB019", message: "x" }, [])).toBe("Escribí el motivo de la anulación.");
    expect(mensajeErrorAnulacion({ code: "CB002", message: "x" }, [])).toBe(
      "El recibo ya no está emitido (puede que lo hayan anulado recién). Recargá la página.",
    );
  });

  it("otros errores: el texto general de cobranzas", () => {
    expect(mensajeErrorAnulacion({ code: "XX000", message: "se cayó" }, [])).toBe("No se pudo anular el recibo: se cayó");
  });
});

describe("efectosAnulacion", () => {
  it("explica qué pasa con los comprobantes, los cheques y el número", () => {
    const efectos = efectosAnulacion({ numero: "R-00001-00000042", contado: false, cheques: 2 });
    expect(efectos).toEqual([
      "Los comprobantes que canceló vuelven a quedar pendientes (también lo que se les aplicó de su saldo a favor).",
      "Sus 2 cheques salen de la cartera: quedan como anulados en su historial.",
      "El número R-00001-00000042 no se vuelve a usar: el recibo queda visible como anulado.",
    ]);
  });

  it("en un pago de contado, la factura vuelve a quedar con el pago pendiente; sin cheques no los menciona", () => {
    const efectos = efectosAnulacion({ numero: "R-00001-00000001", contado: true, cheques: 0 });
    expect(efectos[0]).toBe("La factura de contado vuelve a figurar «Contado – pago pendiente».");
    expect(efectos).toHaveLength(2);
  });

  it("un solo cheque, en singular", () => {
    expect(efectosAnulacion({ numero: "R", contado: false, cheques: 1 })[1]).toBe(
      "Su cheque sale de la cartera: queda como anulado en su historial.",
    );
  });
});

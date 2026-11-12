import { describe, expect, it } from "vitest";
import { mensajeErrorCheque, mensajeErrorCobranza } from "./errores";

describe("mensajeErrorCobranza", () => {
  it("caja en negativo (FN011): muestra el mensaje de la base, que nombra la caja, el saldo y la fecha", () => {
    const mensaje = 'La caja "Caja chica" quedaría en $ -150,00 el 11/11/2026.';
    expect(mensajeErrorCobranza({ code: "FN011", message: mensaje }, "anular el recibo")).toBe(mensaje);
  });

  it("un error desconocido dice qué se intentaba", () => {
    expect(mensajeErrorCobranza({ code: "XX000", message: "se cayó" }, "anular el recibo")).toBe(
      "No se pudo anular el recibo: se cayó",
    );
  });
});

describe("mensajeErrorCheque", () => {
  it("caja en negativo (FN011) llega con el mensaje de la base", () => {
    const mensaje = 'La caja "Caja chica" quedaría en $ -150,00 el 11/11/2026.';
    expect(mensajeErrorCheque({ code: "FN011", message: mensaje }, "cambiar el estado del cheque")).toBe(mensaje);
  });
});

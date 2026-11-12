import { describe, expect, it } from "vitest";
import { mensajeErrorFinanzas, mensajeErrorTransferencia } from "./errores";

describe("mensajeErrorFinanzas", () => {
  it("caja en negativo (FN011): muestra el mensaje de la base, que nombra la caja, el saldo y la fecha", () => {
    const mensaje = 'La caja "Caja chica" quedaría en $ -1.500,00 el 12/11/2026.';
    expect(mensajeErrorFinanzas({ code: "FN011", message: mensaje }, "registrar el ajuste")).toBe(mensaje);
    expect(mensajeErrorFinanzas({ code: "FN011", message: mensaje }, "anular el ajuste")).toBe(mensaje);
    expect(mensajeErrorTransferencia({ code: "FN011", message: mensaje }, "registrar la transferencia")).toBe(mensaje);
    expect(mensajeErrorTransferencia({ code: "FN011", message: mensaje }, "anular la transferencia")).toBe(mensaje);
  });

  it("traduce el nombre repetido", () => {
    expect(
      mensajeErrorFinanzas(
        { code: "23505", message: 'duplicate key value violates unique constraint "cuenta_fondos_nombre_uq"' },
        "guardar la cuenta",
      ),
    ).toBe("Ya existe una cuenta (de banco o de caja) con ese nombre.");
  });

  it("traduce los errores propios de la base", () => {
    expect(mensajeErrorFinanzas({ code: "FN004", message: "x" }, "registrar el ajuste")).toBe(
      "La cuenta está inactiva: no admite ajustes nuevos.",
    );
    expect(mensajeErrorFinanzas({ code: "FN001", message: "x" }, "anular el ajuste")).toBe(
      "El ajuste ya no se puede modificar. Recargue la página.",
    );
  });

  it("deja el detalle para los errores desconocidos", () => {
    expect(mensajeErrorFinanzas({ code: "XX000", message: "falla" }, "guardar la cuenta")).toBe(
      "No se pudo guardar la cuenta: falla",
    );
  });
});

describe("mensajeErrorTransferencia", () => {
  it("traduce los errores de la base hablando de transferencias", () => {
    expect(mensajeErrorTransferencia({ code: "FN010", message: "x" }, "registrar la transferencia")).toBe(
      "La cuenta destino tiene que ser distinta de la de origen.",
    );
    expect(mensajeErrorTransferencia({ code: "FN001", message: "x" }, "anular la transferencia")).toBe(
      "La transferencia ya no se puede modificar. Recargue la página.",
    );
    expect(
      mensajeErrorTransferencia(
        { code: "FN004", message: 'La cuenta "Caja" está inactiva: no admite transferencias nuevas.' },
        "registrar la transferencia",
      ),
    ).toBe('La cuenta "Caja" está inactiva: no admite transferencias nuevas.');
    expect(
      mensajeErrorTransferencia(
        { code: "23514", message: 'new row violates check constraint "transferencia_fondos_importe_check"' },
        "registrar la transferencia",
      ),
    ).toBe("El importe tiene que ser mayor que cero.");
  });

  it("usa los mensajes generales para lo demás", () => {
    expect(mensajeErrorTransferencia({ code: "FN005", message: "x" }, "anular la transferencia")).toBe(
      "El motivo de la anulación es obligatorio.",
    );
    expect(mensajeErrorTransferencia({ code: "XX000", message: "falla" }, "registrar la transferencia")).toBe(
      "No se pudo registrar la transferencia: falla",
    );
  });
});

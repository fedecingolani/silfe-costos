import { describe, expect, it } from "vitest";
import { mensajeErrorFinanzas } from "./errores";

describe("mensajeErrorFinanzas", () => {
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

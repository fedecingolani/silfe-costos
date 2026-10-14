import { describe, expect, it } from "vitest";
import { mensajeErrorTransporte } from "./errores";

describe("mensajeErrorTransporte", () => {
  it("avisa si ya hay un transporte con ese nombre", () => {
    expect(
      mensajeErrorTransporte("crear", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "transporte_nombre_key"',
      }),
    ).toBe("Ya existe un transporte con ese nombre.");
  });

  it("avisa si el transporte está en uso", () => {
    expect(mensajeErrorTransporte("eliminar", { code: "23503", message: "violates foreign key" })).toBe(
      "El transporte está asignado a clientes o sucursales: desactivalo en lugar de borrarlo.",
    );
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorTransporte("actualizar", { message: "sin conexión" })).toBe(
      "No se pudo actualizar el transporte: sin conexión",
    );
  });
});

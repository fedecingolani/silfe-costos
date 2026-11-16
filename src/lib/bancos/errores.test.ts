import { describe, expect, it } from "vitest";
import { MENSAJE_BANCO_EN_CHEQUES, mensajeErrorBanco } from "./errores";

describe("mensajeErrorBanco", () => {
  it("avisa si ya hay un banco con el mismo nombre", () => {
    expect(
      mensajeErrorBanco("crear", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "banco_nombre_key"',
      }),
    ).toBe("Ya existe un banco con ese nombre.");
  });

  it("avisa si hay un banco activo que sólo difiere en mayúsculas, tildes o espacios", () => {
    expect(
      mensajeErrorBanco("actualizar", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "banco_nombre_clave_uq"',
      }),
    ).toBe("Ya existe un banco activo con ese nombre (sin contar mayúsculas, tildes ni espacios).");
  });

  it("no deja renombrar un banco usado en cheques", () => {
    expect(
      mensajeErrorBanco("actualizar", {
        code: "23503",
        message:
          'update or delete on table "banco" violates foreign key constraint "cheque_banco_fkey" on table "cheque"',
      }),
    ).toBe(MENSAJE_BANCO_EN_CHEQUES);
    expect(MENSAJE_BANCO_EN_CHEQUES).toBe(
      "Este banco está en cheques cargados: no se puede renombrar. Desactivalo y creá otro.",
    );
  });

  it("traduce el nombre vacío", () => {
    expect(
      mensajeErrorBanco("crear", {
        code: "23514",
        message: 'new row for relation "banco" violates check constraint "banco_nombre_check"',
      }),
    ).toBe("El nombre del banco es obligatorio.");
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorBanco("actualizar", { message: "sin conexión" })).toBe(
      "No se pudo actualizar el banco: sin conexión",
    );
  });
});

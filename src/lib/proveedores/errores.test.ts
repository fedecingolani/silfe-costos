import { describe, expect, it } from "vitest";
import { mensajeErrorArticulo, mensajeErrorProveedor } from "./errores";

describe("mensajeErrorProveedor", () => {
  it("avisa si ya hay un proveedor con ese nombre", () => {
    expect(
      mensajeErrorProveedor("crear", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "proveedor_nombre_uq"',
      }),
    ).toBe("Ya existe un proveedor con ese nombre.");
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorProveedor("actualizar", { message: "sin conexión" })).toBe(
      "No se pudo actualizar el proveedor: sin conexión",
    );
  });
});

describe("mensajeErrorArticulo", () => {
  it("traduce el código repetido", () => {
    expect(
      mensajeErrorArticulo("agregar", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "proveedor_articulo_codigo_uq"',
      }),
    ).toBe("Este proveedor ya tiene un artículo con ese código.");
  });

  it("traduce la descripción repetida sin código", () => {
    expect(
      mensajeErrorArticulo("agregar", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "proveedor_articulo_descripcion_uq"',
      }),
    ).toBe("Este proveedor ya tiene un artículo sin código con esa descripción.");
  });

  it("avisa si el artículo está en uso", () => {
    expect(mensajeErrorArticulo("eliminar", { code: "23503", message: "violates foreign key" })).toBe(
      "El artículo se usa en comprobantes o remitos: hay que desactivarlo en lugar de borrarlo.",
    );
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorArticulo("actualizar", { message: "sin conexión" })).toBe(
      "No se pudo actualizar el artículo: sin conexión",
    );
  });
});

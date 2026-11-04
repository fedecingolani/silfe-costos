import { describe, expect, it } from "vitest";
import { mensajeErrorRemito } from "./errores";

describe("mensajeErrorRemito", () => {
  it("traduce cada código RM001–RM010 a un mensaje propio", () => {
    const codigos = ["RM001", "RM002", "RM003", "RM004", "RM005", "RM006", "RM007", "RM008", "RM009", "RM010"];
    const mensajes = codigos.map((code) => mensajeErrorRemito({ code, message: "texto de la base" }));
    for (const mensaje of mensajes) expect(mensaje).not.toMatch(/^No se pudo/);
    expect(new Set(mensajes).size).toBeGreaterThanOrEqual(8);
  });

  it("mensajes clave", () => {
    expect(mensajeErrorRemito({ code: "RM001", message: "x" })).toBe("El remito está anulado: no se puede modificar.");
    expect(mensajeErrorRemito({ code: "RM005", message: "x" })).toBe("Agregá al menos un ítem antes de emitir el remito.");
    expect(mensajeErrorRemito({ code: "RM008", message: "x" })).toBe(
      "El remito tiene cantidades facturadas: no se puede modificar ni anular. Borrá antes los borradores de factura que lo usan.",
    );
  });

  it("una pista o un código que coincide con una clave heredada de Object no rompe el mensaje", () => {
    expect(mensajeErrorRemito({ message: "x", hint: "constructor" })).toBe("No se pudo guardar el remito: x");
    expect(mensajeErrorRemito({ code: "toString", message: "x" })).toBe("No se pudo guardar el remito: x");
  });

  it("si sólo llega la pista (hint), la usa", () => {
    expect(mensajeErrorRemito({ message: "x", hint: "remito_anulado_inmutable" })).toBe(
      "El remito está anulado: no se puede modificar.",
    );
    expect(mensajeErrorRemito({ message: "x", hint: "remito_facturado" })).toBe(
      mensajeErrorRemito({ code: "RM008", message: "x" }),
    );
  });

  it("RM009 y RM010 muestran el mensaje de la base, que dice el ítem y las cantidades", () => {
    const base = 'Del ítem "Lona" del remito R-00001-00000003 quedan 200 pendientes: no se pueden facturar 300.';
    expect(mensajeErrorRemito({ code: "RM010", message: base })).toBe(base);
    expect(mensajeErrorRemito({ code: "RM009", message: "Los remitos son de clientes distintos." })).toBe(
      "Los remitos son de clientes distintos.",
    );
    expect(mensajeErrorRemito({ message: base, hint: "excede_pendiente" })).toBe(base);
  });

  it("errores de la factura generada (CMxxx) llevan el contexto", () => {
    expect(mensajeErrorRemito({ code: "CM008", message: "La letra no corresponde." }, "facturar los remitos")).toBe(
      "No se pudo facturar los remitos: La letra no corresponde.",
    );
  });

  it("controles de tabla y claves foráneas", () => {
    expect(mensajeErrorRemito({ code: "23514", message: 'violates check constraint "remito_item_bultos_check"' })).toBe(
      "Los bultos de cada ítem tienen que ser un número entero, 0 o más.",
    );
    expect(
      mensajeErrorRemito({ code: "23514", message: 'violates check constraint "remito_valor_declarado_check"' }),
    ).toBe("El valor declarado no puede ser negativo.");
    expect(mensajeErrorRemito({ code: "23503", message: "fk" })).toBe(
      "El cliente, el transporte, la lista de precios, el punto de venta o un producto ya no existen. Recargá la página.",
    );
  });

  it("un error desconocido dice qué se intentaba", () => {
    expect(mensajeErrorRemito({ code: "XX000", message: "se cayó" })).toBe("No se pudo guardar el remito: se cayó");
    expect(mensajeErrorRemito({ message: "se cayó" }, "emitir el remito")).toBe("No se pudo emitir el remito: se cayó");
  });
});

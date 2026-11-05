import { describe, expect, it } from "vitest";
import { mensajeErrorRemitoCompra } from "./errores";

describe("mensajeErrorRemitoCompra", () => {
  it("traduce cada código RC001–RC011 a un mensaje propio", () => {
    const codigos = [
      "RC001", "RC002", "RC003", "RC004", "RC005", "RC006",
      "RC007", "RC008", "RC009", "RC010", "RC011",
    ];
    const mensajes = codigos.map((code) => mensajeErrorRemitoCompra({ code, message: "texto de la base" }));
    for (const mensaje of mensajes) expect(mensaje).not.toMatch(/^No se pudo/);
    expect(new Set(mensajes).size).toBe(codigos.length);
  });

  it("si sólo llega la pista (hint), da el mismo mensaje que el código", () => {
    const pares: [string, string][] = [
      ["RC001", "remito_inmutable"],
      ["RC002", "transicion_invalida"],
      ["RC003", "borrado_no_permitido"],
      ["RC004", "remito_inexistente"],
      ["RC005", "remito_sin_items"],
      ["RC006", "articulo_de_otro_proveedor"],
      ["RC007", "articulo_sin_materia_prima"],
      ["RC008", "remito_facturado"],
      ["RC009", "facturacion_invalida"],
      ["RC010", "excede_pendiente"],
      ["RC011", "renglon_sin_articulo"],
    ];
    for (const [code, hint] of pares) {
      expect(mensajeErrorRemitoCompra({ message: "x", hint })).toBe(mensajeErrorRemitoCompra({ code, message: "x" }));
    }
  });

  it("RC007 y RC010 muestran el mensaje de la base, que dice qué renglón", () => {
    const sinMp = 'El artículo "SOGA PP diam 8MM" no tiene materia prima asociada.';
    expect(mensajeErrorRemitoCompra({ code: "RC007", message: sinMp })).toBe(
      `${sinMp} Asociala en el catálogo del proveedor.`,
    );
    const excede = 'Del renglón "Soga" del remito 00009-00000001 quedan 4 pendientes: no se pueden facturar 5.';
    expect(mensajeErrorRemitoCompra({ code: "RC010", message: excede })).toBe(excede);
    expect(mensajeErrorRemitoCompra({ hint: "excede_pendiente", message: excede })).toBe(excede);
  });

  it("número repetido y claves foráneas", () => {
    expect(
      mensajeErrorRemitoCompra({
        code: "23505",
        message: 'duplicate key value violates unique constraint "remito_compra_numero_unico"',
      }),
    ).toBe("Ese remito de ese proveedor ya está cargado.");
    expect(mensajeErrorRemitoCompra({ code: "23503", message: "fk" })).toBe(
      "El proveedor, un artículo o una materia prima ya no existen. Recargá la página.",
    );
  });

  it("controles de tabla", () => {
    expect(
      mensajeErrorRemitoCompra({ code: "23514", message: 'violates check constraint "remito_compra_punto_venta_check"' }),
    ).toBe("El punto de venta va de 1 a 99999.");
    expect(
      mensajeErrorRemitoCompra({ code: "23514", message: 'violates check constraint "remito_compra_item_cantidad_check"' }),
    ).toBe("Revisá los renglones: cada uno lleva descripción y una cantidad mayor que cero.");
  });

  it("una pista o un código que coincide con una clave heredada de Object no rompe el mensaje", () => {
    expect(mensajeErrorRemitoCompra({ message: "x", hint: "constructor" })).toBe("No se pudo guardar el remito: x");
    expect(mensajeErrorRemitoCompra({ code: "toString", message: "x" })).toBe("No se pudo guardar el remito: x");
  });

  it("un error desconocido dice qué se intentaba", () => {
    expect(mensajeErrorRemitoCompra({ code: "XX000", message: "se cayó" }, "recibir el remito")).toBe(
      "No se pudo recibir el remito: se cayó",
    );
  });
});

import { describe, expect, it } from "vitest";
import { mensajeErrorComprobanteCompra } from "./errores";

describe("mensajeErrorComprobanteCompra", () => {
  it("traduce cada código CP001–CP011 a un mensaje propio", () => {
    const codigos = ["CP001", "CP002", "CP003", "CP004", "CP005", "CP006", "CP007", "CP008", "CP009", "CP010", "CP011"];
    const mensajes = codigos.map((code) => mensajeErrorComprobanteCompra({ code, message: "texto de la base" }));
    for (const mensaje of mensajes) expect(mensaje).not.toMatch(/^No se pudo/);
    expect(new Set(mensajes).size).toBe(codigos.length);
  });

  it("si sólo llega la pista (hint), da el mismo mensaje que el código", () => {
    const pares: [string, string][] = [
      ["CP001", "comprobante_inmutable"],
      ["CP002", "transicion_invalida"],
      ["CP003", "borrado_no_permitido"],
      ["CP004", "comprobante_inexistente"],
      ["CP005", "comprobante_sin_items"],
      ["CP006", "total_no_positivo"],
      ["CP007", "articulo_sin_materia_prima"],
      ["CP008", "articulo_de_otro_proveedor"],
      ["CP009", "alicuota_no_discriminada"],
    ];
    for (const [code, hint] of pares) {
      expect(mensajeErrorComprobanteCompra({ message: "x", hint })).toBe(mensajeErrorComprobanteCompra({ code, message: "x" }));
    }
  });

  it("CP007 muestra el mensaje de la base, que dice qué artículo", () => {
    const base = 'El artículo "SOGA PP diam 8MM" no tiene materia prima asociada.';
    expect(mensajeErrorComprobanteCompra({ code: "CP007", message: base })).toBe(
      `${base} Asociala en el catálogo del proveedor.`,
    );
  });

  it("CP011 muestra el mensaje de la base, que dice qué materia prima", () => {
    const base = 'Elegiste dos renglones de "Malla": el precio se actualiza con uno solo.';
    expect(mensajeErrorComprobanteCompra({ code: "CP011", message: base })).toBe(base);
    expect(mensajeErrorComprobanteCompra({ hint: "materia_prima_repetida", message: base })).toBe(base);
  });

  it("número repetido y claves foráneas", () => {
    expect(
      mensajeErrorComprobanteCompra({
        code: "23505",
        message: 'duplicate key value violates unique constraint "comprobante_compra_numero_unico"',
      }),
    ).toBe("Ese comprobante de ese proveedor ya está cargado.");
    expect(mensajeErrorComprobanteCompra({ code: "23503", message: "fk" })).toBe(
      "El proveedor, un artículo o una materia prima ya no existen. Recargá la página.",
    );
  });

  it("controles de tabla", () => {
    expect(
      mensajeErrorComprobanteCompra({
        code: "23514",
        message: 'violates check constraint "comprobante_compra_percepcion_jurisdiccion_check"',
      }),
    ).toBe("Indicá la jurisdicción de cada percepción de ingresos brutos.");
    expect(
      mensajeErrorComprobanteCompra({ code: "23514", message: 'violates check constraint "comprobante_compra_vencimiento_check"' }),
    ).toBe("El vencimiento no puede ser anterior a la fecha del comprobante.");
    expect(
      mensajeErrorComprobanteCompra({ code: "23514", message: 'violates check constraint "comprobante_compra_item_cantidad_check"' }),
    ).toBe("Revisá los renglones: hay datos que no son válidos.");
  });

  it("una pista o un código que coincide con una clave heredada de Object no rompe el mensaje", () => {
    expect(mensajeErrorComprobanteCompra({ message: "x", hint: "constructor" })).toBe("No se pudo guardar el comprobante: x");
    expect(mensajeErrorComprobanteCompra({ code: "toString", message: "x" })).toBe("No se pudo guardar el comprobante: x");
  });

  it("un error desconocido dice qué se intentaba", () => {
    expect(mensajeErrorComprobanteCompra({ code: "XX000", message: "se cayó" }, "confirmar el comprobante")).toBe(
      "No se pudo confirmar el comprobante: se cayó",
    );
  });
});

import { describe, expect, it } from "vitest";
import { mensajeErrorOrdenPago } from "./errores";

const CODIGOS: [code: string, hint: string][] = [
  ["OP001", "orden_pago_inmutable"],
  ["OP002", "transicion_invalida"],
  ["OP003", "orden_pago_sin_medios"],
  ["OP004", "total_distinto_medios"],
  ["OP005", "imputacion_excede_credito"],
  ["OP006", "imputacion_excede_saldo"],
  ["OP007", "debito_invalido"],
  ["OP008", "proveedor_distinto"],
  ["OP009", "cheque_no_disponible"],
  ["OP010", "cheque_no_devolvible"],
  ["OP011", "medio_invalido"],
  ["OP012", "orden_pago_inexistente"],
  ["OP013", "numeracion_invalida"],
  ["OP014", "credito_invalido"],
  ["OP015", "motivo_requerido"],
  ["OP016", "comprobante_con_imputaciones"],
  ["OP017", "cheque_vinculo_invalido"],
];

describe("mensajeErrorOrdenPago", () => {
  it("traduce cada código OP001–OP017 a un mensaje propio (salvo los que muestran el de la base)", () => {
    const propios = CODIGOS.filter(([code]) => !["OP006", "OP007", "OP009", "OP010"].includes(code));
    const mensajes = propios.map(([code]) => mensajeErrorOrdenPago({ code, message: "texto de la base" }));
    for (const mensaje of mensajes) expect(mensaje).not.toMatch(/^No se pudo/);
    expect(new Set(mensajes).size).toBe(propios.length);
  });

  it("si sólo llega la pista (hint), da el mismo mensaje que el código", () => {
    for (const [code, hint] of CODIGOS) {
      expect(mensajeErrorOrdenPago({ message: "x", hint })).toBe(mensajeErrorOrdenPago({ code, message: "x" }));
    }
  });

  it("OP006, OP007, OP009 y OP010 muestran el mensaje de la base, que dice qué comprobante o qué cheque", () => {
    const casos: [string, string][] = [
      ["OP006", "Las imputaciones superan el saldo pendiente de FC A 00003-00012345."],
      ["OP007", "La orden de pago imputa a FC A 00003-00012345 (está anulado): sólo se pagan facturas y notas de débito confirmadas."],
      ["OP009", "El cheque N° 123 (Nación) ya no está en la cartera."],
      ["OP010", "El cheque N° 123 (Nación) está rechazado: la orden de pago no se puede anular."],
    ];
    for (const [code, message] of casos) {
      expect(mensajeErrorOrdenPago({ code, message })).toBe(message);
    }
  });

  it("controles de los medios de pago (23514)", () => {
    expect(
      mensajeErrorOrdenPago({ code: "23514", message: 'violates check constraint "orden_pago_medio_cheque_propio_check"' }),
    ).toBe("Cada cheque propio lleva banco, número y fecha de pago.");
    expect(
      mensajeErrorOrdenPago({ code: "23514", message: 'violates check constraint "orden_pago_medio_tipo_check"' }),
    ).toBe("Revisá los medios de pago: hay datos que no son válidos.");
  });

  it("claves foráneas y concurrencia", () => {
    expect(mensajeErrorOrdenPago({ code: "23503", message: "fk" })).toBe(
      "El proveedor, un comprobante o un cheque ya no existen. Recargá la página.",
    );
    expect(mensajeErrorOrdenPago({ code: "40P01", message: "deadlock detected" })).toBe(
      "Otra persona estaba usando los mismos comprobantes o cheques. Probá de nuevo.",
    );
  });

  it("una pista o un código que coincide con una clave heredada de Object no rompe el mensaje", () => {
    expect(mensajeErrorOrdenPago({ message: "x", hint: "constructor" })).toBe("No se pudo guardar la orden de pago: x");
  });

  it("un error desconocido dice qué se intentaba", () => {
    expect(mensajeErrorOrdenPago({ code: "XX000", message: "se cayó" }, "confirmar la orden de pago")).toBe(
      "No se pudo confirmar la orden de pago: se cayó",
    );
  });
});

import { describe, expect, it } from "vitest";
import { asociadoManual } from "./asociados";

const completo = { tipo_arca: 1, punto_venta: 7, numero: 157, fecha: "2026-09-30", cuit: "23334771229" };

describe("asociadoManual", () => {
  it("arma el CbteAsoc de un comprobante cargado a mano", () => {
    expect(asociadoManual(completo)).toEqual({
      tipo: 1,
      puntoVenta: 7,
      numero: 157,
      fecha: "2026-09-30",
      cuit: "23334771229",
    });
  });

  it("acepta los números que llegan de Postgres como texto (bigint)", () => {
    expect(asociadoManual({ ...completo, numero: "157" }).numero).toBe(157);
  });

  it.each([
    ["sin tipo", { tipo_arca: null }, "tipo"],
    ["con un tipo que no es de ARCA", { tipo_arca: 11 }, "tipo"],
    ["sin punto de venta", { punto_venta: null }, "punto de venta"],
    ["con punto de venta fuera de rango", { punto_venta: 100000 }, "punto de venta"],
    ["sin número", { numero: null }, "número"],
    ["con número cero", { numero: 0 }, "número"],
    ["con número no entero", { numero: 1.5 }, "número"],
    ["sin fecha", { fecha: null }, "fecha"],
    ["con fecha mal formada", { fecha: "30/09/2026" }, "fecha"],
    ["con una fecha que no existe", { fecha: "2026-02-30" }, "fecha"],
    ["sin CUIT", { cuit: null }, "CUIT del emisor"],
  ])("rechaza un asociado %s, con un mensaje legible", (_caso, cambio, falta) => {
    expect(() => asociadoManual({ ...completo, ...cambio })).toThrow(
      `El comprobante asociado cargado a mano está incompleto. Revisá: ${falta}.`,
    );
  });

  it("junta todos los datos que faltan en un solo mensaje", () => {
    expect(() => asociadoManual({ tipo_arca: 1, punto_venta: 7, numero: null, fecha: null, cuit: "23334771229" })).toThrow(
      "El comprobante asociado cargado a mano está incompleto. Revisá: número, fecha.",
    );
  });
});

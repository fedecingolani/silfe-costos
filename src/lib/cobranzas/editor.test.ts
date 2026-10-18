import { describe, expect, it } from "vitest";
import { avisoDeParametro, erroresImporteImputado, leerImputacionesEditor } from "./editor";

describe("leerImputacionesEditor", () => {
  it("convierte los importes escritos, con coma o punto", () => {
    expect(leerImputacionesEditor({ a: "60", b: "40,5", c: " 10.25 " })).toEqual([
      { comprobanteId: "a", importe: 60 },
      { comprobanteId: "b", importe: 40.5 },
      { comprobanteId: "c", importe: 10.25 },
    ]);
  });

  it("ignora los vacíos y los ceros (el comprobante no se imputa)", () => {
    expect(leerImputacionesEditor({ a: "", b: "  ", c: "0", d: "0,00" })).toEqual([]);
  });

  it("conserva como NaN lo que no es un número, en lugar de tomarlo como 0", () => {
    const leidas = leerImputacionesEditor({ a: "12abc", b: "50" });
    expect(leidas).toHaveLength(2);
    expect(leidas[0].comprobanteId).toBe("a");
    expect(Number.isNaN(leidas[0].importe)).toBe(true);
    expect(leidas[1]).toEqual({ comprobanteId: "b", importe: 50 });
  });

  it("mantiene los negativos para que la validación los rechace", () => {
    expect(leerImputacionesEditor({ a: "-5" })).toEqual([{ comprobanteId: "a", importe: -5 }]);
  });
});

describe("erroresImporteImputado", () => {
  it("nombra el comprobante cuyo importe no es un número", () => {
    const nombres = new Map([["a", "Factura A 00001-00000012"]]);
    expect(erroresImporteImputado([{ comprobanteId: "a", importe: Number.NaN }], nombres)).toEqual([
      "El importe a imputar de Factura A 00001-00000012 no es un número válido.",
    ]);
  });

  it("usa un nombre genérico si el comprobante no está en la lista", () => {
    expect(erroresImporteImputado([{ comprobanteId: "x", importe: Number.NaN }], new Map())).toEqual([
      "El importe a imputar de un comprobante no es un número válido.",
    ]);
  });

  it("no dice nada de los importes válidos", () => {
    expect(erroresImporteImputado([{ comprobanteId: "a", importe: 10 }], new Map())).toEqual([]);
  });
});

describe("avisoDeParametro", () => {
  it("traduce los avisos conocidos que llegan por la URL", () => {
    expect(avisoDeParametro("guardado")).toBe("Borrador guardado.");
    expect(avisoDeParametro("emitido")).toBe("Recibo emitido.");
    expect(avisoDeParametro("anulado")).toBe("Recibo anulado.");
  });

  it("ignora cualquier otro valor (no muestra texto arbitrario de la URL)", () => {
    expect(avisoDeParametro("<script>")).toBeNull();
    expect(avisoDeParametro(undefined)).toBeNull();
    expect(avisoDeParametro(["guardado"])).toBeNull();
  });
});

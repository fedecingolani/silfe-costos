import { describe, expect, it } from "vitest";
import { SIN_NUMERO_REMITO, numeroRemito, numeroVisibleRemito } from "./numero";

describe("numeroRemito", () => {
  it("formatea R-<punto de venta de 5>-<número de 8>", () => {
    expect(numeroRemito(1, 1)).toBe("R-00001-00000001");
    expect(numeroRemito(12, 3456)).toBe("R-00012-00003456");
  });

  it("acepta el número como texto (bigint de Postgres)", () => {
    expect(numeroRemito(3, "17")).toBe("R-00003-00000017");
  });
});

describe("numeroVisibleRemito", () => {
  it("con número, el formateado", () => {
    expect(numeroVisibleRemito({ punto_venta: 2, numero: 9 })).toBe("R-00002-00000009");
  });

  it("un borrador sin número muestra el texto de borrador", () => {
    expect(numeroVisibleRemito({ punto_venta: 2, numero: null })).toBe(SIN_NUMERO_REMITO);
    expect(SIN_NUMERO_REMITO).toBe("Sin número");
  });
});

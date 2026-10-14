import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { generarExcel } from "./excel";
import { datosDeReferencia } from "./fixtures";

function leer(bytes: Uint8Array) {
  const libro = XLSX.read(bytes, { type: "array", cellNF: true });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return { libro, hoja };
}

describe("generarExcel", () => {
  it("devuelve un libro con una hoja", () => {
    const bytes = generarExcel(datosDeReferencia);
    expect(bytes).toBeInstanceOf(Uint8Array);
    // Un .xlsx es un zip: empieza con "PK".
    expect(Buffer.from(bytes.slice(0, 2)).toString("latin1")).toBe("PK");
    expect(leer(bytes).libro.SheetNames).toHaveLength(1);
  });

  it("pone el título en A1 y los encabezados en la fila 3", () => {
    const { hoja } = leer(generarExcel(datosDeReferencia));
    expect(hoja.A1.v).toBe("LISTA DE PRECIOS DICIEMBRE 2023");
    expect(["A3", "B3", "C3", "D3", "E3", "F3"].map((c) => hoja[c].v)).toEqual([
      "Código",
      "Descripción",
      "Presentación",
      "Precio sin IVA",
      "IVA %",
      "Repuesto",
    ]);
  });

  it("guarda el precio y el IVA como números", () => {
    const { hoja } = leer(generarExcel(datosDeReferencia));
    expect(hoja.A4.v).toBe("001");
    expect(hoja.D4).toMatchObject({ t: "n", v: 24500, z: "#,##0.00" });
    expect(hoja.E4).toMatchObject({ t: "n", v: 21 });
    expect(hoja.F4.v).toBe("No");

    expect(hoja.C6.v).toBe("Docena");
    expect(hoja.D6).toMatchObject({ t: "n", v: 9750.5 });
    expect(hoja.E6).toMatchObject({ t: "n", v: 10.5 });
    expect(hoja.F6.v).toBe("Sí");
  });

  it("deja vacíos el código y la presentación que faltan", () => {
    const { hoja } = leer(generarExcel(datosDeReferencia));
    const ultima = 3 + datosDeReferencia.items.length;
    expect(hoja[`A${ultima}`]?.v ?? "").toBe("");
    expect(hoja[`B${ultima}`].v).toBe("Flete a cargo del cliente – consultar");
    expect(hoja[`C${ultima}`]?.v ?? "").toBe("");
    expect(hoja["!ref"]).toBe(`A1:F${ultima}`);
  });
});

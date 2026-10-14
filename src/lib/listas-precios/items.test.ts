import { describe, expect, it } from "vitest";
import { productosEnviados, validarItems, type ItemListaEnviado } from "./items";

const PRODUCTO = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTRO = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function item(cambios: Partial<Record<keyof ItemListaEnviado, unknown>> = {}) {
  return {
    es_repuesto: false,
    producto_id: PRODUCTO,
    codigo: "001",
    descripcion: "Recolector",
    presentacion: "Unidad",
    alicuota_iva: "21",
    precio_sugerido: 1234.5,
    precio_final: "1300",
    ...cambios,
  };
}

function errores(crudo: unknown, incompletos = new Set<string>()) {
  const resultado = validarItems(crudo, incompletos);
  if (!("errores" in resultado)) throw new Error("Se esperaban errores");
  return resultado.errores;
}

function items(crudo: unknown, incompletos = new Set<string>()) {
  const resultado = validarItems(crudo, incompletos);
  if (!("items" in resultado)) throw new Error(`Errores inesperados: ${resultado.errores.join(" ")}`);
  return resultado.items;
}

describe("validarItems", () => {
  it("exige al menos un ítem", () => {
    expect(errores([])).toEqual(["La lista necesita al menos un ítem."]);
    expect(errores("no es un arreglo")).toEqual(["La lista necesita al menos un ítem."]);
  });

  it("rechaza un ítem que no es un objeto", () => {
    expect(errores([null])[0]).toMatch(/ítem 1 no es válido/);
  });

  it("exige la descripción", () => {
    expect(errores([item({ descripcion: "   " })])[0]).toMatch(/ítem 1 necesita una descripción/);
  });

  it.each(["", "abc", "NaN", "Infinity", "-Infinity", "-1"])(
    "rechaza el precio final %j",
    (precio) => {
      expect(errores([item({ precio_final: precio })])[0]).toMatch(/precio final mayor o igual a 0/);
    },
  );

  it("rechaza un precio final numérico no finito", () => {
    expect(errores([item({ precio_final: Number.NaN })])[0]).toMatch(/precio final/);
    expect(errores([item({ precio_final: Number.POSITIVE_INFINITY })])[0]).toMatch(/precio final/);
  });

  it("acepta coma decimal y precio 0 en un ítem completo", () => {
    expect(items([item({ precio_final: "9750,5" })])[0].precio_final).toBe(9750.5);
    expect(items([item({ precio_final: "0" })])[0].precio_final).toBe(0);
  });

  it("usa IVA 21 por defecto y exige que esté entre 0 y 100", () => {
    expect(items([item({ alicuota_iva: "" })])[0].alicuota_iva).toBe(21);
    expect(items([item({ alicuota_iva: "10,5" })])[0].alicuota_iva).toBe(10.5);
    expect(items([item({ alicuota_iva: "0" })])[0].alicuota_iva).toBe(0);
    expect(items([item({ alicuota_iva: "100" })])[0].alicuota_iva).toBe(100);
    for (const iva of ["-1", "100.01", "abc", "NaN"]) {
      expect(errores([item({ alicuota_iva: iva })])[0]).toMatch(/IVA .* entre 0 y 100/);
    }
  });

  it("numera el orden 1..n según la posición", () => {
    const resultado = items([item(), item({ descripcion: "B" }), item({ descripcion: "C" })]);
    expect(resultado.map((i) => i.orden)).toEqual([1, 2, 3]);
  });

  it("deja sin precio sugerido los ítems manuales", () => {
    const [manual] = items([item({ producto_id: null, precio_sugerido: 500 })]);
    expect(manual.producto_id).toBeNull();
    expect(manual.precio_sugerido).toBeNull();
  });

  it("conserva el precio sugerido finito de un producto y descarta uno inválido", () => {
    expect(items([item()])[0].precio_sugerido).toBe(1234.5);
    expect(items([item({ precio_sugerido: Number.NaN })])[0].precio_sugerido).toBeNull();
    expect(items([item({ precio_sugerido: -1 })])[0].precio_sugerido).toBeNull();
  });

  it("rechaza un producto_id inválido en lugar de anularlo", () => {
    expect(errores([item({ producto_id: "no-es-un-uuid" })])[0]).toMatch(/producto inválido/);
    expect(errores([item({ producto_id: 42 })])[0]).toMatch(/producto inválido/);
  });

  it("exige precio mayor a 0 en los productos con costos incompletos", () => {
    const incompletos = new Set([PRODUCTO]);
    expect(errores([item({ precio_final: "0" })], incompletos)[0]).toMatch(/costos incompletos/);
    expect(items([item({ precio_final: "1" })], incompletos)[0].precio_final).toBe(1);
    expect(items([item({ producto_id: OTRO, precio_final: "0" })], incompletos)[0].precio_final).toBe(0);
  });

  it("recorta los textos y deja null los opcionales vacíos", () => {
    const [it0] = items([item({ codigo: "  ", presentacion: " Docena ", descripcion: " A " })]);
    expect(it0.codigo).toBeNull();
    expect(it0.presentacion).toBe("Docena");
    expect(it0.descripcion).toBe("A");
  });

  it("junta los errores de todos los ítems", () => {
    expect(errores([item({ descripcion: "" }), item({ precio_final: "-1" })])).toHaveLength(2);
  });
});

describe("productosEnviados", () => {
  it("devuelve los producto_id válidos sin repetir", () => {
    expect(
      productosEnviados([item(), item(), item({ producto_id: null }), item({ producto_id: "x" }), item({ producto_id: OTRO })]),
    ).toEqual([PRODUCTO, OTRO]);
  });

  it("devuelve vacío si no es un arreglo", () => {
    expect(productosEnviados({})).toEqual([]);
  });
});

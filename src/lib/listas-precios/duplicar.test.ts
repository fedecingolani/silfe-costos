import { describe, expect, it } from "vitest";
import { filasDeDuplicado } from "./duplicar";
import type { ListaPrecioItem } from "@/lib/tipos";

const ACTIVO = "0f8fad5b-d9cb-469f-a165-70867728950e";
const INCOMPLETO = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const INACTIVO = "16fd2706-8baf-433b-82eb-8c7fada847da";

function itemGuardado(cambios: Partial<ListaPrecioItem>): ListaPrecioItem {
  return {
    id: `item-${cambios.orden ?? 1}`,
    lista_id: "lista",
    orden: 1,
    es_repuesto: false,
    producto_id: ACTIVO,
    codigo: "001",
    descripcion: "Recolector (editado)",
    presentacion: "Docena",
    alicuota_iva: 10.5,
    precio_sugerido: 1000,
    precio_final: 1100,
    ...cambios,
  };
}

const base = [
  { producto_id: ACTIVO, precio_sugerido: 1500, costos_incompletos: false },
  { producto_id: INCOMPLETO, precio_sugerido: 0, costos_incompletos: true },
];

describe("filasDeDuplicado", () => {
  it("conserva los datos editados y toma el sugerido actual del producto", () => {
    const [fila] = filasDeDuplicado([itemGuardado({})], base);
    expect(fila).toMatchObject({
      clave: "item-1",
      es_repuesto: false,
      producto_id: ACTIVO,
      codigo: "001",
      descripcion: "Recolector (editado)",
      presentacion: "Docena",
      alicuota_iva: "10.5",
      precio_final: "1100",
      precio_sugerido: 1500,
      costos_incompletos: false,
      producto_no_disponible: false,
    });
  });

  it("marca los costos incompletos actuales sin tocar el precio final", () => {
    const [fila] = filasDeDuplicado(
      [itemGuardado({ producto_id: INCOMPLETO, precio_sugerido: 800, precio_final: 900 })],
      base,
    );
    expect(fila.costos_incompletos).toBe(true);
    expect(fila.precio_sugerido).toBe(0);
    expect(fila.precio_final).toBe("900");
  });

  it("conserva la foto y marca un producto que ya no está en la base", () => {
    const [fila] = filasDeDuplicado(
      [itemGuardado({ producto_id: INACTIVO, precio_sugerido: 700, precio_final: 750 })],
      base,
    );
    expect(fila.producto_no_disponible).toBe(true);
    expect(fila.precio_sugerido).toBe(700);
    expect(fila.precio_final).toBe("750");
    expect(fila.costos_incompletos).toBe(false);
  });

  it("deja los ítems manuales como estaban", () => {
    const [fila] = filasDeDuplicado(
      [itemGuardado({ producto_id: null, codigo: null, presentacion: null, precio_sugerido: null, precio_final: 0 })],
      base,
    );
    expect(fila).toMatchObject({
      producto_id: null,
      codigo: "",
      presentacion: "",
      precio_sugerido: null,
      precio_final: "0",
      costos_incompletos: false,
      producto_no_disponible: false,
    });
  });

  it("respeta el orden guardado", () => {
    const filas = filasDeDuplicado(
      [
        itemGuardado({ orden: 3, descripcion: "C" }),
        itemGuardado({ orden: 1, descripcion: "A" }),
        itemGuardado({ orden: 2, descripcion: "B" }),
      ],
      base,
    );
    expect(filas.map((f) => f.descripcion)).toEqual(["A", "B", "C"]);
  });

  it("usa la primera fila de la base cuando un repuesto aparece varias veces", () => {
    const [fila] = filasDeDuplicado(
      [itemGuardado({})],
      [...base, { producto_id: ACTIVO, precio_sugerido: 1500, costos_incompletos: false }],
    );
    expect(fila.precio_sugerido).toBe(1500);
  });
});

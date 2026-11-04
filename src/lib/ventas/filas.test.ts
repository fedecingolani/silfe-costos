import { describe, expect, it } from "vitest";
import { NO_GRAVADO } from "@/lib/tipos";
import {
  cambiosAlElegirProducto,
  filaDeItem,
  filaEnviada,
  filaEnviadaConRemito,
  filasIniciales,
  filaVacia,
  type ItemEditable,
  type ProductoVendible,
} from "./filas";

const lona: ProductoVendible = { id: "p1", codigo: "LON-01", nombre: "Lona cosechera", alicuota: 21, alicuotaOriginal: 21 };
const rara: ProductoVendible = { id: "p2", codigo: "RAR-01", nombre: "Rara", alicuota: null, alicuotaOriginal: 7 };

const item = (cambios: Partial<ItemEditable> = {}): ItemEditable => ({
  producto_id: "p1",
  codigo: "LON-01",
  descripcion: "Lona cosechera",
  observaciones: null,
  cantidad: 2,
  precio_unitario: 1500.5,
  descuento_pct: 10,
  gravado: true,
  alicuota_iva: 21,
  ...cambios,
});

describe("filaVacia", () => {
  it("arranca con cantidad 1, precio 0, IVA 21 y una clave nueva cada vez", () => {
    const a = filaVacia();
    const b = filaVacia();
    expect(a).toMatchObject({ libre: false, productoId: null, cantidad: "1", precioUnitario: "0", descuentoPct: "0", alicuotaIva: "21" });
    expect(a.clave).not.toBe(b.clave);
  });
});

describe("filaDeItem", () => {
  it("pasa los números a texto y guarda la alícuota del producto", () => {
    expect(filaDeItem(item(), [lona])).toMatchObject({
      libre: false,
      productoId: "p1",
      codigo: "LON-01",
      alicuotaProducto: "21",
      observaciones: "",
      cantidad: "2",
      precioUnitario: "1500.5",
      descuentoPct: "10",
      alicuotaIva: "21",
      busqueda: "",
      aviso: null,
    });
  });

  it("un no gravado de producto toma la alícuota del catálogo para poder volver a ella", () => {
    const fila = filaDeItem(item({ gravado: false, alicuota_iva: null }), [lona]);
    expect(fila.alicuotaIva).toBe(NO_GRAVADO);
    expect(fila.alicuotaProducto).toBe("21");
  });

  it("con la alícuota fuera de ARCA usa la original; sin el producto en el catálogo, ninguna", () => {
    expect(filaDeItem(item({ producto_id: "p2", gravado: false, alicuota_iva: null }), [rara]).alicuotaProducto).toBe("7");
    expect(filaDeItem(item({ gravado: false, alicuota_iva: null }), []).alicuotaProducto).toBeNull();
  });

  it("un ítem sin producto es libre", () => {
    const fila = filaDeItem(item({ producto_id: null, codigo: null, observaciones: "a medida", alicuota_iva: 10.5 }), []);
    expect(fila).toMatchObject({ libre: true, alicuotaProducto: null, observaciones: "a medida", alicuotaIva: "10.5" });
  });
});

describe("filasIniciales", () => {
  it("sin ítems guardados arranca con un renglón vacío", () => {
    expect(filasIniciales(undefined, [])).toHaveLength(1);
    expect(filasIniciales([], [])[0].productoId).toBeNull();
    expect(filasIniciales([item(), item()], [lona])).toHaveLength(2);
  });
});

describe("cambiosAlElegirProducto", () => {
  it("propone el precio de la lista", () => {
    expect(cambiosAlElegirProducto(lona, new Map([["p1", 900]]))).toEqual({
      productoId: "p1",
      codigo: "LON-01",
      descripcion: "Lona cosechera",
      alicuotaIva: "21",
      alicuotaProducto: "21",
      precioUnitario: "900",
      busqueda: "",
      aviso: null,
    });
  });

  it("fuera de la lista propone 0 y avisa", () => {
    const cambios = cambiosAlElegirProducto(lona, new Map());
    expect(cambios.precioUnitario).toBe("0");
    expect(cambios.aviso).toBe("No está en la lista: cargá el precio.");
  });

  it("con una alícuota que ARCA no acepta, avisa eso primero", () => {
    const cambios = cambiosAlElegirProducto(rara, new Map());
    expect(cambios.alicuotaIva).toBe("7");
    expect(cambios.aviso).toBe("La alícuota del producto (7%) no es una de ARCA: corregila en el producto.");
  });
});

describe("filaEnviada", () => {
  it("deja sólo lo que se envía", () => {
    const fila = { ...filaVacia(), productoId: "p1", codigo: "LON-01", descripcion: "Lona", busqueda: "lo", aviso: "x" };
    expect(filaEnviada(fila)).toEqual({
      productoId: "p1",
      descripcion: "Lona",
      observaciones: "",
      cantidad: "1",
      precioUnitario: "0",
      descuentoPct: "0",
      alicuotaIva: "21",
    });
  });
});

describe("vínculo con remitos en los renglones", () => {
  const ID_1 = "f0000000-0000-0000-0000-000000000001";
  const ID_2 = "f0000000-0000-0000-0000-000000000002";

  it("filaDeItem conserva el vínculo y el número del remito, sin mostrarlo en lo que se envía siempre", () => {
    const fila = filaDeItem(item({ remito_item_id: ID_1, remito_texto: "R-00007-00000001" }), [lona]);
    expect(fila).toMatchObject({ remitoItemId: ID_1, remitoTexto: "R-00007-00000001" });
    expect(filaEnviada(fila)).not.toHaveProperty("remitoItemId");
  });

  it("un ítem sin vínculo no agrega campos al renglón", () => {
    const fila = filaDeItem(item({ remito_item_id: null }), [lona]);
    expect(fila).not.toHaveProperty("remitoItemId");
    expect(filaDeItem(item(), [lona])).not.toHaveProperty("remitoItemId");
  });

  it("filaEnviadaConRemito manda el vínculo, o null si el renglón no tiene", () => {
    expect(filaEnviadaConRemito(filaDeItem(item({ remito_item_id: ID_1 }), [lona])).remitoItemId).toBe(ID_1);
    expect(filaEnviadaConRemito(filaVacia()).remitoItemId).toBeNull();
  });

  it("renglones repetidos y reordenados conservan cada uno su vínculo (R3-004)", () => {
    const filas = filasIniciales([item({ remito_item_id: ID_1, cantidad: 3 }), item({ remito_item_id: ID_2, cantidad: 5 })], [lona]);
    const enviadas = [filas[1], filas[0]].map(filaEnviadaConRemito);
    expect(enviadas.map((f) => [f.cantidad, f.remitoItemId])).toEqual([
      ["5", ID_2],
      ["3", ID_1],
    ]);
  });
});

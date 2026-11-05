import { describe, expect, it } from "vitest";
import type { PrecioComprobanteCompra } from "@/lib/tipos";
import { alternarPrecio, diferenciaPrecio, seleccionInicialPrecios, textoDiferencia } from "./precios";

function linea(id: string, cambios: Partial<PrecioComprobanteCompra> = {}): PrecioComprobanteCompra {
  return {
    comprobante_compra_item_id: id,
    orden: 0,
    descripcion: `Renglón ${id}`,
    materia_prima_id: `mp-${id}`,
    materia_prima_codigo: `MP-${id}`,
    materia_prima_nombre: `Materia ${id}`,
    unidad_compra: "kg",
    precio_factura: 10,
    precio_vigente: 10,
    incluye_iva: false,
    cambio: false,
    ...cambios,
  };
}

describe("seleccionInicialPrecios", () => {
  it("elige sólo los renglones cuyo precio cambió o no tienen precio", () => {
    const lineas = [
      linea("a", { cambio: true }),
      linea("b"),
      linea("c", { precio_vigente: null, cambio: true }),
    ];
    expect([...seleccionInicialPrecios(lineas)]).toEqual(["a", "c"]);
  });

  it("de dos renglones con la misma materia prima elige sólo el primero", () => {
    const lineas = [
      linea("a", { materia_prima_id: "mp", cambio: true }),
      linea("b", { materia_prima_id: "mp", cambio: true }),
    ];
    expect([...seleccionInicialPrecios(lineas)]).toEqual(["a"]);
  });
});

describe("alternarPrecio", () => {
  const lineas = [
    linea("a", { materia_prima_id: "mp" }),
    linea("b", { materia_prima_id: "mp" }),
    linea("c"),
  ];

  it("marca y desmarca un renglón sin tocar la selección anterior", () => {
    const antes = new Set(["c"]);
    const marcado = alternarPrecio(lineas, antes, "a");
    expect([...marcado].sort()).toEqual(["a", "c"]);
    expect([...antes]).toEqual(["c"]);
    expect([...alternarPrecio(lineas, marcado, "a")]).toEqual(["c"]);
  });

  it("al marcar uno, desmarca el otro renglón de la misma materia prima", () => {
    expect([...alternarPrecio(lineas, new Set(["a", "c"]), "b")].sort()).toEqual(["b", "c"]);
  });
});

describe("diferenciaPrecio", () => {
  it("es la variación en % del precio de la factura respecto del vigente", () => {
    expect(diferenciaPrecio(linea("a", { precio_vigente: 80, precio_factura: 100 }))).toBe(25);
    expect(diferenciaPrecio(linea("a", { precio_vigente: 100, precio_factura: 90 }))).toBe(-10);
  });

  it("sin precio vigente (o en cero) no hay diferencia", () => {
    expect(diferenciaPrecio(linea("a", { precio_vigente: null }))).toBeNull();
    expect(diferenciaPrecio(linea("a", { precio_vigente: 0 }))).toBeNull();
  });
});

describe("textoDiferencia", () => {
  it("lleva el signo y un decimal", () => {
    expect(textoDiferencia(25)).toBe("+25%");
    expect(textoDiferencia(-12.345)).toBe("-12,3%");
    expect(textoDiferencia(0)).toBe("0%");
  });

  it("sin diferencia muestra «Nuevo»", () => {
    expect(textoDiferencia(null)).toBe("Nuevo");
  });
});

import { describe, expect, it } from "vitest";
import { ESTADOS_REMITO, type EstadoRemito } from "@/lib/tipos";
import {
  bultosTotal,
  erroresRemito,
  leerBultos,
  leerValorDeclarado,
  permisosRemito,
  puedeAnular,
  puedeBorrar,
  puedeEditar,
  puedeEmitir,
  puedeFacturar,
  puedeImprimir,
  valorDeclaradoAlCambiarItems,
  valorDeclaradoEditado,
  valorDeclaradoInicial,
  valorDeclaradoSugerido,
  volverAlValorSugerido,
  type FilaItemRemitoEnviada,
} from "./editor";

const fila = (cambios: Partial<FilaItemRemitoEnviada> = {}): FilaItemRemitoEnviada => ({
  productoId: null,
  descripcion: "Lona",
  observaciones: "",
  cantidad: "1",
  precioUnitario: "100",
  descuentoPct: "0",
  alicuotaIva: "21",
  bultos: "1",
  ...cambios,
});

describe("leerBultos", () => {
  it("entero 0 o más; vacío es 0", () => {
    expect(leerBultos("3")).toBe(3);
    expect(leerBultos(" 0 ")).toBe(0);
    expect(leerBultos("")).toBe(0);
    expect(leerBultos(5)).toBe(5);
  });

  it("rechaza negativos, decimales y texto", () => {
    expect(leerBultos("-1")).toBeNull();
    expect(leerBultos("1.5")).toBeNull();
    expect(leerBultos("1,5")).toBeNull();
    expect(leerBultos("dos")).toBeNull();
    expect(leerBultos(2.5)).toBeNull();
  });
});

describe("bultosTotal", () => {
  it("suma los bultos de los ítems", () => {
    expect(bultosTotal([fila({ bultos: "3" }), fila({ bultos: "0" }), fila({ bultos: "12" })])).toBe(15);
  });

  it("sin ítems es 0; los bultos inválidos o a medio cargar no suman", () => {
    expect(bultosTotal([])).toBe(0);
    expect(bultosTotal([fila({ bultos: "2" }), fila({ bultos: "" }), fila({ bultos: "-4" }), fila({ bultos: "1.5" })])).toBe(2);
  });

  it("acepta los bultos guardados (números)", () => {
    expect(bultosTotal([{ bultos: 4 }, { bultos: 6 }])).toBe(10);
  });
});

describe("valorDeclaradoSugerido", () => {
  it("es la suma de los importes de los ítems, sin IVA y con descuento", () => {
    expect(
      valorDeclaradoSugerido([
        fila({ cantidad: "2", precioUnitario: "1000,5", descuentoPct: "10" }),
        fila({ cantidad: "1", precioUnitario: "500", alicuotaIva: "no_gravado" }),
      ]),
    ).toBe(2300.9);
  });

  it("no arrastra errores de coma flotante", () => {
    expect(valorDeclaradoSugerido([fila({ precioUnitario: "0.1" }), fila({ precioUnitario: "0.2" })])).toBe(0.3);
  });

  it("ignora los renglones a medio cargar", () => {
    expect(valorDeclaradoSugerido([fila({ precioUnitario: "50" }), fila({ cantidad: "" }), fila({ alicuotaIva: "" })])).toBe(50);
    expect(valorDeclaradoSugerido([])).toBe(0);
  });
});

describe("valor declarado: sigue a la sugerencia hasta que se edita", () => {
  const items = [fila({ cantidad: "2", precioUnitario: "100" })];

  it("al empezar sigue a la sugerencia", () => {
    expect(valorDeclaradoInicial(items)).toEqual({ valor: "200.00", manual: false });
    expect(valorDeclaradoInicial([])).toEqual({ valor: "0.00", manual: false });
  });

  it("mientras no se tocó, sigue a los ítems cuando cambian", () => {
    const inicial = valorDeclaradoInicial(items);
    const otros = [...items, fila({ precioUnitario: "50,25" })];
    expect(valorDeclaradoAlCambiarItems(inicial, otros)).toEqual({ valor: "250.25", manual: false });
  });

  it("una vez editado queda fijo aunque cambien los ítems", () => {
    const editado = valorDeclaradoEditado("1000");
    expect(editado).toEqual({ valor: "1000", manual: true });
    expect(valorDeclaradoAlCambiarItems(editado, [...items, fila({ precioUnitario: "999" })])).toBe(editado);
  });

  it("se puede volver a la sugerencia, y desde ahí vuelve a seguir a los ítems", () => {
    const sugerido = volverAlValorSugerido(items);
    expect(sugerido).toEqual({ valor: "200.00", manual: false });
    expect(valorDeclaradoAlCambiarItems(sugerido, [fila({ precioUnitario: "10" })])).toEqual({ valor: "10.00", manual: false });
  });
});

describe("leerValorDeclarado", () => {
  it("vacío toma la sugerencia", () => {
    expect(leerValorDeclarado("", 123.45)).toBe(123.45);
    expect(leerValorDeclarado("  ", 0)).toBe(0);
  });

  it("acepta coma decimal y redondea a centavos", () => {
    expect(leerValorDeclarado("1500,5", 0)).toBe(1500.5);
    expect(leerValorDeclarado("10.005", 0)).toBe(10.01);
    expect(leerValorDeclarado("0", 99)).toBe(0);
  });

  it("negativo o no numérico es inválido", () => {
    expect(leerValorDeclarado("-1", 0)).toBeNull();
    expect(leerValorDeclarado("mucho", 0)).toBeNull();
  });
});

describe("erroresRemito", () => {
  const datos = {
    clienteId: "c0000000-0000-0000-0000-000000000001",
    puntoVenta: "1",
    valorDeclarado: "200",
    items: [fila({ bultos: "2" })],
  };

  it("sin errores con cliente, punto de venta, un ítem, bultos y valor válidos", () => {
    expect(erroresRemito(datos)).toEqual([]);
  });

  it("pide cliente, punto de venta y al menos un ítem", () => {
    expect(erroresRemito({ ...datos, clienteId: "", puntoVenta: "", items: [] })).toEqual([
      "Elegí el cliente.",
      "Elegí el punto de venta.",
      "Agregá al menos un ítem.",
    ]);
  });

  it("bultos enteros 0 o más, por ítem", () => {
    expect(erroresRemito({ ...datos, items: [fila({ bultos: "1" }), fila({ bultos: "-2" }), fila({ bultos: "1.5" })] })).toEqual([
      "Ítem 2: los bultos tienen que ser un número entero, 0 o más.",
      "Ítem 3: los bultos tienen que ser un número entero, 0 o más.",
    ]);
  });

  it("valor declarado 0 o más", () => {
    expect(erroresRemito({ ...datos, valorDeclarado: "-5" })).toEqual(["El valor declarado no puede ser negativo ni estar mal escrito."]);
    expect(erroresRemito({ ...datos, valorDeclarado: "0" })).toEqual([]);
  });

  it("punto de venta: entero positivo", () => {
    expect(erroresRemito({ ...datos, puntoVenta: "0" })).toEqual(["Elegí el punto de venta."]);
    expect(erroresRemito({ ...datos, puntoVenta: 3 })).toEqual([]);
  });
});

describe("permisos por estado", () => {
  const tabla: Record<EstadoRemito, [editar: boolean, borrar: boolean, emitir: boolean, anular: boolean, facturar: boolean, imprimir: boolean]> = {
    borrador: [true, true, true, false, false, false],
    emitido: [true, false, false, true, true, true],
    parcial: [false, false, false, false, true, true],
    facturado: [false, false, false, false, false, true],
    anulado: [false, false, false, false, false, true],
  };

  it.each(ESTADOS_REMITO)("%s", (estado) => {
    const [editar, borrar, emitir, anular, facturar, imprimir] = tabla[estado];
    expect([
      puedeEditar(estado),
      puedeBorrar(estado),
      puedeEmitir(estado),
      puedeAnular(estado),
      puedeFacturar(estado),
      puedeImprimir(estado),
    ]).toEqual([editar, borrar, emitir, anular, facturar, imprimir]);
    expect(permisosRemito(estado)).toEqual({
      puedeEditar: editar,
      puedeBorrar: borrar,
      puedeEmitir: emitir,
      puedeAnular: anular,
      puedeFacturar: facturar,
      puedeImprimir: imprimir,
    });
  });
});

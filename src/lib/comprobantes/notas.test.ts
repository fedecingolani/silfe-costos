import { describe, expect, it } from "vitest";
import type { ItemGuardado } from "./borrador";
import { armarNota, type OrigenNota } from "./notas";

const FACTURA: OrigenNota = {
  id: "f0000000-0000-0000-0000-000000000001",
  estado: "autorizado",
  clase: "factura",
  letra: "A",
  punto_venta: 7,
  cliente_id: "c0000000-0000-0000-0000-000000000001",
  lista_precio_id: "l0000000-0000-0000-0000-000000000001",
  condicion_pago: "contado",
};

const ITEMS: ItemGuardado[] = [
  {
    producto_id: "p0000000-0000-0000-0000-000000000001",
    codigo: "LON-01",
    descripcion: "Lona cosechera",
    observaciones: "Color verde",
    unidad: "un",
    cantidad: 2,
    precio_unitario: 500,
    descuento_pct: 0,
    alicuota_iva: 21,
    importe: 1000,
    iva: 210,
  },
  {
    producto_id: null,
    codigo: null,
    descripcion: "Flete",
    observaciones: null,
    unidad: null,
    cantidad: 1,
    precio_unitario: 100,
    descuento_pct: 0,
    alicuota_iva: 10.5,
    importe: 100,
    iva: 10.5,
  },
];

describe("armarNota", () => {
  it("arma la nota de crédito de una factura: mismo cliente, punto de venta, lista y condición, fecha de hoy, ítems copiados y la factura asociada", () => {
    const r = armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", [7, 9]);
    if ("error" in r) throw new Error(r.error);
    expect(r.cabecera).toEqual({
      punto_venta: 7,
      clase: "nota_credito",
      letra: "A",
      tipo_arca: 3,
      fecha: "2026-10-20",
      fecha_vencimiento_pago: "2026-10-20",
      cliente_id: FACTURA.cliente_id,
      lista_precio_id: FACTURA.lista_precio_id,
      condicion_pago: "contado",
      observaciones: null,
      neto: 1100,
      iva: 220.5,
      total: 1320.5,
    });
    expect(r.items).toEqual(ITEMS);
    expect(r.asociados).toEqual([{ asociado_id: FACTURA.id }]);
  });

  it("la nota de débito lleva la letra de la factura (código 7 para B)", () => {
    const r = armarNota({ ...FACTURA, letra: "B" }, ITEMS, "nota_debito", "2026-10-20", [7]);
    if ("error" in r) throw new Error(r.error);
    expect(r.cabecera).toMatchObject({ clase: "nota_debito", letra: "B", tipo_arca: 7 });
  });

  it("desde una nota de débito sólo se genera la nota de crédito", () => {
    const desdeDebito = { ...FACTURA, clase: "nota_debito" as const };
    expect(armarNota(desdeDebito, ITEMS, "nota_credito", "2026-10-20", [7])).toHaveProperty("cabecera");
    expect(armarNota(desdeDebito, ITEMS, "nota_debito", "2026-10-20", [7])).toEqual({
      error: "Desde una nota de débito no se puede generar una nota de débito.",
    });
  });

  it("no genera una nota de crédito desde otra ni desde un comprobante sin autorizar", () => {
    expect(armarNota({ ...FACTURA, clase: "nota_credito" }, ITEMS, "nota_credito", "2026-10-20", [7])).toEqual({
      error: "Desde una nota de crédito no se puede generar una nota de crédito.",
    });
    expect(armarNota({ ...FACTURA, estado: "verificando" }, ITEMS, "nota_credito", "2026-10-20", [7])).toEqual({
      error: "Sólo se generan notas de crédito o débito desde un comprobante autorizado.",
    });
  });

  it("si el punto de venta se desactivó usa el electrónico activo de número más bajo", () => {
    const r = armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", [3, 9]);
    if ("error" in r) throw new Error(r.error);
    expect(r.cabecera.punto_venta).toBe(3);
    expect(armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", [])).toEqual({
      error: "No hay ningún punto de venta electrónico activo.",
    });
  });
});

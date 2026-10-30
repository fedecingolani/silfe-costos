import { describe, expect, it } from "vitest";
import type { ItemGuardado } from "./borrador";
import { armarNota, puntoVentaPara, type OrigenNota, type PuntoVentaActivo } from "./notas";

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
    gravado: true,
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
    gravado: true,
    alicuota_iva: 10.5,
    importe: 100,
    iva: 10.5,
  },
];

const pv = (...numeros: number[]): PuntoVentaActivo[] => numeros.map((numero) => ({ numero, electronico: true }));
const PUNTOS: PuntoVentaActivo[] = [...pv(7, 9), { numero: 9999, electronico: false }, { numero: 9000, electronico: false }];

describe("armarNota", () => {
  it("arma la nota de crédito de una factura: mismo cliente, punto de venta, lista y condición, fecha de hoy, ítems copiados y la factura asociada", () => {
    const r = armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", pv(7, 9));
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
      periodo_asoc_desde: null,
      periodo_asoc_hasta: null,
      neto: 1100,
      no_gravado: 0,
      iva: 220.5,
      total: 1320.5,
    });
    expect(r.items).toEqual(ITEMS);
    expect(r.asociados).toEqual([{ asociado_id: FACTURA.id }]);
  });

  it("la nota de débito lleva la letra de la factura (código 7 para B)", () => {
    const r = armarNota({ ...FACTURA, letra: "B" }, ITEMS, "nota_debito", "2026-10-20", pv(7));
    if ("error" in r) throw new Error(r.error);
    expect(r.cabecera).toMatchObject({ clase: "nota_debito", letra: "B", tipo_arca: 7 });
  });

  it("desde una nota de débito sólo se genera la nota de crédito", () => {
    const desdeDebito = { ...FACTURA, clase: "nota_debito" as const };
    expect(armarNota(desdeDebito, ITEMS, "nota_credito", "2026-10-20", pv(7))).toHaveProperty("cabecera");
    expect(armarNota(desdeDebito, ITEMS, "nota_debito", "2026-10-20", pv(7))).toEqual({
      error: "Desde una nota de débito no se puede generar una nota de débito.",
    });
  });

  it("no genera una nota de crédito desde otra ni desde un comprobante sin autorizar", () => {
    expect(armarNota({ ...FACTURA, clase: "nota_credito" }, ITEMS, "nota_credito", "2026-10-20", pv(7))).toEqual({
      error: "Desde una nota de crédito no se puede generar una nota de crédito.",
    });
    expect(armarNota({ ...FACTURA, estado: "verificando" }, ITEMS, "nota_credito", "2026-10-20", pv(7))).toEqual({
      error: "Sólo se generan notas de crédito o débito desde un comprobante autorizado.",
    });
  });

  it("si el punto de venta se desactivó usa el electrónico activo de número más bajo", () => {
    const r = armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", pv(3, 9));
    if ("error" in r) throw new Error(r.error);
    expect(r.cabecera.punto_venta).toBe(3);
    expect(armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", pv())).toEqual({
      error: "No hay ningún punto de venta electrónico activo.",
    });
  });

  it("ignora los puntos de venta no electrónicos para una nota A o B", () => {
    const r = armarNota(FACTURA, ITEMS, "nota_credito", "2026-10-20", [{ numero: 1, electronico: false }, ...pv(9)]);
    if ("error" in r) throw new Error(r.error);
    expect(r.cabecera.punto_venta).toBe(9);
  });

  describe("desde un comprobante X", () => {
    const FACTURA_X: OrigenNota = { ...FACTURA, letra: "X", punto_venta: 9999 };
    const ITEMS_X: ItemGuardado[] = ITEMS.map((i) => ({ ...i, iva: 0 }));

    it("arma una nota X en el mismo punto no electrónico, sin código de ARCA ni IVA", () => {
      const r = armarNota(FACTURA_X, ITEMS_X, "nota_credito", "2026-10-20", PUNTOS);
      if ("error" in r) throw new Error(r.error);
      expect(r.cabecera).toMatchObject({
        punto_venta: 9999,
        clase: "nota_credito",
        letra: "X",
        tipo_arca: null,
        neto: 1100,
        no_gravado: 0,
        iva: 0,
        total: 1100,
      });
      expect(r.items.map((i) => i.iva)).toEqual([0, 0]);
      expect(r.asociados).toEqual([{ asociado_id: FACTURA_X.id }]);
    });

    it("los ítems copiados van con IVA 0 aunque vinieran con IVA", () => {
      const r = armarNota(FACTURA_X, ITEMS, "nota_debito", "2026-10-20", PUNTOS);
      if ("error" in r) throw new Error(r.error);
      expect(r.items.map((i) => [i.importe, i.iva])).toEqual([
        [1000, 0],
        [100, 0],
      ]);
      expect(r.cabecera).toMatchObject({ letra: "X", tipo_arca: null, iva: 0, total: 1100 });
    });

    it("si el punto de venta se desactivó usa el no electrónico activo de número más bajo", () => {
      const r = armarNota({ ...FACTURA_X, punto_venta: 8000 }, ITEMS_X, "nota_credito", "2026-10-20", PUNTOS);
      if ("error" in r) throw new Error(r.error);
      expect(r.cabecera.punto_venta).toBe(9000);
      expect(armarNota(FACTURA_X, ITEMS_X, "nota_credito", "2026-10-20", pv(7))).toEqual({
        error: "No hay ningún punto de venta no electrónico activo.",
      });
    });
  });
});

describe("puntoVentaPara", () => {
  it("conserva el punto de venta si sigue activo y es del mismo tipo", () => {
    expect(puntoVentaPara(9, false, PUNTOS)).toEqual({ puntoVenta: 9 });
    expect(puntoVentaPara(9999, true, PUNTOS)).toEqual({ puntoVenta: 9999 });
  });

  it("si no, usa el activo de número más bajo del tipo que corresponde", () => {
    expect(puntoVentaPara(3, false, PUNTOS)).toEqual({ puntoVenta: 7 });
    expect(puntoVentaPara(7, true, PUNTOS)).toEqual({ puntoVenta: 9000 });
    expect(puntoVentaPara(7, false, [])).toEqual({ error: "No hay ningún punto de venta electrónico activo." });
    expect(puntoVentaPara(7, true, pv(7))).toEqual({ error: "No hay ningún punto de venta no electrónico activo." });
  });
});

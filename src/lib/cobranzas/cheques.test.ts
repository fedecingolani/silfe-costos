import { describe, expect, it } from "vitest";
import { validarPeriodoAsociado } from "@/lib/comprobantes/asociados";
import {
  TRANSICIONES_CHEQUE,
  armarNotaDebitoRechazo,
  puedeAnularRecibo,
  puedePasar,
  type ChequeRechazado,
  type ContextoRechazo,
} from "./cheques";

describe("transiciones de cheques", () => {
  it("son las de la spec", () => {
    expect(TRANSICIONES_CHEQUE).toEqual({
      en_cartera: ["depositado", "entregado", "rechazado"],
      depositado: ["rechazado"],
      entregado: ["rechazado"],
      rechazado: [],
      anulado: [],
    });
  });

  it("puedePasar", () => {
    expect(puedePasar("en_cartera", "depositado")).toBe(true);
    expect(puedePasar("depositado", "rechazado")).toBe(true);
    expect(puedePasar("entregado", "rechazado")).toBe(true);
    expect(puedePasar("depositado", "en_cartera")).toBe(false);
    expect(puedePasar("entregado", "depositado")).toBe(false);
    expect(puedePasar("rechazado", "en_cartera")).toBe(false);
    expect(puedePasar("en_cartera", "en_cartera")).toBe(false);
    expect(puedePasar("en_cartera", "anulado")).toBe(false);
  });

  it("un recibo se anula sólo con todos sus cheques en cartera", () => {
    expect(puedeAnularRecibo([])).toBe(true);
    expect(puedeAnularRecibo([{ estado: "en_cartera" }, { estado: "en_cartera" }])).toBe(true);
    expect(puedeAnularRecibo([{ estado: "en_cartera" }, { estado: "depositado" }])).toBe(false);
    expect(puedeAnularRecibo([{ estado: "entregado" }])).toBe(false);
  });
});

describe("armarNotaDebitoRechazo", () => {
  const CHEQUE: ChequeRechazado = {
    numero: "00012345",
    banco: "Banco Galicia",
    importe: 150000.5,
    clienteId: "c0000000-0000-0000-0000-000000000001",
  };
  const CONTEXTO: ContextoRechazo = {
    hoy: "2026-11-20",
    puntosActivos: [
      { numero: 9999, electronico: false },
      { numero: 9, electronico: true },
      { numero: 7, electronico: true },
      { numero: 9000, electronico: false },
    ],
    condicionIva: "Responsable Inscripto",
    listaPrecioId: null,
    reciboFecha: "2026-10-17",
    imputados: [],
  };

  it("lleva el capital del cheque como ítem no gravado", () => {
    const nota = armarNotaDebitoRechazo(CHEQUE, CONTEXTO);
    if ("error" in nota) throw new Error(nota.error);
    expect(nota.items).toEqual([
      {
        producto_id: null,
        codigo: null,
        descripcion: "Cheque rechazado N° 00012345 – Banco Galicia",
        observaciones: null,
        unidad: null,
        cantidad: 1,
        precio_unitario: 150000.5,
        descuento_pct: 0,
        gravado: false,
        alicuota_iva: null,
        importe: 150000.5,
        iva: 0,
      },
    ]);
    expect(nota.cabecera).toMatchObject({
      punto_venta: 7,
      clase: "nota_debito",
      letra: "A",
      tipo_arca: 2,
      fecha: "2026-11-20",
      fecha_vencimiento_pago: "2026-11-20",
      cliente_id: CHEQUE.clienteId,
      condicion_pago: "cuenta_corriente",
      neto: 0,
      no_gravado: 150000.5,
      iva: 0,
      total: 150000.5,
    });
  });

  it("los gastos bancarios van en un segundo ítem gravado al 21% (como rechazar_cheque)", () => {
    const nota = armarNotaDebitoRechazo(
      { ...CHEQUE, importe: 50 },
      { ...CONTEXTO, gastos: { importe: 1000, descripcion: "Gastos bancarios" } },
    );
    if ("error" in nota) throw new Error(nota.error);
    expect(nota.items.map((i) => [i.descripcion, i.gravado, i.alicuota_iva, i.importe, i.iva])).toEqual([
      ["Cheque rechazado N° 00012345 – Banco Galicia", false, null, 50, 0],
      ["Gastos bancarios", true, 21, 1000, 210],
    ]);
    expect(nota.cabecera).toMatchObject({ neto: 1000, no_gravado: 50, iva: 210, total: 1260 });
    const sinGastos = armarNotaDebitoRechazo(CHEQUE, { ...CONTEXTO, gastos: { importe: 0, descripcion: "" } });
    expect("items" in sinGastos && sinGastos.items).toHaveLength(1);
  });

  it("se asocia a las facturas que canceló el recibo del cheque", () => {
    const nota = armarNotaDebitoRechazo(CHEQUE, {
      ...CONTEXTO,
      condicionIva: "Consumidor Final",
      imputados: [
        { id: "f1", clase: "factura", letra: "A" },
        { id: "nd", clase: "nota_debito", letra: "A" },
        { id: "f2", clase: "factura", letra: "A" },
        { id: "f1", clase: "factura", letra: "A" },
      ],
    });
    if ("error" in nota) throw new Error(nota.error);
    expect(nota.asociados).toEqual([{ asociado_id: "f1" }, { asociado_id: "f2" }]);
    expect(nota.cabecera).toMatchObject({
      letra: "A",
      tipo_arca: 2,
      periodo_asoc_desde: null,
      periodo_asoc_hasta: null,
    });
  });

  it("si fue a cuenta, se asocia al período del mes del recibo hasta su fecha", () => {
    const nota = armarNotaDebitoRechazo(CHEQUE, { ...CONTEXTO, condicionIva: "Exento" });
    if ("error" in nota) throw new Error(nota.error);
    expect(nota.asociados).toEqual([]);
    expect(nota.cabecera).toMatchObject({
      letra: "B",
      tipo_arca: 7,
      periodo_asoc_desde: "2026-10-01",
      periodo_asoc_hasta: "2026-10-17",
    });
    expect(
      validarPeriodoAsociado(
        { desde: nota.cabecera.periodo_asoc_desde!, hasta: nota.cabecera.periodo_asoc_hasta! },
        nota.cabecera.fecha,
      ),
    ).toEqual([]);
  });

  it("informa facturas asociadas de letras distintas", () => {
    expect(
      armarNotaDebitoRechazo(CHEQUE, {
        ...CONTEXTO,
        imputados: [
          { id: "f1", clase: "factura", letra: "A" },
          { id: "f2", clase: "factura", letra: "B" },
        ],
      }),
    ).toEqual({
      error: "El recibo del cheque canceló facturas A y B: la nota de débito lleva una sola letra.",
    });
  });

  it("informa facturas asociadas sin letra con un mensaje legible", () => {
    expect(
      armarNotaDebitoRechazo(CHEQUE, {
        ...CONTEXTO,
        imputados: [
          { id: "f1", clase: "factura", letra: null },
          { id: "f2", clase: "factura", letra: null },
        ],
      }),
    ).toEqual({
      error: "Las facturas que canceló el recibo del cheque no tienen letra: no se puede armar la nota de débito.",
    });
  });

  it("informa si falta la condición frente al IVA del cliente", () => {
    expect(armarNotaDebitoRechazo(CHEQUE, { ...CONTEXTO, condicionIva: null })).toEqual({
      error: "Completá la condición frente al IVA del cliente.",
    });
  });

  it("informa un recibo posterior a la nota", () => {
    expect(armarNotaDebitoRechazo(CHEQUE, { ...CONTEXTO, reciboFecha: "2026-11-21" })).toEqual({
      error: "Período asociado: el hasta no puede ser posterior a la fecha de la nota.",
    });
  });

  it("usa el punto de venta electrónico activo de número más bajo para una nota A o B", () => {
    const nota = armarNotaDebitoRechazo(CHEQUE, CONTEXTO);
    if ("error" in nota) throw new Error(nota.error);
    expect(nota.cabecera.punto_venta).toBe(7);
    expect(armarNotaDebitoRechazo(CHEQUE, { ...CONTEXTO, puntosActivos: [{ numero: 9999, electronico: false }] })).toEqual({
      error: "No hay ningún punto de venta electrónico activo.",
    });
  });

  describe("facturas X", () => {
    const FACTURAS_X = [
      { id: "x1", clase: "factura" as const, letra: "X" as const },
      { id: "x2", clase: "factura" as const, letra: "X" as const },
    ];

    it("si todas las facturas canceladas son X, la nota es X en el no electrónico activo más bajo, sin IVA", () => {
      const nota = armarNotaDebitoRechazo(
        { ...CHEQUE, importe: 50 },
        { ...CONTEXTO, imputados: FACTURAS_X, gastos: { importe: 1000, descripcion: "Gastos bancarios" } },
      );
      if ("error" in nota) throw new Error(nota.error);
      expect(nota.items.map((i) => [i.descripcion, i.gravado, i.alicuota_iva, i.importe, i.iva])).toEqual([
        ["Cheque rechazado N° 00012345 – Banco Galicia", false, null, 50, 0],
        ["Gastos bancarios", true, 21, 1000, 0],
      ]);
      expect(nota.cabecera).toMatchObject({
        punto_venta: 9000,
        clase: "nota_debito",
        letra: "X",
        tipo_arca: null,
        neto: 1000,
        no_gravado: 50,
        iva: 0,
        total: 1050,
      });
      expect(nota.asociados).toEqual([{ asociado_id: "x1" }, { asociado_id: "x2" }]);
    });

    it("informa si no hay un punto de venta no electrónico activo", () => {
      expect(
        armarNotaDebitoRechazo(CHEQUE, {
          ...CONTEXTO,
          imputados: FACTURAS_X,
          puntosActivos: [{ numero: 7, electronico: true }],
        }),
      ).toEqual({ error: "No hay ningún punto de venta no electrónico activo para la nota de débito X." });
    });

    it("si mezcla facturas X con A o B no arma la nota (como rechazar_cheque)", () => {
      expect(
        armarNotaDebitoRechazo(CHEQUE, {
          ...CONTEXTO,
          imputados: [...FACTURAS_X, { id: "f1", clase: "factura", letra: "B" }, { id: "f2", clase: "factura", letra: "A" }],
        }),
      ).toEqual({
        error:
          "El recibo del cheque canceló facturas X y A y B: la nota de débito no se genera sola. Cargá las notas de débito a mano.",
      });
    });
  });
});

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
    puntoVenta: 7,
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
});

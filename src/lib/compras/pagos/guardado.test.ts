import { describe, expect, it } from "vitest";
import { armarOrdenPago, leerOrdenEnviada, type OrdenEnviada } from "./guardado";
import type { ChequeCartera } from "./medios";

const PROVEEDOR = "11111111-1111-4111-8111-111111111111";
const CAJA = "33333333-3333-4333-8333-333333333333";

const cheque: ChequeCartera = {
  id: "c1",
  banco: "Nación",
  numero: "123",
  fechaPago: "2026-12-01",
  importe: 400,
  librador: null,
  cliente: "Finca",
  estado: "en_cartera",
};

const contexto = {
  debitos: [
    { comprobanteId: "f1", fecha: "2026-10-01", saldo: 500 },
    { comprobanteId: "f2", fecha: "2026-10-20", saldo: 1000 },
  ],
  cheques: [cheque],
};

const enviada = (cambios: Partial<OrdenEnviada> = {}): OrdenEnviada => ({
  proveedorId: PROVEEDOR,
  fecha: "2026-11-06",
  observaciones: null,
  medios: [
    { tipo: "efectivo", importe: 200, cuentaId: CAJA, referencia: null, chequeId: null, banco: null, numero: null, fechaPago: null },
    { tipo: "cheque_tercero", importe: 0, cuentaId: null, referencia: null, chequeId: "c1", banco: null, numero: null, fechaPago: null },
  ],
  imputaciones: [{ comprobanteId: "f1", importe: 500 }],
  ...cambios,
});

describe("leerOrdenEnviada", () => {
  it("lee el JSON de la pantalla", () => {
    const leida = leerOrdenEnviada(JSON.parse(JSON.stringify(enviada({ observaciones: " pago parcial " }))));
    expect(leida).toEqual(enviada({ observaciones: "pago parcial" }));
  });

  it("rechaza formas inesperadas y tipos de medio desconocidos", () => {
    expect(leerOrdenEnviada(null)).toBeNull();
    expect(leerOrdenEnviada({ medios: "x", imputaciones: [] })).toBeNull();
    expect(leerOrdenEnviada({ medios: [{ tipo: "retencion", importe: 1 }], imputaciones: [] })).toBeNull();
  });

  it("una cuenta que no es un id es una forma inválida; sin cuenta, el borrador se lee igual", () => {
    expect(leerOrdenEnviada({ ...enviada(), medios: [{ tipo: "efectivo", importe: 1, cuentaId: "caja" }] })).toBeNull();
    expect(leerOrdenEnviada({ ...enviada(), medios: [{ tipo: "efectivo", importe: 1 }] })?.medios[0].cuentaId).toBeNull();
  });

  it("un importe que no es número queda NaN para que la validación lo rechace", () => {
    const leida = leerOrdenEnviada({ ...enviada(), medios: [{ tipo: "efectivo", importe: "10" }] });
    expect(Number.isNaN(leida?.medios[0].importe)).toBe(true);
  });
});

describe("armarOrdenPago", () => {
  it("arma los parámetros de guardar_orden_pago; el cheque va por su importe", () => {
    expect(armarOrdenPago(enviada(), contexto)).toEqual({
      guardar: {
        orden: { proveedor_id: PROVEEDOR, fecha: "2026-11-06", observaciones: null },
        medios: [
          { tipo: "efectivo", importe: 200, cuenta_id: CAJA },
          { tipo: "cheque_tercero", cheque_id: "c1" },
        ],
        imputaciones: [{ comprobante_compra_id: "f1", importe: 500 }],
        total: 600,
        aFavor: 100,
      },
    });
  });

  it("descarta las imputaciones en cero", () => {
    const armado = armarOrdenPago(
      enviada({ imputaciones: [{ comprobanteId: "f1", importe: 0 }, { comprobanteId: "f2", importe: 100 }] }),
      contexto,
    );
    expect("guardar" in armado && armado.guardar.imputaciones).toEqual([{ comprobante_compra_id: "f2", importe: 100 }]);
  });

  it("junta los errores de cabecera, medios e imputaciones", () => {
    const armado = armarOrdenPago(
      enviada({
        proveedorId: null,
        fecha: "2026-02-30",
        medios: [],
        imputaciones: [
          { comprobanteId: "f1", importe: 10 },
          { comprobanteId: "f1", importe: 10 },
        ],
      }),
      contexto,
    );
    expect(armado).toEqual({
      errores: [
        "Elegí el proveedor.",
        "Indicá una fecha válida.",
        "Cargá al menos un medio de pago.",
        "Cada comprobante se imputa una sola vez.",
        "Lo imputado ($ 20,00) supera el total de la orden de pago ($ 0,00).",
      ],
    });
  });

  it("un cheque que ya no está en la cartera no se guarda", () => {
    const armado = armarOrdenPago(enviada(), { ...contexto, cheques: [{ ...cheque, estado: "entregado" }] });
    expect(armado).toEqual({ errores: ["El cheque Nación N° 123 ya no está en la cartera."] });
  });
});

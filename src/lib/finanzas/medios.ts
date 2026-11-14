/**
 * Cuenta de fondos de un medio de pago, para armar el selector de los
 * editores:
 * - recibo: el efectivo entra a una caja y la transferencia a una cuenta
 *   bancaria; cheques, e-cheq y retenciones no mueven fondos al cobrarlos
 *   (fn_recibo_medio_tipo_cuenta, 20261111000003_finanzas_recibos.sql);
 * - orden de pago: el efectivo sale de una caja, la transferencia y el
 *   cheque propio de una cuenta bancaria; el cheque de terceros sale de la
 *   cartera (fn_orden_pago_medio_tipo_cuenta, 20261112000001_finanzas_pagos.sql).
 */
import type { CuentaFondos, TipoCuentaFondos, TipoMedioPago, TipoMedioPagoCompra } from "@/lib/tipos";

/** Medio de un recibo o de una orden de pago (los nombres no se pisan). */
type TipoMedio = TipoMedioPago | TipoMedioPagoCompra;

/** Lo que necesita el selector: las cuentas activas. */
export type CuentaElegible = Pick<CuentaFondos, "id" | "tipo" | "nombre">;

/** Tipo de cuenta del medio, o null si el medio no lleva cuenta. */
export function tipoCuentaDelMedio(tipo: TipoMedio): TipoCuentaFondos | null {
  if (tipo === "efectivo") return "caja";
  if (tipo === "transferencia" || tipo === "cheque_propio") return "banco";
  return null;
}

/** Las cuentas que admite el medio, en el orden recibido. */
export function cuentasDelMedio<T extends CuentaElegible>(cuentas: readonly T[], tipo: TipoMedio): T[] {
  const tipoCuenta = tipoCuentaDelMedio(tipo);
  return tipoCuenta ? cuentas.filter((c) => c.tipo === tipoCuenta) : [];
}

/** La cuenta a preseleccionar: la única del tipo, si hay exactamente una. */
export function cuentaPorDefecto(cuentas: readonly CuentaElegible[], tipo: TipoMedio): string | null {
  const posibles = cuentasDelMedio(cuentas, tipo);
  return posibles.length === 1 ? posibles[0].id : null;
}

/**
 * Cuenta de fondos de un medio de pago de recibo: el efectivo entra a una
 * caja y la transferencia a una cuenta bancaria; cheques, e-cheq y
 * retenciones no mueven fondos al cobrarlos. Repite la regla de
 * fn_recibo_medio_tipo_cuenta (20261111000003_finanzas_recibos.sql) para
 * armar el selector del editor.
 */
import type { CuentaFondos, TipoCuentaFondos, TipoMedioPago } from "@/lib/tipos";

/** Lo que necesita el selector: las cuentas activas. */
export type CuentaElegible = Pick<CuentaFondos, "id" | "tipo" | "nombre">;

/** Tipo de cuenta del medio, o null si el medio no lleva cuenta. */
export function tipoCuentaDelMedio(tipo: TipoMedioPago): TipoCuentaFondos | null {
  if (tipo === "efectivo") return "caja";
  if (tipo === "transferencia") return "banco";
  return null;
}

/** Las cuentas que admite el medio, en el orden recibido. */
export function cuentasDelMedio<T extends CuentaElegible>(cuentas: readonly T[], tipo: TipoMedioPago): T[] {
  const tipoCuenta = tipoCuentaDelMedio(tipo);
  return tipoCuenta ? cuentas.filter((c) => c.tipo === tipoCuenta) : [];
}

/** La cuenta a preseleccionar: la única del tipo, si hay exactamente una. */
export function cuentaPorDefecto(cuentas: readonly CuentaElegible[], tipo: TipoMedioPago): string | null {
  const posibles = cuentasDelMedio(cuentas, tipo);
  return posibles.length === 1 ? posibles[0].id : null;
}

/**
 * Presupuestos: reglas de la pantalla (cómo se mueve «válido hasta» con la
 * fecha) y la cabecera de un duplicado.
 */
import { vencimientoPara } from "@/lib/comprobantes/borrador";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import type { CondicionPago } from "@/lib/tipos";
import type { CabeceraPresupuestoGuardada } from "./borrador";
import { validezPorDefecto } from "./borrador";

/**
 * «Válido hasta» después de cambiar la fecha. Si seguía en el de por defecto
 * (o vacío), se corre con la fecha; uno elegido a mano se respeta mientras no
 * quede antes de la fecha nueva. Con una fecha nueva inválida no se toca.
 */
export function validezAlCambiarFecha(fechaAnterior: string, fechaNueva: string, validoHasta: string): string {
  if (!esFechaValida(fechaNueva)) return validoHasta;
  const eraPorDefecto = validoHasta === "" || validoHasta === validezPorDefecto(fechaAnterior);
  if (eraPorDefecto || validoHasta < fechaNueva) return validezPorDefecto(fechaNueva);
  return validoHasta;
}

type Importe = number | string;

/** Cabecera de un presupuesto tal como se lee de la base, para duplicarla. */
export type CabeceraOrigen = {
  cliente_id: string;
  fecha_vencimiento_pago: string;
  condicion_pago: CondicionPago;
  lista_precio_id: string | null;
  observaciones: string | null;
  neto: Importe;
  no_gravado: Importe;
  iva: Importe;
  total: Importe;
};

/**
 * Cabecera de un presupuesto nuevo copiado de otro: mismo cliente, lista,
 * condición, observaciones y totales (los ítems se copian tal cual), con
 * fecha de hoy y la validez por defecto. El vencimiento del cobro se
 * conserva si no quedó antes de hoy.
 */
export function cabeceraDuplicada(origen: CabeceraOrigen, hoy: string): CabeceraPresupuestoGuardada {
  return {
    cliente_id: origen.cliente_id,
    fecha: hoy,
    valido_hasta: validezPorDefecto(hoy),
    fecha_vencimiento_pago: vencimientoPara(origen.condicion_pago, hoy, origen.fecha_vencimiento_pago),
    condicion_pago: origen.condicion_pago,
    lista_precio_id: origen.lista_precio_id,
    observaciones: origen.observaciones,
    neto: Number(origen.neto),
    no_gravado: Number(origen.no_gravado),
    iva: Number(origen.iva),
    total: Number(origen.total),
  };
}

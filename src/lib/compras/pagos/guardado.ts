/**
 * Orden de pago que llega de la pantalla (JSON) → los parámetros de
 * guardar_orden_pago. Valida con las mismas funciones que la pantalla
 * (validarMedios, validarImputacionesPago): el servidor no confía en lo que
 * valida el navegador. La base vuelve a controlar todo al confirmar.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { aCentavos } from "@/lib/cobranzas/dinero";
import {
  TIPOS_MEDIO_PAGO_COMPRA,
  type ImputacionOrdenPagoGuardar,
  type MedioOrdenPagoGuardar,
  type TipoMedioPagoCompra,
} from "@/lib/tipos";
import { medioParaGuardar, totalMedios, validarMedios, type ChequeCartera, type MedioBorrador } from "./medios";
import { saldoAFavor, validarImputacionesPago, type DebitoPendiente, type ImputacionElegida } from "./imputacion";

/** Lo que manda la pantalla. */
export type OrdenEnviada = {
  proveedorId: string | null;
  fecha: string | null;
  observaciones: string | null;
  medios: MedioBorrador[];
  imputaciones: ImputacionElegida[];
};

/** Parámetros de guardar_orden_pago, el total y lo que queda a favor. */
export type OrdenParaGuardar = {
  orden: { proveedor_id: string; fecha: string; observaciones: string | null };
  medios: MedioOrdenPagoGuardar[];
  imputaciones: ImputacionOrdenPagoGuardar[];
  total: number;
  aFavor: number;
};

export type ContextoGuardadoPago = {
  /** Facturas y notas de débito con saldo del proveedor. */
  debitos: readonly DebitoPendiente[];
  /** Los cheques de terceros que eligió la orden, con su estado actual. */
  cheques: readonly ChequeCartera[];
};

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;

const importe = (valor: unknown): number => (typeof valor === "number" ? valor : Number.NaN);

const objeto = (valor: unknown): Record<string, unknown> =>
  typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};

function leerMedio(valor: unknown): MedioBorrador | null {
  const m = objeto(valor);
  if (!(TIPOS_MEDIO_PAGO_COMPRA as readonly unknown[]).includes(m.tipo)) return null;
  return {
    tipo: m.tipo as TipoMedioPagoCompra,
    importe: importe(m.importe),
    referencia: texto(m.referencia),
    chequeId: texto(m.chequeId),
    banco: texto(m.banco),
    numero: texto(m.numero),
    fechaPago: texto(m.fechaPago),
  };
}

/** Lee el JSON de la pantalla. null si la forma no es la esperada. */
export function leerOrdenEnviada(valor: unknown): OrdenEnviada | null {
  const o = objeto(valor);
  if (!Array.isArray(o.medios) || !Array.isArray(o.imputaciones)) return null;
  const medios = o.medios.map(leerMedio);
  if (medios.some((m) => m === null)) return null;
  return {
    proveedorId: texto(o.proveedorId),
    fecha: texto(o.fecha),
    observaciones: texto(o.observaciones),
    medios: medios as MedioBorrador[],
    imputaciones: o.imputaciones.map((i) => {
      const x = objeto(i);
      return { comprobanteId: texto(x.comprobanteId) ?? "", importe: importe(x.importe) };
    }),
  };
}

/** Errores de validación o los parámetros para guardar. */
export function armarOrdenPago(
  enviada: OrdenEnviada,
  contexto: ContextoGuardadoPago,
): { errores: string[] } | { guardar: OrdenParaGuardar } {
  const cheques = new Map(contexto.cheques.map((c) => [c.id, c]));
  const errores: string[] = [];
  if (!enviada.proveedorId) errores.push("Elegí el proveedor.");
  if (!esFechaValida(enviada.fecha)) errores.push("Indicá una fecha válida.");
  errores.push(...validarMedios(enviada.medios, cheques));
  const total = totalMedios(enviada.medios, cheques);
  errores.push(...validarImputacionesPago(contexto.debitos, enviada.imputaciones, total));
  if (errores.length > 0 || !enviada.proveedorId || !enviada.fecha) return { errores };

  const imputaciones = enviada.imputaciones.filter((i) => aCentavos(i.importe) > 0);
  return {
    guardar: {
      orden: { proveedor_id: enviada.proveedorId, fecha: enviada.fecha, observaciones: enviada.observaciones },
      medios: enviada.medios.map(medioParaGuardar),
      imputaciones: imputaciones.map((i) => ({ comprobante_compra_id: i.comprobanteId, importe: i.importe })),
      total,
      aFavor: saldoAFavor(total, imputaciones),
    },
  };
}

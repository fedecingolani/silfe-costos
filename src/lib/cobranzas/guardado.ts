/**
 * Recibo que llega de la pantalla (JSON) → lo que guarda
 * guardar_borrador_recibo. Valida con las mismas funciones que la pantalla
 * (validarRecibo, validarImputaciones, pagoContado): el servidor no confía
 * en lo que valida el navegador. La base vuelve a controlar lo esencial al
 * emitir.
 */
import {
  TIPOS_MEDIO_PAGO,
  TIPOS_RETENCION,
  type TipoMedioPago,
  type TipoRetencion,
} from "@/lib/tipos";
import { totalRecibo, validarRecibo, type MedioBorrador } from "./recibo";
import {
  pagoContado,
  validarImputaciones,
  type ComprobanteContado,
  type DebitoPendiente,
  type ImputacionElegida,
} from "./imputacion";

/** Lo que manda la pantalla. contadoId: pago de una factura de contado. */
export type ReciboEnviado = {
  clienteId: string | null;
  fecha: string | null;
  observaciones: string | null;
  contadoId: string | null;
  medios: MedioBorrador[];
  imputaciones: ImputacionElegida[];
};

/** Parámetros de guardar_borrador_recibo. */
export type ReciboParaGuardar = {
  recibo: {
    cliente_id: string;
    fecha: string;
    observaciones: string | null;
    comprobante_contado_id: string | null;
  };
  medios: {
    tipo: TipoMedioPago;
    importe: number;
    banco: string | null;
    referencia: string | null;
    cheque: {
      banco: string;
      numero: string;
      fecha_emision: string | null;
      fecha_pago: string;
      librador: string | null;
      librador_cuit: string | null;
    } | null;
    retencion_tipo: TipoRetencion | null;
    retencion_jurisdiccion: string | null;
    certificado: string | null;
    fecha_retencion: string | null;
  }[];
  imputaciones: { comprobante_id: string; importe: number }[];
  total: number;
};

export type ContextoGuardado = {
  /** Débitos de cuenta corriente con saldo del cliente (para una cobranza). */
  debitos: readonly DebitoPendiente[];
  /** El comprobante de contado que se paga, o null en una cobranza. */
  contado: ComprobanteContado | null;
};

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;

const importe = (valor: unknown): number => (typeof valor === "number" ? valor : Number.NaN);

const objeto = (valor: unknown): Record<string, unknown> =>
  typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};

function leerMedio(valor: unknown): MedioBorrador | null {
  const m = objeto(valor);
  if (!(TIPOS_MEDIO_PAGO as readonly unknown[]).includes(m.tipo)) return null;
  const tipo = m.tipo as TipoMedioPago;
  const cheque = objeto(m.cheque);
  const retencion = objeto(m.retencion);
  return {
    tipo,
    importe: importe(m.importe),
    banco: texto(m.banco),
    referencia: texto(m.referencia),
    cheque:
      tipo === "cheque" || tipo === "echeq"
        ? {
            banco: texto(cheque.banco) ?? "",
            numero: texto(cheque.numero) ?? "",
            fechaEmision: texto(cheque.fechaEmision),
            fechaPago: texto(cheque.fechaPago) ?? "",
            librador: texto(cheque.librador),
            libradorCuit: texto(cheque.libradorCuit),
          }
        : null,
    retencion:
      tipo === "retencion"
        ? {
            tipo: (TIPOS_RETENCION as readonly unknown[]).includes(retencion.tipo)
              ? (retencion.tipo as TipoRetencion)
              : null,
            jurisdiccion: texto(retencion.jurisdiccion),
            certificado: texto(retencion.certificado) ?? "",
            fecha: texto(retencion.fecha) ?? "",
          }
        : null,
  };
}

/** Lee el JSON de la pantalla. null si la forma no es la esperada. */
export function leerReciboEnviado(valor: unknown): ReciboEnviado | null {
  const r = objeto(valor);
  if (!Array.isArray(r.medios) || !Array.isArray(r.imputaciones)) return null;
  const medios = r.medios.map(leerMedio);
  if (medios.some((m) => m === null)) return null;
  return {
    clienteId: texto(r.clienteId),
    fecha: texto(r.fecha),
    observaciones: texto(r.observaciones),
    contadoId: texto(r.contadoId),
    medios: medios as MedioBorrador[],
    imputaciones: r.imputaciones.map((i) => {
      const o = objeto(i);
      return { comprobanteId: texto(o.comprobanteId) ?? "", importe: importe(o.importe) };
    }),
  };
}

/** Errores de validación o los parámetros para guardar. */
export function armarRecibo(
  enviado: ReciboEnviado,
  contexto: ContextoGuardado,
): { errores: string[] } | { guardar: ReciboParaGuardar } {
  const errores = validarRecibo(enviado);
  const total = totalRecibo(enviado.medios);

  let imputaciones: ImputacionElegida[];
  if (contexto.contado) {
    if (enviado.contadoId !== contexto.contado.id) errores.push("El pago no corresponde a ese comprobante.");
    const pago = pagoContado(contexto.contado, enviado.medios);
    if ("error" in pago) errores.push(pago.error);
    imputaciones = "error" in pago ? [] : [pago.imputacion];
  } else {
    if (enviado.contadoId) errores.push("No se encontró el comprobante de contado.");
    imputaciones = enviado.imputaciones.filter((i) => Number.isFinite(i.importe) && i.importe !== 0);
    errores.push(...validarImputaciones(contexto.debitos, enviado.imputaciones, total));
  }
  if (errores.length > 0 || !enviado.clienteId || !enviado.fecha) return { errores };

  return {
    guardar: {
      recibo: {
        cliente_id: enviado.clienteId,
        fecha: enviado.fecha,
        observaciones: enviado.observaciones,
        comprobante_contado_id: contexto.contado?.id ?? null,
      },
      medios: enviado.medios.map((m) => ({
        tipo: m.tipo,
        importe: m.importe,
        banco: m.tipo === "transferencia" ? (m.banco ?? null) : null,
        referencia: m.tipo === "transferencia" ? (m.referencia ?? null) : null,
        cheque:
          (m.tipo === "cheque" || m.tipo === "echeq") && m.cheque
            ? {
                banco: m.cheque.banco,
                numero: m.cheque.numero,
                fecha_emision: m.cheque.fechaEmision ?? null,
                fecha_pago: m.cheque.fechaPago,
                librador: m.cheque.librador ?? null,
                librador_cuit: m.cheque.libradorCuit ? m.cheque.libradorCuit.replace(/\D/g, "") : null,
              }
            : null,
        retencion_tipo: m.tipo === "retencion" ? (m.retencion?.tipo ?? null) : null,
        retencion_jurisdiccion:
          m.tipo === "retencion" && m.retencion?.tipo === "iibb" ? (m.retencion.jurisdiccion ?? null) : null,
        certificado: m.tipo === "retencion" ? (m.retencion?.certificado ?? null) : null,
        fecha_retencion: m.tipo === "retencion" ? (m.retencion?.fecha ?? null) : null,
      })),
      imputaciones: imputaciones.map((i) => ({ comprobante_id: i.comprobanteId, importe: i.importe })),
      total,
    },
  };
}

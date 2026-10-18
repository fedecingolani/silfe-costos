/**
 * Datos del PDF de un recibo emitido o anulado: de las filas de la base a
 * los textos ya formateados que dibuja `pdf-recibo.ts`. Todo puro, para
 * probarlo sin generar el PDF. Mismo formato de números y fechas que el
 * PDF de los comprobantes.
 */
import {
  fechaCorta,
  formatearCuit,
  formatearImporte,
  type FilaEmisorPdf,
} from "@/lib/comprobantes/pdf-datos";
import { nombreComprobante, numeroVisible } from "@/lib/comprobantes/listado";
import {
  NOMBRES_MEDIO_PAGO,
  NOMBRES_RETENCION,
  type ClaseComprobante,
  type EstadoRecibo,
  type LetraComprobante,
  type TipoMedioPago,
  type TipoRetencion,
} from "@/lib/tipos";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { aCentavos, aPesos, sumarPesos } from "./dinero";
import { numeroEnLetras } from "./numero-letras";

export type FilaReciboPdf = {
  id: string;
  numero_texto: string | null;
  fecha: string;
  estado: EstadoRecibo;
  total: number | string;
  motivo_anulacion: string | null;
  anulado_en: string | null;
  observaciones: string | null;
};

export type FilaClienteReciboPdf = {
  razon_social: string;
  cuit: string | null;
  condicion_iva: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
};

export type FilaMedioReciboPdf = {
  orden: number;
  tipo: TipoMedioPago;
  importe: number | string;
  banco: string | null;
  referencia: string | null;
  retencion_tipo: TipoRetencion | null;
  retencion_jurisdiccion: string | null;
  certificado: string | null;
  fecha_retencion: string | null;
  cheque: {
    banco: string;
    numero: string;
    fecha_pago: string;
    librador: string | null;
    librador_cuit: string | null;
  } | null;
};

export type FilaImputacionReciboPdf = {
  importe: number | string;
  automatica: boolean;
  comprobante: {
    clase: ClaseComprobante;
    letra: string | null;
    punto_venta: number | string;
    numero: number | string | null;
    fecha: string;
  } | null;
};

/** Columnas que se leen de la base para el PDF del recibo. */
export const COLUMNAS_RECIBO_PDF =
  "id, numero_texto, fecha, estado, total, motivo_anulacion, anulado_en, observaciones, cliente_id";
export const COLUMNAS_CLIENTE_RECIBO_PDF = "razon_social, cuit, condicion_iva, direccion, localidad, provincia, codigo_postal";
export const COLUMNAS_MEDIO_RECIBO_PDF =
  "orden, tipo, importe, banco, referencia, retencion_tipo, retencion_jurisdiccion, certificado, fecha_retencion, " +
  "cheque(banco, numero, fecha_pago, librador, librador_cuit)";
export const COLUMNAS_IMPUTACION_RECIBO_PDF =
  "importe, automatica, creado_en, comprobante:comprobante_id(clase, letra, punto_venta, numero, fecha)";

export type MedioPdf = { medio: string; detalle: string; importe: string };
export type ImputacionPdf = { comprobante: string; fecha: string; importe: string };

export type DatosPdfRecibo = {
  numero: string;
  fecha: string;
  emisor: {
    razonSocial: string;
    domicilio: string;
    condicionIva: string;
    cuit: string;
    ingresosBrutos: string;
    inicioActividades: string;
  };
  cliente: { razonSocial: string; cuit: string; domicilio: string; condicionIva: string };
  /** "Recibimos de … la suma de pesos … ($ 1.234,56)". */
  recibimos: string;
  observaciones: string | null;
  medios: MedioPdf[];
  imputaciones: ImputacionPdf[];
  /** Con el signo: "$ 1.234,56". */
  total: string;
  imputado: string;
  /** null si no queda nada a favor. */
  aFavor: string | null;
  /** Anulación: fecha y motivo (null si está emitido). */
  anulado: { fecha: string; motivo: string } | null;
  /** Sin extensión: "Recibo R-00001-00000001". */
  nombreArchivo: string;
};

export type PuedeImprimirRecibo = { ok: true } | { ok: false; status: 409; motivo: string };

/** El PDF es de un recibo emitido o anulado: un borrador todavía no tiene número. */
export function puedeImprimirRecibo(estado: EstadoRecibo): PuedeImprimirRecibo {
  if (estado === "borrador") {
    return { ok: false, status: 409, motivo: "Un recibo en borrador no se imprime: emitilo primero." };
  }
  return { ok: true };
}

function pesosPdf(valor: number): string {
  return `$ ${formatearImporte(valor)}`;
}

function domicilioCliente(c: FilaClienteReciboPdf): string {
  const lugar = [c.localidad, c.provincia].filter(Boolean).join(", ");
  return [c.direccion, lugar, c.codigo_postal ? `CP ${c.codigo_postal}` : null].filter(Boolean).join(" · ");
}

/** Detalle de un medio: banco y referencia, datos del cheque o de la retención. */
export function detalleMedio(m: FilaMedioReciboPdf): string {
  if ((m.tipo === "cheque" || m.tipo === "echeq") && m.cheque) {
    const ch = m.cheque;
    const librador = ch.librador
      ? `Librador ${ch.librador}${ch.librador_cuit ? ` (CUIT ${formatearCuit(ch.librador_cuit)})` : ""}`
      : ch.librador_cuit
        ? `Librador CUIT ${formatearCuit(ch.librador_cuit)}`
        : null;
    return [`${ch.banco} N° ${ch.numero}`, `Pago ${fechaCorta(ch.fecha_pago)}`, librador].filter(Boolean).join(" · ");
  }
  if (m.tipo === "transferencia") {
    return [m.banco, m.referencia ? `Ref. ${m.referencia}` : null].filter(Boolean).join(" · ");
  }
  if (m.tipo === "retencion") {
    const tipo = m.retencion_tipo ? NOMBRES_RETENCION[m.retencion_tipo] : "Retención";
    const jurisdiccion = m.retencion_jurisdiccion ? ` (${m.retencion_jurisdiccion})` : "";
    return [`${tipo}${jurisdiccion}`, m.certificado ? `Certificado ${m.certificado}` : null, fechaCorta(m.fecha_retencion) || null]
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

function textoComprobante(i: FilaImputacionReciboPdf): string {
  if (!i.comprobante) return "Comprobante";
  const c = i.comprobante;
  const numero = numeroVisible({
    letra: c.letra as LetraComprobante | null,
    punto_venta: Number(c.punto_venta),
    numero: c.numero === null ? null : Number(c.numero),
  });
  return `${nombreComprobante(c.clase, null)} ${numero}${i.automatica ? " (saldo a favor)" : ""}`;
}

/** Arma los datos del PDF. Supone un recibo que pasó puedeImprimirRecibo. */
export function armarDatosPdfRecibo({
  recibo,
  cliente,
  medios,
  imputaciones,
  emisor,
}: {
  recibo: FilaReciboPdf;
  cliente: FilaClienteReciboPdf;
  medios: readonly FilaMedioReciboPdf[];
  imputaciones: readonly FilaImputacionReciboPdf[];
  emisor: FilaEmisorPdf | null;
}): DatosPdfRecibo {
  const total = Number(recibo.total);
  const imputado = sumarPesos(imputaciones.map((i) => Number(i.importe)));
  const aFavor = aPesos(aCentavos(total) - aCentavos(imputado));
  const numero = recibo.numero_texto ?? "";
  return {
    numero,
    fecha: fechaCorta(recibo.fecha),
    emisor: {
      razonSocial: emisor?.razon_social ?? "",
      domicilio: emisor?.domicilio_comercial ?? "",
      condicionIva: emisor?.condicion_iva ?? "",
      cuit: emisor?.cuit ? formatearCuit(emisor.cuit) : "",
      ingresosBrutos: emisor?.ingresos_brutos ?? "",
      inicioActividades: fechaCorta(emisor?.inicio_actividades),
    },
    cliente: {
      razonSocial: cliente.razon_social,
      cuit: cliente.cuit ? formatearCuit(cliente.cuit) : "",
      domicilio: domicilioCliente(cliente),
      condicionIva: cliente.condicion_iva ?? "",
    },
    recibimos: `Recibimos de ${cliente.razon_social} la suma de pesos ${numeroEnLetras(total)} (${pesosPdf(total)}).`,
    observaciones: recibo.observaciones?.trim() || null,
    medios: [...medios]
      .sort((a, b) => a.orden - b.orden)
      .map((m) => ({ medio: NOMBRES_MEDIO_PAGO[m.tipo], detalle: detalleMedio(m), importe: formatearImporte(Number(m.importe)) })),
    imputaciones: imputaciones.map((i) => ({
      comprobante: textoComprobante(i),
      fecha: fechaCorta(i.comprobante?.fecha),
      importe: formatearImporte(Number(i.importe)),
    })),
    total: pesosPdf(total),
    imputado: pesosPdf(imputado),
    // Anulado, no queda nada a favor: el recibo no cuenta en la cuenta corriente.
    aFavor: recibo.estado !== "anulado" && aCentavos(aFavor) > 0 ? pesosPdf(aFavor) : null,
    anulado:
      recibo.estado === "anulado"
        ? { fecha: recibo.anulado_en ? fechaCorta(hoyArgentina(new Date(recibo.anulado_en))) : "", motivo: recibo.motivo_anulacion?.trim() || "Sin motivo" }
        : null,
    nombreArchivo: `Recibo ${numero}`.trim(),
  };
}

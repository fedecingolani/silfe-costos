/**
 * Datos del PDF de un presupuesto: el mismo formato que la factura
 * (`generarPdfComprobante`), titulado "PRESUPUESTO", con número P-… y
 * "válido hasta". No es fiscal: sin letra, código de ARCA, CAE ni QR. Puro,
 * para probarlo sin generar el PDF.
 */
import {
  FORMAS_PAGO,
  emisorDelPdf,
  fechaCorta,
  formatearCuit,
  formatearImporte,
  itemsDelPdf,
  ivaDelComprobante,
  ivaDelPie,
  type DatosPdfComprobante,
  type FilaEmisorPdf,
  type FilaItemPdf,
} from "@/lib/comprobantes/pdf-datos";
import type { Cliente, Presupuesto } from "@/lib/tipos";
import { numeroPresupuesto } from "./listado";

export type FilaPresupuestoPdf = Pick<
  Presupuesto,
  | "numero"
  | "fecha"
  | "valido_hasta"
  | "fecha_vencimiento_pago"
  | "condicion_pago"
  | "neto"
  | "no_gravado"
  | "iva"
  | "total"
>;

export type ClientePdfPresupuesto = Pick<
  Cliente,
  "razon_social" | "cuit" | "condicion_iva" | "direccion" | "localidad" | "provincia"
>;

/** Columnas que se leen de la base para el PDF del presupuesto y de su cliente. */
export const COLUMNAS_PRESUPUESTO_PDF =
  "numero, cliente_id, fecha, valido_hasta, fecha_vencimiento_pago, condicion_pago, neto, no_gravado, iva, total";
export const COLUMNAS_CLIENTE_PDF = "razon_social, cuit, condicion_iva, direccion, localidad, provincia";

export function armarDatosPdfPresupuesto({
  presupuesto: p,
  cliente,
  items,
  emisor,
}: {
  presupuesto: FilaPresupuestoPdf;
  cliente: ClientePdfPresupuesto | null;
  items: readonly FilaItemPdf[];
  emisor: FilaEmisorPdf | null;
}): DatosPdfComprobante {
  const numero = numeroPresupuesto(p.numero);
  // Mismo armado del domicilio que el receptor de una factura al autorizarla.
  const domicilio = [cliente?.direccion, cliente?.localidad, cliente?.provincia]
    .map((parte) => parte?.trim())
    .filter(Boolean)
    .join(", ");
  const iva = ivaDelComprobante({ iva: p.iva, iva_detalle: null }, items);

  return {
    titulo: "PRESUPUESTO",
    letra: "",
    codigoArca: "",
    numero,
    fecha: fechaCorta(p.fecha),
    emisor: emisorDelPdf(emisor),
    receptor: {
      razonSocial: cliente?.razon_social ?? "",
      domicilio,
      documentoEtiqueta: "CUIT",
      documento: cliente?.cuit ? formatearCuit(cliente.cuit) : "Sin identificar",
      condicionIva: cliente?.condicion_iva ?? "",
    },
    moneda: "Pesos Argentinos",
    provinciaDestino: cliente?.provincia?.trim() ?? "",
    fechaVencimientoPago: fechaCorta(p.fecha_vencimiento_pago),
    formaPago: FORMAS_PAGO[p.condicion_pago],
    items: itemsDelPdf(items),
    ivaPorAlicuota: ivaDelPie(iva.alicuotas),
    bruto: formatearImporte(Number(p.neto)),
    noGravado: formatearImporte(Number(p.no_gravado ?? 0)),
    impuestos: formatearImporte(Number(p.iva)),
    total: `$ ${formatearImporte(Number(p.total))}`,
    cae: "",
    caeVencimiento: "",
    qrUrl: "",
    homologacion: false,
    nombreArchivo: `Presupuesto ${numero}`,
    asociados: [],
    periodoAsociado: null,
    inconsistencias: iva.inconsistencia ? [`${numero}: ${iva.inconsistencia}`] : [],
    presupuesto: { validoHasta: fechaCorta(p.valido_hasta) },
  };
}

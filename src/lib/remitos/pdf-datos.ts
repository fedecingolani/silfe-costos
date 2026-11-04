/**
 * Datos del PDF de un remito: de las filas de la base a los textos ya
 * formateados que dibuja `pdf.ts`. Mismo encabezado que la factura, con la
 * letra R en el recuadro y la leyenda "Documento no válido como factura";
 * transporte y domicilio de entrega; ítems con bultos; y al pie bultos total,
 * valor declarado, observaciones y "Recibí conforme". No es fiscal: sin
 * código de ARCA, CAE ni QR. Puro, para probarlo sin generar el PDF.
 */
import {
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
  type ItemPdf,
} from "@/lib/comprobantes/pdf-datos";
import type { IdentidadPdf } from "@/lib/empresa/pdf-empresa";
import type { Cliente, Remito, RemitoItem } from "@/lib/tipos";
import { numeroRemito } from "./numero";

/**
 * Si el PDF del remito muestra precios, importes y totales. Un remito suele
 * llevar sólo cantidades, pero este lleva los datos de la factura que se va
 * a emitir, así que por ahora sí. Para sacarlos, alcanza con cambiar esto.
 */
export const MOSTRAR_PRECIOS_REMITO = true;

export type FilaRemitoPdf = Pick<
  Remito,
  | "id"
  | "punto_venta"
  | "numero"
  | "fecha"
  | "estado"
  | "domicilio_entrega"
  | "observaciones"
  | "neto"
  | "no_gravado"
  | "iva"
  | "total"
  | "valor_declarado"
  | "bultos_total"
>;

export type FilaItemRemitoPdf = FilaItemPdf & Pick<RemitoItem, "bultos">;

export type ClientePdfRemito = Pick<
  Cliente,
  "razon_social" | "cuit" | "condicion_iva" | "direccion" | "localidad" | "provincia"
>;

/** Columnas que se leen de la base para el PDF (nunca nada de arca_credencial). */
export const COLUMNAS_REMITO_PDF =
  "id, punto_venta, numero, cliente_id, transporte_id, fecha, estado, domicilio_entrega, observaciones, " +
  "neto, no_gravado, iva, total, valor_declarado, bultos_total";
export const COLUMNAS_ITEM_REMITO_PDF =
  "codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, gravado, alicuota_iva, " +
  "importe, iva, bultos";
export const COLUMNAS_CLIENTE_REMITO_PDF = "razon_social, cuit, condicion_iva, direccion, localidad, provincia";

export type ItemRemitoPdf = ItemPdf & { bultos: string };

export type DatosPdfRemito = {
  titulo: string;
  letra: string;
  leyenda: string;
  numero: string;
  fecha: string;
  emisor: DatosPdfComprobante["emisor"];
  receptor: { razonSocial: string; domicilio: string; cuit: string; condicionIva: string };
  /** Nombre del transporte y domicilio de entrega; "—" si no tiene. */
  entrega: { transporte: string; domicilio: string };
  /** Sin precios, los campos de importes de cada ítem quedan vacíos. */
  items: ItemRemitoPdf[];
  /** Totales como en la factura; null si el remito sale sin precios. */
  precios: {
    ivaPorAlicuota: DatosPdfComprobante["ivaPorAlicuota"];
    bruto: string;
    noGravado: string;
    impuestos: string;
    /** Con el signo: "$ 1.694.000,00". */
    total: string;
  } | null;
  bultosTotal: string;
  /** Con el signo: "$ 1.500.000,00". */
  valorDeclarado: string;
  observaciones: string;
  conforme: { titulo: string; campos: string[] };
  anulado: boolean;
  /** Sin extensión: "Remito R-00001-00000001". */
  nombreArchivo: string;
  /** Diferencias entre el IVA por alícuota y el IVA guardado (para el log; vacío si coinciden). */
  inconsistencias: string[];
};

export type PuedeImprimirRemito = { ok: true } | { ok: false; status: 409; motivo: string };

/** Un borrador no tiene número: no se imprime. La ruta del PDF; el botón usa permisosRemito. */
export function puedeImprimirRemito(r: Pick<FilaRemitoPdf, "estado" | "numero">): PuedeImprimirRemito {
  if (r.estado === "borrador") {
    return { ok: false, status: 409, motivo: "Un remito en borrador no se imprime: emitilo primero." };
  }
  if (r.numero === null) return { ok: false, status: 409, motivo: "Al remito le falta el número." };
  return { ok: true };
}

const SIN_DATO = "—";

function oGuion(texto: string | null | undefined): string {
  return texto?.trim() || SIN_DATO;
}

/** Arma los datos del PDF. Supone un remito que pasó puedeImprimirRemito. */
export function armarDatosPdfRemito({
  remito: r,
  cliente,
  transporte,
  items,
  emisor,
  identidad,
  conPrecios = MOSTRAR_PRECIOS_REMITO,
}: {
  remito: FilaRemitoPdf;
  cliente: ClientePdfRemito | null;
  /** Nombre del transporte; null si el remito no tiene. */
  transporte: string | null;
  items: readonly FilaItemRemitoPdf[];
  emisor: FilaEmisorPdf | null;
  /** Nombre de fantasía y contacto de la empresa; sin ellos, el encabezado no los lleva. */
  identidad?: IdentidadPdf;
  conPrecios?: boolean;
}): DatosPdfRemito {
  const numero = r.numero === null ? "" : numeroRemito(Number(r.punto_venta), r.numero);
  // Mismo armado del domicilio que el receptor de una factura al autorizarla.
  const domicilio = [cliente?.direccion, cliente?.localidad, cliente?.provincia]
    .map((parte) => parte?.trim())
    .filter(Boolean)
    .join(", ");
  const iva = ivaDelComprobante({ iva: r.iva, iva_detalle: null }, items);
  const valorizados = itemsDelPdf(items);

  return {
    titulo: "REMITO",
    letra: "R",
    leyenda: "Documento no válido como factura",
    numero,
    fecha: fechaCorta(r.fecha),
    emisor: emisorDelPdf(emisor, identidad),
    receptor: {
      razonSocial: cliente?.razon_social ?? "",
      domicilio: domicilio || SIN_DATO,
      cuit: cliente?.cuit ? formatearCuit(cliente.cuit) : SIN_DATO,
      condicionIva: oGuion(cliente?.condicion_iva),
    },
    entrega: { transporte: oGuion(transporte), domicilio: oGuion(r.domicilio_entrega) },
    items: valorizados.map((item, i) => ({
      ...(conPrecios
        ? item
        : { ...item, precio: "", descuento: "", precioConDescuento: "", importe: "", alicuota: "", importeConIva: "" }),
      bultos: String(Number(items[i].bultos)),
    })),
    precios: conPrecios
      ? {
          ivaPorAlicuota: ivaDelPie(iva.alicuotas),
          bruto: formatearImporte(Number(r.neto)),
          noGravado: formatearImporte(Number(r.no_gravado ?? 0)),
          impuestos: formatearImporte(Number(r.iva)),
          total: `$ ${formatearImporte(Number(r.total))}`,
        }
      : null,
    bultosTotal: String(Number(r.bultos_total)),
    valorDeclarado: `$ ${formatearImporte(Number(r.valor_declarado))}`,
    observaciones: r.observaciones?.trim() ?? "",
    conforme: { titulo: "Recibí conforme", campos: ["Firma", "Aclaración", "Fecha"] },
    anulado: r.estado === "anulado",
    nombreArchivo: `Remito ${numero}`.trim(),
    inconsistencias: conPrecios && iva.inconsistencia ? [`${numero}: ${iva.inconsistencia}`] : [],
  };
}

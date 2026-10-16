/**
 * Datos del PDF de un comprobante autorizado: de las filas de la base a los
 * textos ya formateados que dibuja `pdf.ts`. Todo puro, para probarlo sin
 * generar el PDF.
 *
 * Números con formato argentino (1.400.000,00), como el resto de la app,
 * aunque el sistema anterior imprime 1,400,000.00.
 */
import {
  NOMBRES_CLASE_COMPROBANTE,
  type ArcaEmisor,
  type ClaseComprobante,
  type Comprobante,
  type ComprobanteItem,
} from "@/lib/tipos";
import { calcularTotales } from "./calculo";
import { formatearNumero } from "./numero";
import { urlQrArca } from "./qr";

export type FilaComprobantePdf = Pick<
  Comprobante,
  | "id"
  | "punto_venta"
  | "ambiente"
  | "estado"
  | "clase"
  | "letra"
  | "tipo_arca"
  | "numero"
  | "fecha"
  | "fecha_vencimiento_pago"
  | "condicion_pago"
  | "receptor_razon_social"
  | "receptor_doc_tipo"
  | "receptor_doc_nro"
  | "receptor_condicion_iva"
  | "receptor_domicilio"
  | "receptor_provincia"
  | "neto"
  | "iva"
  | "total"
  | "cae"
  | "cae_vencimiento"
>;

export type FilaItemPdf = Pick<
  ComprobanteItem,
  | "codigo"
  | "descripcion"
  | "observaciones"
  | "unidad"
  | "cantidad"
  | "precio_unitario"
  | "descuento_pct"
  | "alicuota_iva"
  | "importe"
  | "iva"
>;

export type FilaEmisorPdf = Pick<
  ArcaEmisor,
  "cuit" | "razon_social" | "condicion_iva" | "domicilio_comercial" | "ingresos_brutos" | "inicio_actividades"
>;

/** Columnas que se leen de la base para el PDF (nunca nada de arca_credencial). */
export const COLUMNAS_COMPROBANTE_PDF =
  "id, punto_venta, ambiente, estado, clase, letra, tipo_arca, numero, fecha, fecha_vencimiento_pago, " +
  "condicion_pago, receptor_razon_social, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva, " +
  "receptor_domicilio, receptor_provincia, neto, iva, total, cae, cae_vencimiento";
export const COLUMNAS_ITEM_PDF =
  "codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, alicuota_iva, importe, iva";
export const COLUMNAS_EMISOR_PDF =
  "cuit, razon_social, condicion_iva, domicilio_comercial, ingresos_brutos, inicio_actividades";

export type ItemPdf = {
  codigo: string;
  articulo: string;
  observaciones: string;
  cantidad: string;
  precio: string;
  descuento: string;
  importe: string;
  alicuota: string;
  importeConIva: string;
};

export type DatosPdfComprobante = {
  titulo: string;
  letra: string;
  /** Código de ARCA con 3 dígitos: "001". */
  codigoArca: string;
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
  receptor: {
    razonSocial: string;
    domicilio: string;
    documentoEtiqueta: string;
    documento: string;
    condicionIva: string;
  };
  moneda: string;
  provinciaDestino: string;
  fechaVencimientoPago: string;
  formaPago: string;
  items: ItemPdf[];
  ivaPorAlicuota: { etiqueta: string; importe: string }[];
  bruto: string;
  impuestos: string;
  /** Con el signo: "$ 1.694.000,00". */
  total: string;
  cae: string;
  caeVencimiento: string;
  qrUrl: string;
  homologacion: boolean;
  /** Sin extensión: "Factura A-00007-00000361". */
  nombreArchivo: string;
};

const TITULOS: Record<ClaseComprobante, string> = {
  factura: "FACTURA DE VENTA",
  nota_credito: "NOTA DE CRÉDITO",
  nota_debito: "NOTA DE DÉBITO",
};

const FORMAS_PAGO: Record<FilaComprobantePdf["condicion_pago"], string> = {
  cuenta_corriente: "Cuenta Corriente",
  contado: "Contado",
};

const DOCUMENTOS: Record<number, string> = { 80: "CUIT", 86: "CUIL", 96: "DNI" };

/** Alícuotas gravadas que se listan siempre en el pie (la de 0% no lleva IVA). */
const ALICUOTAS_PIE = [2.5, 5, 10.5, 21, 27] as const;

function formateador(minimo: number, maximo: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: minimo, maximumFractionDigits: maximo });
}

const importeFmt = formateador(2, 2);
const precioFmt = formateador(2, 4);
const alicuotaFmt = formateador(0, 1);

export function formatearImporte(valor: number): string {
  return importeFmt.format(valor);
}

/** 30712345671 → 30-71234567-1. Si no tiene 11 dígitos, se deja como está. */
export function formatearCuit(valor: string): string {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 11 ? `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}` : valor;
}

/** yyyy-mm-dd → dd/mm/aaaa. */
export function fechaCorta(valor: string | null | undefined): string {
  const m = valor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(valor) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export type ErrorImpresion = { status: 404 | 409; mensaje: string };

/**
 * El PDF completo es sólo para comprobantes autorizados de un punto de
 * venta electrónico (con CAE). Devuelve el error para mostrar, o null.
 */
export function validarImprimible(
  c: FilaComprobantePdf,
  puntoVentaElectronico: boolean,
  emisor: FilaEmisorPdf | null,
): ErrorImpresion | null {
  if (c.estado !== "autorizado") {
    return { status: 409, mensaje: "Sólo se imprime un comprobante autorizado." };
  }
  if (!puntoVentaElectronico) {
    return {
      status: 409,
      mensaje: "El comprobante es de un punto de venta no electrónico: se imprime en el formulario preimpreso.",
    };
  }
  if (!c.cae || !c.cae_vencimiento || !c.letra || !c.tipo_arca || c.numero === null) {
    return { status: 409, mensaje: "Al comprobante le faltan datos de la autorización (CAE, número o tipo)." };
  }
  if (!emisor?.cuit) {
    return { status: 409, mensaje: "Falta el CUIT del emisor: cargalo en Configuración → ARCA." };
  }
  return null;
}

/**
 * Arma los datos del PDF. Supone un comprobante que pasó validarImprimible
 * (si falta algo, queda vacío en lugar de fallar).
 */
export function armarDatosPdf({
  comprobante: c,
  items,
  emisor,
}: {
  comprobante: FilaComprobantePdf;
  items: readonly FilaItemPdf[];
  emisor: FilaEmisorPdf;
}): DatosPdfComprobante {
  const letra = c.letra ?? "";
  const numero = c.letra && c.numero !== null ? formatearNumero(c.letra, Number(c.punto_venta), Number(c.numero)) : "";
  const docTipo = c.receptor_doc_tipo ?? 99;
  const docNro = c.receptor_doc_nro ?? "0";

  const totales = calcularTotales(
    items.map((i) => ({
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      descuentoPct: Number(i.descuento_pct),
      alicuotaIva: Number(i.alicuota_iva),
    })),
  );
  const ivaDe = new Map(totales.ivaPorAlicuota.map((a) => [Number(a.alicuota), a.importe]));

  return {
    titulo: TITULOS[c.clase],
    letra,
    codigoArca: c.tipo_arca ? String(c.tipo_arca).padStart(3, "0") : "",
    numero,
    fecha: fechaCorta(c.fecha),
    emisor: {
      razonSocial: emisor.razon_social ?? "",
      domicilio: emisor.domicilio_comercial ?? "",
      condicionIva: emisor.condicion_iva ?? "",
      cuit: emisor.cuit ? formatearCuit(emisor.cuit) : "",
      ingresosBrutos: emisor.ingresos_brutos ?? "",
      inicioActividades: fechaCorta(emisor.inicio_actividades),
    },
    receptor: {
      razonSocial: c.receptor_razon_social ?? "",
      domicilio: c.receptor_domicilio ?? "",
      documentoEtiqueta: DOCUMENTOS[docTipo] ?? "Doc.",
      documento: docTipo === 80 || docTipo === 86 ? formatearCuit(docNro) : docTipo === 99 ? "Sin identificar" : docNro,
      condicionIva: c.receptor_condicion_iva ?? "",
    },
    moneda: "Pesos Argentinos",
    provinciaDestino: c.receptor_provincia ?? "",
    fechaVencimientoPago: fechaCorta(c.fecha_vencimiento_pago),
    formaPago: FORMAS_PAGO[c.condicion_pago],
    items: items.map((i) => ({
      codigo: i.codigo ?? "",
      articulo: i.descripcion,
      observaciones: i.observaciones ?? "",
      cantidad: `${precioFmt.format(Number(i.cantidad))}${i.unidad ? ` ${i.unidad}` : ""}`,
      precio: precioFmt.format(Number(i.precio_unitario)),
      descuento: importeFmt.format(Number(i.descuento_pct)),
      importe: formatearImporte(Number(i.importe)),
      alicuota: `${alicuotaFmt.format(Number(i.alicuota_iva))}%`,
      importeConIva: formatearImporte(Number(i.importe) + Number(i.iva)),
    })),
    ivaPorAlicuota: ALICUOTAS_PIE.map((a) => ({
      etiqueta: `IVA ${alicuotaFmt.format(a)}`,
      importe: formatearImporte(ivaDe.get(a) ?? 0),
    })),
    bruto: formatearImporte(Number(c.neto)),
    impuestos: formatearImporte(Number(c.iva)),
    total: `$ ${formatearImporte(Number(c.total))}`,
    cae: c.cae ?? "",
    caeVencimiento: fechaCorta(c.cae_vencimiento),
    qrUrl: urlQrArca({
      fecha: c.fecha,
      cuitEmisor: (emisor.cuit ?? "").replace(/\D/g, ""),
      puntoVenta: Number(c.punto_venta),
      tipoArca: c.tipo_arca ?? 0,
      numero: Number(c.numero ?? 0),
      total: Number(c.total),
      docTipo,
      docNro: docNro.replace(/\D/g, "") || "0",
      cae: c.cae ?? "0",
    }),
    homologacion: c.ambiente === "homologacion",
    nombreArchivo: `${NOMBRES_CLASE_COMPROBANTE[c.clase]} ${numero}`.trim(),
  };
}

/**
 * Reparte los renglones (por su alto) en páginas. Las páginas intermedias
 * usan todo el alto de la tabla; la última tiene que dejar lugar para el pie
 * (totales y QR), así que entra menos. Las páginas se llenan en orden; si la
 * última no deja lugar para el pie, su último renglón pasa a una página
 * nueva (o, si ni ese renglón entra con el pie, la página nueva lleva sólo
 * el pie). Devuelve los índices de cada página.
 */
export function paginar(alturas: readonly number[], capacidad: number, capacidadUltima: number): number[][] {
  const paginas: number[][] = [[]];
  let usado = 0;
  alturas.forEach((alto, i) => {
    if (usado + alto > capacidad && paginas.at(-1)!.length > 0) {
      paginas.push([]);
      usado = 0;
    }
    paginas.at(-1)!.push(i);
    usado += alto;
  });

  const ultima = paginas.at(-1)!;
  if (usado > capacidadUltima) {
    const ultimo = ultima.at(-1)!;
    paginas.push(alturas[ultimo] <= capacidadUltima ? ultima.splice(-1) : []);
  }
  return paginas;
}

/** Codifica según RFC 5987 (encodeURIComponent deja sin codificar ' ( ) * !). */
function codificarRfc5987(texto: string): string {
  return encodeURIComponent(texto).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Content-Disposition para abrir el PDF en el navegador, con nombre ASCII y nombre UTF-8. */
export function dispositionEnLinea(nombre: string): string {
  const ascii = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-");
  return `inline; filename="${ascii}.pdf"; filename*=UTF-8''${codificarRfc5987(`${nombre}.pdf`)}`;
}

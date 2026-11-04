/**
 * PDF de un remito, con el mismo aspecto que el de los comprobantes:
 * encabezado con logo y datos del emisor, la letra R en un recuadro con la
 * leyenda "Documento no válido como factura", "REMITO" con número y fecha;
 * cliente; transporte y domicilio de entrega; tabla de ítems con bultos (y
 * precios, si el remito los lleva); y al pie los totales, bultos total,
 * valor declarado, observaciones y el recuadro "Recibí conforme".
 *
 * Si los ítems no entran, siguen en otras páginas: el encabezado, el cliente
 * y la entrega se repiten, el pie va sólo en la última y todas llevan
 * "Página N de M". Un remito anulado lleva la marca "ANULADO" en cada
 * página. No es fiscal: sin código de ARCA, CAE ni QR. Función pura: los
 * bytes del logo llegan como parámetro.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { incrustarLogo } from "@/lib/empresa/pdf-logo";
import { crearSaneador, dibujarBloqueEmisor, partirEnLineas, recortar } from "@/lib/comprobantes/pdf";
import { paginar } from "@/lib/comprobantes/pdf-datos";
import type { DatosPdfRemito, ItemRemitoPdf } from "./pdf-datos";

// Medidas en puntos. A4 = 595,28 × 841,89.
const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 28;
const DERECHA = ANCHO - MARGEN;
const ARRIBA = ALTO - MARGEN;
const ANCHO_UTIL = DERECHA - MARGEN;

// Encabezado
const LADO_LETRA = 44;
const X_DATOS = 368;
const X_VALOR = 432;
const Y_FIN_ENCABEZADO = 694;

// Cliente y entrega
const Y_RECEPTOR = 680;
const X_RECEPTOR_DERECHA = 398;
const Y_FIN_RECEPTOR = 646;
const Y_ENTREGA = 632;
const X_ENTREGA_DOMICILIO = MARGEN + 200;
const Y_FIN_ENTREGA = 624;

// Tabla
const Y_CABECERA_TABLA = 618;
const ALTO_CABECERA_TABLA = 14;
const Y_CUERPO = Y_CABECERA_TABLA - ALTO_CABECERA_TABLA - 4;
const TAMANO_TABLA = 7.5;
const INTERLINEA_TABLA = 9;
const RELLENO_RENGLON = 3;
const MAX_LINEAS_RENGLON = 12;
const RELLENO_CELDA = 2;

// Pie
const Y_PAGINA = 16;
const LIMITE_CUERPO = 44;
const LIMITE_CUERPO_ULTIMA = 226;
const Y_REGLA_PIE = 222;
const Y_IVA = 211;
const Y_BANDA = 184;
const ALTO_BANDA = 18;
const Y_RESUMEN = 158;
const ALTO_RESUMEN = 20;
const Y_OBSERVACIONES = 146;
const Y_CONFORME = 32;
const ALTO_CONFORME = 88;
const Y_FIRMA = 52;

const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.35, 0.35, 0.35);
const FONDO = rgb(0.9, 0.9, 0.9);
const ROJO = rgb(0.75, 0.1, 0.1);

type Alineacion = "izquierda" | "derecha" | "centro";

type Columna = { titulo: string; ancho: number; alinear: Alineacion; campo: keyof ItemRemitoPdf; ajustar?: boolean };

/** Columnas con precios: suman el ancho útil de la página (539,28 pt). */
const COLUMNAS_CON_PRECIOS: Columna[] = [
  { titulo: "Cód.", ancho: 42, alinear: "izquierda", campo: "codigo", ajustar: true },
  { titulo: "Artículo", ancho: 110, alinear: "izquierda", campo: "articulo", ajustar: true },
  { titulo: "Observaciones", ancho: 65, alinear: "izquierda", campo: "observaciones", ajustar: true },
  { titulo: "Cantidad", ancho: 50, alinear: "derecha", campo: "cantidad" },
  { titulo: "Bultos", ancho: 35, alinear: "derecha", campo: "bultos" },
  { titulo: "Precio", ancho: 55, alinear: "derecha", campo: "precio" },
  { titulo: "% Dto.", ancho: 30, alinear: "derecha", campo: "descuento" },
  { titulo: "Importe", ancho: 57, alinear: "derecha", campo: "importe" },
  { titulo: "Alíc. IVA", ancho: 35, alinear: "derecha", campo: "alicuota" },
  { titulo: "Impt. c/IVA", ancho: 60.28, alinear: "derecha", campo: "importeConIva" },
];

/** Columnas sin precios: sólo lo que se entrega. */
const COLUMNAS_SIN_PRECIOS: Columna[] = [
  { titulo: "Cód.", ancho: 50, alinear: "izquierda", campo: "codigo", ajustar: true },
  { titulo: "Artículo", ancho: 210, alinear: "izquierda", campo: "articulo", ajustar: true },
  { titulo: "Observaciones", ancho: 160, alinear: "izquierda", campo: "observaciones", ajustar: true },
  { titulo: "Cantidad", ancho: 70, alinear: "derecha", campo: "cantidad" },
  { titulo: "Bultos", ancho: 49.28, alinear: "derecha", campo: "bultos" },
];

export async function generarPdfRemito(datos: DatosPdfRemito, logoBytes?: Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(datos.nombreArchivo);
  doc.setCreator("Charoli Gestión");
  doc.setProducer("Charoli Gestión");

  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const sanear = crearSaneador(normal);
  const columnas = datos.precios ? COLUMNAS_CON_PRECIOS : COLUMNAS_SIN_PRECIOS;

  // Logo PNG o JPEG; si no se puede leer, el remito sale sin logo.
  const logo = await incrustarLogo(doc, logoBytes);

  /** Escribe en la línea base y dada. */
  function escribir(
    pagina: PDFPage,
    texto: string,
    x: number,
    y: number,
    fuente: PDFFont,
    tamano: number,
    alinear: Alineacion = "izquierda",
    color: RGB = NEGRO,
  ) {
    const limpio = sanear(texto);
    const ancho = fuente.widthOfTextAtSize(limpio, tamano);
    const xFinal = alinear === "derecha" ? x - ancho : alinear === "centro" ? x - ancho / 2 : x;
    pagina.drawText(limpio, { x: xFinal, y, size: tamano, font: fuente, color });
  }

  /** "Etiqueta: valor", con la etiqueta en negrita; el valor se corta con "…" si pasa del ancho dado. */
  function etiquetaValor(pagina: PDFPage, etiqueta: string, valor: string, x: number, y: number, ancho?: number) {
    escribir(pagina, etiqueta, x, y, negrita, 8);
    const xValor = x + negrita.widthOfTextAtSize(sanear(etiqueta), 8) + 3;
    const texto = ancho ? recortar(partirEnLineas(sanear(valor), normal, 8, x + ancho - xValor), 1)[0] : valor;
    escribir(pagina, texto, xValor, y, normal, 8);
  }

  function regla(pagina: PDFPage, y: number) {
    pagina.drawLine({ start: { x: MARGEN, y }, end: { x: DERECHA, y }, thickness: 0.6, color: NEGRO });
  }

  // ----- Encabezado, cliente y entrega (en todas las páginas) -----------------

  function encabezado(pagina: PDFPage) {
    // Izquierda: logo, nombre de fantasía, razón social, domicilio y contacto, como en los comprobantes.
    dibujarBloqueEmisor(pagina, { logo, emisor: datos.emisor, normal, negrita, sanear });

    // Centro: la letra R en un recuadro, como la de la factura, con la leyenda debajo.
    const xCentro = ANCHO / 2;
    const yCaja = ARRIBA - LADO_LETRA;
    pagina.drawRectangle({
      x: xCentro - LADO_LETRA / 2,
      y: yCaja,
      width: LADO_LETRA,
      height: LADO_LETRA,
      borderColor: NEGRO,
      borderWidth: 1.2,
    });
    escribir(pagina, datos.letra, xCentro, yCaja + 12, negrita, 30, "centro");
    // "Documento no válido como factura", en dos líneas como en el comprobante X.
    const corte = datos.leyenda.lastIndexOf(" como ");
    const leyenda = corte > 0 ? [datos.leyenda.slice(0, corte), datos.leyenda.slice(corte + 1)] : [datos.leyenda];
    leyenda.forEach((linea, i) => escribir(pagina, linea, xCentro, yCaja - 9 - i * 8, negrita, 6.5, "centro"));
    const yCondicionIva = yCaja - 26;
    escribir(pagina, datos.emisor.condicionIva, xCentro, yCondicionIva, normal, 7, "centro");
    pagina.drawLine({
      start: { x: xCentro, y: yCondicionIva - 6 },
      end: { x: xCentro, y: Y_FIN_ENCABEZADO },
      thickness: 0.6,
      color: NEGRO,
    });

    // Derecha: título, número, fecha y datos del emisor.
    escribir(pagina, datos.titulo, X_DATOS, ARRIBA - 13, negrita, 13);
    const filas: [string, string][] = [
      ["Número:", datos.numero],
      ["Fecha:", datos.fecha],
      ["CUIT:", datos.emisor.cuit],
      ["Ing. Brutos:", datos.emisor.ingresosBrutos],
      ["Inicio Act.:", datos.emisor.inicioActividades],
    ];
    filas.forEach(([etiqueta, valor], i) => {
      const yFila = ARRIBA - 34 - i * 13;
      escribir(pagina, etiqueta, X_DATOS, yFila, negrita, 8.5);
      escribir(pagina, valor, X_VALOR, yFila, i === 0 ? negrita : normal, 8.5);
    });
    regla(pagina, Y_FIN_ENCABEZADO);

    // Cliente: razón social y domicilio a la izquierda; CUIT y condición de IVA a la derecha.
    const xValor = MARGEN + 46;
    const anchoReceptor = X_RECEPTOR_DERECHA - 10 - xValor;
    escribir(pagina, "Sr. (es):", MARGEN, Y_RECEPTOR, negrita, 8);
    escribir(
      pagina,
      recortar(partirEnLineas(sanear(datos.receptor.razonSocial), negrita, 9, anchoReceptor), 1)[0],
      xValor,
      Y_RECEPTOR,
      negrita,
      9,
    );
    escribir(pagina, "Domicilio:", MARGEN, Y_RECEPTOR - 12, negrita, 8);
    recortar(partirEnLineas(sanear(datos.receptor.domicilio), normal, 8, anchoReceptor), 2).forEach((linea, i) =>
      escribir(pagina, linea, xValor, Y_RECEPTOR - 12 - i * 10, normal, 8),
    );
    etiquetaValor(pagina, "CUIT:", datos.receptor.cuit, X_RECEPTOR_DERECHA, Y_RECEPTOR);
    etiquetaValor(pagina, "Cond. IVA:", datos.receptor.condicionIva, X_RECEPTOR_DERECHA, Y_RECEPTOR - 12);
    regla(pagina, Y_FIN_RECEPTOR);

    // Entrega: transporte y domicilio de entrega.
    etiquetaValor(pagina, "Transporte:", datos.entrega.transporte, MARGEN, Y_ENTREGA, X_ENTREGA_DOMICILIO - 10 - MARGEN);
    etiquetaValor(
      pagina,
      "Domicilio de entrega:",
      datos.entrega.domicilio,
      X_ENTREGA_DOMICILIO,
      Y_ENTREGA,
      DERECHA - X_ENTREGA_DOMICILIO,
    );
    regla(pagina, Y_FIN_ENTREGA);

    // Cabecera de la tabla, sobre una banda gris.
    pagina.drawRectangle({
      x: MARGEN,
      y: Y_CABECERA_TABLA - ALTO_CABECERA_TABLA,
      width: ANCHO_UTIL,
      height: ALTO_CABECERA_TABLA,
      color: FONDO,
    });
    let x = MARGEN;
    for (const columna of columnas) {
      const xTexto = columna.alinear === "derecha" ? x + columna.ancho - RELLENO_CELDA : x + RELLENO_CELDA;
      escribir(pagina, columna.titulo, xTexto, Y_CABECERA_TABLA - 10, negrita, 7.5, columna.alinear);
      x += columna.ancho;
    }
  }

  // ----- Renglones -----------------------------------------------------------

  type Celda = { lineas: string[]; tamano: number };

  /** Las columnas de texto se parten en líneas; las de números se achican si no entran. */
  function medir(item: ItemRemitoPdf): { celdas: Celda[]; alto: number } {
    const celdas = columnas.map((columna): Celda => {
      const ancho = columna.ancho - RELLENO_CELDA * 2;
      const texto = sanear(item[columna.campo]);
      if (columna.ajustar) {
        return {
          lineas: recortar(partirEnLineas(texto, normal, TAMANO_TABLA, ancho), MAX_LINEAS_RENGLON),
          tamano: TAMANO_TABLA,
        };
      }
      const anchoTexto = normal.widthOfTextAtSize(texto, TAMANO_TABLA);
      return { lineas: [texto], tamano: anchoTexto > ancho ? (TAMANO_TABLA * ancho) / anchoTexto : TAMANO_TABLA };
    });
    const lineas = Math.max(...celdas.map((c) => c.lineas.length));
    return { celdas, alto: lineas * INTERLINEA_TABLA + RELLENO_RENGLON };
  }

  function renglon(pagina: PDFPage, celdas: Celda[], yArriba: number) {
    let x = MARGEN;
    columnas.forEach((columna, i) => {
      const { lineas, tamano } = celdas[i];
      const xTexto = columna.alinear === "derecha" ? x + columna.ancho - RELLENO_CELDA : x + RELLENO_CELDA;
      lineas.forEach((linea, l) => {
        escribir(pagina, linea, xTexto, yArriba - TAMANO_TABLA - l * INTERLINEA_TABLA, normal, tamano, columna.alinear);
      });
      x += columna.ancho;
    });
  }

  // ----- Pie (sólo en la última página) --------------------------------------

  function pie(pagina: PDFPage) {
    regla(pagina, Y_REGLA_PIE);

    // Totales como en la factura, sólo si el remito lleva precios.
    if (datos.precios) {
      const p = datos.precios;
      escribir(pagina, p.ivaPorAlicuota.map((a) => `${a.etiqueta}: ${a.importe}`).join("     "), MARGEN, Y_IVA, normal, 8);
      pagina.drawRectangle({ x: MARGEN, y: Y_BANDA, width: ANCHO_UTIL, height: ALTO_BANDA, color: FONDO });
      const yBanda = Y_BANDA + 6;
      escribir(pagina, "Bruto:", MARGEN + 6, yBanda, negrita, 9);
      escribir(pagina, p.bruto, MARGEN + 6 + negrita.widthOfTextAtSize("Bruto:", 9) + 3, yBanda, normal, 9);
      escribir(pagina, "No gravado:", MARGEN + 130, yBanda, negrita, 9);
      escribir(pagina, p.noGravado, MARGEN + 130 + negrita.widthOfTextAtSize("No gravado:", 9) + 3, yBanda, normal, 9);
      escribir(pagina, "Impuestos:", MARGEN + 265, yBanda, negrita, 9);
      escribir(pagina, p.impuestos, MARGEN + 265 + negrita.widthOfTextAtSize("Impuestos:", 9) + 3, yBanda, normal, 9);
      escribir(pagina, `Total: ${p.total}`, DERECHA - 6, yBanda - 0.5, negrita, 10.5, "derecha");
    }

    // Bultos total y valor declarado, bien a la vista.
    pagina.drawRectangle({
      x: MARGEN,
      y: Y_RESUMEN,
      width: ANCHO_UTIL,
      height: ALTO_RESUMEN,
      borderColor: NEGRO,
      borderWidth: 0.8,
    });
    escribir(pagina, `Bultos total: ${datos.bultosTotal}`, MARGEN + 6, Y_RESUMEN + 6.5, negrita, 10.5);
    escribir(pagina, `Valor declarado: ${datos.valorDeclarado}`, DERECHA - 6, Y_RESUMEN + 6.5, negrita, 10.5, "derecha");

    // Observaciones del remito, hasta dos líneas.
    if (datos.observaciones) {
      const etiqueta = "Observaciones:";
      escribir(pagina, etiqueta, MARGEN, Y_OBSERVACIONES, negrita, 8);
      const xTexto = MARGEN + negrita.widthOfTextAtSize(etiqueta, 8) + 3;
      recortar(partirEnLineas(sanear(datos.observaciones), normal, 8, DERECHA - xTexto), 2).forEach((linea, i) =>
        escribir(pagina, linea, xTexto, Y_OBSERVACIONES - i * 9, normal, 8),
      );
    }

    // Recibí conforme: firma, aclaración y fecha de quien recibe.
    pagina.drawRectangle({
      x: MARGEN,
      y: Y_CONFORME,
      width: ANCHO_UTIL,
      height: ALTO_CONFORME,
      borderColor: NEGRO,
      borderWidth: 0.8,
    });
    escribir(pagina, datos.conforme.titulo, MARGEN + 8, Y_CONFORME + ALTO_CONFORME - 13, negrita, 9);
    const anchoCampo = ANCHO_UTIL / datos.conforme.campos.length;
    datos.conforme.campos.forEach((campo, i) => {
      const x0 = MARGEN + i * anchoCampo + 15;
      const x1 = MARGEN + (i + 1) * anchoCampo - 15;
      pagina.drawLine({ start: { x: x0, y: Y_FIRMA }, end: { x: x1, y: Y_FIRMA }, thickness: 0.6, color: NEGRO });
      escribir(pagina, campo, (x0 + x1) / 2, Y_FIRMA - 11, normal, 8, "centro");
    });
  }

  function marcaAnulado(pagina: PDFPage) {
    const texto = "ANULADO";
    const tamano = 110;
    const ancho = negrita.widthOfTextAtSize(texto, tamano);
    const angulo = (35 * Math.PI) / 180;
    pagina.drawText(texto, {
      x: ANCHO / 2 - (ancho / 2) * Math.cos(angulo),
      y: ALTO / 2 - (ancho / 2) * Math.sin(angulo),
      size: tamano,
      font: negrita,
      color: ROJO,
      opacity: 0.18,
      rotate: degrees(35),
    });
  }

  // ----- Armado --------------------------------------------------------------

  const medidos = datos.items.map(medir);
  const paginas = paginar(
    medidos.map((m) => m.alto),
    Y_CUERPO - LIMITE_CUERPO,
    Y_CUERPO - LIMITE_CUERPO_ULTIMA,
  );

  paginas.forEach((indices, numeroPagina) => {
    const pagina = doc.addPage([ANCHO, ALTO]);
    if (datos.anulado) marcaAnulado(pagina);
    encabezado(pagina);
    let y = Y_CUERPO;
    for (const i of indices) {
      renglon(pagina, medidos[i].celdas, y);
      y -= medidos[i].alto;
    }
    if (numeroPagina === paginas.length - 1) pie(pagina);
    escribir(pagina, `Página ${numeroPagina + 1} de ${paginas.length}`, DERECHA, Y_PAGINA, normal, 7.5, "derecha", GRIS);
  });

  return doc.save();
}

/**
 * PDF de un recibo emitido o anulado, con el mismo aspecto que el de los
 * comprobantes: encabezado con logo y datos del emisor, "RECIBO" con número
 * y fecha; cliente; "Recibimos de … la suma de pesos …" con el total en
 * letras; detalle de los medios; comprobantes cancelados; y al pie el
 * total, lo imputado, lo que queda a favor y la firma.
 *
 * Si el cuerpo no entra, sigue en otras páginas: el encabezado y el cliente
 * se repiten, el pie va sólo en la última y todas llevan "Página N de M". Un
 * recibo anulado lleva la marca "ANULADO" en cada página y el motivo al
 * principio. Función pura: los bytes del logo llegan como parámetro.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { crearSaneador, partirEnLineas, recortar } from "@/lib/comprobantes/pdf";
import { paginar } from "@/lib/comprobantes/pdf-datos";
import type { DatosPdfRecibo } from "./pdf-recibo-datos";

// Medidas en puntos. A4 = 595,28 × 841,89.
const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 28;
const DERECHA = ANCHO - MARGEN;
const ARRIBA = ALTO - MARGEN;
const ANCHO_UTIL = DERECHA - MARGEN;

// Encabezado
const ANCHO_LOGO = 130;
const ALTO_LOGO = 48;
const LADO_LETRA = 44;
const X_DATOS = 368;
const X_VALOR = 432;
const Y_FIN_ENCABEZADO = 694;

// Cliente
const Y_CLIENTE = 680;
const X_CLIENTE_DERECHA = 398;
const Y_FIN_CLIENTE = 646;

// Cuerpo
const Y_CUERPO = 632;
const TAMANO_TABLA = 8;
const INTERLINEA_TABLA = 10;
const RELLENO_RENGLON = 4;
const RELLENO_CELDA = 3;
const TAMANO_PARRAFO = 9.5;
const INTERLINEA_PARRAFO = 13;
const ALTO_CABECERA = 16;
const ESPACIO_SECCION = 10;

// Pie
const Y_PAGINA = 16;
const LIMITE_CUERPO = 44;
const LIMITE_CUERPO_ULTIMA = 150;
const Y_REGLA_PIE = 140;
const Y_BANDA = 112;
const ALTO_BANDA = 20;
const Y_FIRMA = 52;

const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.35, 0.35, 0.35);
const FONDO = rgb(0.9, 0.9, 0.9);
const ROJO = rgb(0.75, 0.1, 0.1);

type Alineacion = "izquierda" | "derecha" | "centro";

type Columna = { titulo: string; ancho: number; alinear: Alineacion; ajustar?: boolean };

/** Columnas de cada tabla: suman el ancho útil (539 pt). */
const COLUMNAS_MEDIOS: Columna[] = [
  { titulo: "Medio", ancho: 110, alinear: "izquierda", ajustar: true },
  { titulo: "Detalle", ancho: 319.28, alinear: "izquierda", ajustar: true },
  { titulo: "Importe", ancho: 110, alinear: "derecha" },
];
const COLUMNAS_IMPUTACIONES: Columna[] = [
  { titulo: "Comprobante", ancho: 269.28, alinear: "izquierda", ajustar: true },
  { titulo: "Fecha", ancho: 130, alinear: "izquierda" },
  { titulo: "Importe imputado", ancho: 140, alinear: "derecha" },
];

/** Un bloque del cuerpo, ya medido: se reparte en páginas por su alto. */
type Renglon =
  | { tipo: "parrafo"; lineas: string[]; fuente: PDFFont; color: RGB; alto: number }
  | { tipo: "cabecera"; titulo: string; columnas: Columna[]; alto: number }
  | { tipo: "fila"; columnas: Columna[]; celdas: { lineas: string[]; tamano: number }[]; alto: number }
  | { tipo: "espacio"; alto: number };

export async function generarPdfRecibo(datos: DatosPdfRecibo, logoPng?: Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(datos.nombreArchivo);
  doc.setCreator("Silfe Costos");
  doc.setProducer("Silfe Costos");

  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const sanear = crearSaneador(normal);

  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  if (logoPng) {
    try {
      logo = await doc.embedPng(logoPng);
    } catch {
      // Logo ilegible: el recibo sale sin logo.
    }
  }

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

  function etiquetaValor(pagina: PDFPage, etiqueta: string, valor: string, x: number, y: number, tamano = 8) {
    escribir(pagina, etiqueta, x, y, negrita, tamano);
    escribir(pagina, valor, x + negrita.widthOfTextAtSize(sanear(etiqueta), tamano) + 3, y, normal, tamano);
  }

  function regla(pagina: PDFPage, y: number) {
    pagina.drawLine({ start: { x: MARGEN, y }, end: { x: DERECHA, y }, thickness: 0.6, color: NEGRO });
  }

  // ----- Encabezado y cliente (en todas las páginas) -------------------------

  function encabezado(pagina: PDFPage) {
    let y = ARRIBA;
    if (logo) {
      const escala = Math.min(ANCHO_LOGO / logo.width, ALTO_LOGO / logo.height);
      const alto = logo.height * escala;
      pagina.drawImage(logo, { x: MARGEN, y: y - alto, width: logo.width * escala, height: alto });
      y -= alto + 12;
    } else {
      y -= 12;
    }
    const anchoIzquierda = ANCHO / 2 - LADO_LETRA / 2 - 10 - MARGEN;
    etiquetaValor(pagina, "Razón Social:", datos.emisor.razonSocial, MARGEN, y);
    y -= 11;
    const etiquetaDomicilio = "Domicilio:";
    const xDomicilio = MARGEN + negrita.widthOfTextAtSize(etiquetaDomicilio, 8) + 3;
    escribir(pagina, etiquetaDomicilio, MARGEN, y, negrita, 8);
    for (const linea of recortar(
      partirEnLineas(sanear(datos.emisor.domicilio), normal, 8, MARGEN + anchoIzquierda - xDomicilio),
      3,
    )) {
      escribir(pagina, linea, xDomicilio, y, normal, 8);
      y -= 10;
    }

    // Centro: "X" en un recuadro (documento no fiscal) y la condición de IVA del emisor.
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
    escribir(pagina, "X", xCentro, yCaja + 12, negrita, 30, "centro");
    escribir(pagina, "No válido como factura", xCentro, yCaja - 11, normal, 6.5, "centro");
    escribir(pagina, datos.emisor.condicionIva, xCentro, yCaja - 21, normal, 6.5, "centro");
    pagina.drawLine({
      start: { x: xCentro, y: yCaja - 27 },
      end: { x: xCentro, y: Y_FIN_ENCABEZADO },
      thickness: 0.6,
      color: NEGRO,
    });

    // Derecha: título, número, fecha y datos del emisor.
    escribir(pagina, "RECIBO", X_DATOS, ARRIBA - 14, negrita, 15);
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
    const anchoCliente = X_CLIENTE_DERECHA - 10 - xValor;
    escribir(pagina, "Sr. (es):", MARGEN, Y_CLIENTE, negrita, 8);
    escribir(
      pagina,
      recortar(partirEnLineas(sanear(datos.cliente.razonSocial), negrita, 9, anchoCliente), 1)[0],
      xValor,
      Y_CLIENTE,
      negrita,
      9,
    );
    escribir(pagina, "Domicilio:", MARGEN, Y_CLIENTE - 12, negrita, 8);
    recortar(partirEnLineas(sanear(datos.cliente.domicilio || "—"), normal, 8, anchoCliente), 2).forEach((linea, i) =>
      escribir(pagina, linea, xValor, Y_CLIENTE - 12 - i * 10, normal, 8),
    );
    etiquetaValor(pagina, "CUIT:", datos.cliente.cuit || "—", X_CLIENTE_DERECHA, Y_CLIENTE);
    etiquetaValor(pagina, "Cond. IVA:", datos.cliente.condicionIva || "—", X_CLIENTE_DERECHA, Y_CLIENTE - 12);
    regla(pagina, Y_FIN_CLIENTE);
  }

  // ----- Cuerpo ----------------------------------------------------------------

  function parrafo(texto: string, fuente: PDFFont = normal, color: RGB = NEGRO): Renglon {
    const lineas = partirEnLineas(sanear(texto), fuente, TAMANO_PARRAFO, ANCHO_UTIL);
    return { tipo: "parrafo", lineas, fuente, color, alto: lineas.length * INTERLINEA_PARRAFO + 4 };
  }

  function fila(columnas: Columna[], valores: string[]): Renglon {
    const celdas = columnas.map((columna, i) => {
      const ancho = columna.ancho - RELLENO_CELDA * 2;
      const texto = sanear(valores[i] ?? "");
      if (columna.ajustar) {
        return { lineas: recortar(partirEnLineas(texto, normal, TAMANO_TABLA, ancho), 8), tamano: TAMANO_TABLA };
      }
      const anchoTexto = normal.widthOfTextAtSize(texto, TAMANO_TABLA);
      return { lineas: [texto], tamano: anchoTexto > ancho ? (TAMANO_TABLA * ancho) / anchoTexto : TAMANO_TABLA };
    });
    const lineas = Math.max(...celdas.map((c) => c.lineas.length));
    return { tipo: "fila", columnas, celdas, alto: lineas * INTERLINEA_TABLA + RELLENO_RENGLON };
  }

  const renglones: Renglon[] = [];
  if (datos.anulado) {
    renglones.push(
      parrafo(
        `RECIBO ANULADO${datos.anulado.fecha ? ` el ${datos.anulado.fecha}` : ""}. Motivo: ${datos.anulado.motivo}`,
        negrita,
        ROJO,
      ),
      { tipo: "espacio", alto: 4 },
    );
  }
  renglones.push(parrafo(datos.recibimos));
  if (datos.observaciones) renglones.push(parrafo(`Observaciones: ${datos.observaciones}`));
  renglones.push({ tipo: "espacio", alto: ESPACIO_SECCION });

  renglones.push({ tipo: "cabecera", titulo: "Detalle de los valores recibidos", columnas: COLUMNAS_MEDIOS, alto: ALTO_CABECERA * 2 });
  for (const m of datos.medios) renglones.push(fila(COLUMNAS_MEDIOS, [m.medio, m.detalle, m.importe]));
  renglones.push({ tipo: "espacio", alto: ESPACIO_SECCION });

  renglones.push({
    tipo: "cabecera",
    titulo: "Comprobantes cancelados",
    columnas: COLUMNAS_IMPUTACIONES,
    alto: ALTO_CABECERA * 2,
  });
  if (datos.imputaciones.length === 0) {
    renglones.push(
      parrafo(
        datos.anulado
          ? "Las imputaciones se deshicieron al anular el recibo."
          : "No canceló comprobantes: el importe queda a favor del cliente.",
      ),
    );
  }
  for (const i of datos.imputaciones) renglones.push(fila(COLUMNAS_IMPUTACIONES, [i.comprobante, i.fecha, i.importe]));

  function dibujar(pagina: PDFPage, r: Renglon, yArriba: number) {
    if (r.tipo === "espacio") return;
    if (r.tipo === "parrafo") {
      r.lineas.forEach((linea, i) =>
        escribir(pagina, linea, MARGEN, yArriba - TAMANO_PARRAFO - i * INTERLINEA_PARRAFO, r.fuente, TAMANO_PARRAFO, "izquierda", r.color),
      );
      return;
    }
    if (r.tipo === "cabecera") {
      escribir(pagina, r.titulo, MARGEN, yArriba - 11, negrita, 9.5);
      const yBanda = yArriba - ALTO_CABECERA * 2;
      pagina.drawRectangle({ x: MARGEN, y: yBanda, width: ANCHO_UTIL, height: ALTO_CABECERA - 2, color: FONDO });
      let x = MARGEN;
      for (const columna of r.columnas) {
        const xTexto = columna.alinear === "derecha" ? x + columna.ancho - RELLENO_CELDA : x + RELLENO_CELDA;
        escribir(pagina, columna.titulo, xTexto, yBanda + 4, negrita, 8, columna.alinear);
        x += columna.ancho;
      }
      return;
    }
    let x = MARGEN;
    r.columnas.forEach((columna, i) => {
      const { lineas, tamano } = r.celdas[i];
      const xTexto = columna.alinear === "derecha" ? x + columna.ancho - RELLENO_CELDA : x + RELLENO_CELDA;
      lineas.forEach((linea, l) =>
        escribir(pagina, linea, xTexto, yArriba - TAMANO_TABLA - 2 - l * INTERLINEA_TABLA, normal, tamano, columna.alinear),
      );
      x += columna.ancho;
    });
  }

  // ----- Pie (sólo en la última página) ------------------------------------------

  function pie(pagina: PDFPage) {
    regla(pagina, Y_REGLA_PIE);
    pagina.drawRectangle({ x: MARGEN, y: Y_BANDA, width: ANCHO_UTIL, height: ALTO_BANDA, color: FONDO });
    const yBanda = Y_BANDA + 7;
    etiquetaValor(pagina, "Imputado:", datos.imputado, MARGEN + 6, yBanda, 9);
    if (datos.aFavor) etiquetaValor(pagina, "Queda a favor:", datos.aFavor, MARGEN + 190, yBanda, 9);
    escribir(pagina, `Total: ${datos.total}`, DERECHA - 6, yBanda - 0.5, negrita, 11, "derecha");

    const xFirma = DERECHA - 200;
    pagina.drawLine({ start: { x: xFirma, y: Y_FIRMA }, end: { x: DERECHA, y: Y_FIRMA }, thickness: 0.6, color: NEGRO });
    escribir(pagina, "Firma y aclaración", xFirma + 100, Y_FIRMA - 11, normal, 8, "centro");
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

  // ----- Armado --------------------------------------------------------------------

  const paginas = paginar(
    renglones.map((r) => r.alto),
    Y_CUERPO - LIMITE_CUERPO,
    Y_CUERPO - LIMITE_CUERPO_ULTIMA,
  );

  paginas.forEach((indices, numeroPagina) => {
    const pagina = doc.addPage([ANCHO, ALTO]);
    if (datos.anulado) marcaAnulado(pagina);
    encabezado(pagina);
    let y = Y_CUERPO;
    for (const i of indices) {
      dibujar(pagina, renglones[i], y);
      y -= renglones[i].alto;
    }
    if (numeroPagina === paginas.length - 1) pie(pagina);
    escribir(pagina, `Página ${numeroPagina + 1} de ${paginas.length}`, DERECHA, Y_PAGINA, normal, 7.5, "derecha", GRIS);
  });

  return doc.save();
}

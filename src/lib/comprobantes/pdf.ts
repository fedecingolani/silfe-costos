/**
 * PDF de un comprobante electrónico autorizado, con el formato de la
 * factura del sistema anterior: encabezado con logo, letra y datos del
 * emisor; receptor; tabla de ítems; pie con IVA por alícuota, totales, QR de
 * ARCA y CAE.
 *
 * Si los ítems no entran, siguen en otras páginas: el encabezado y el
 * receptor se repiten, el pie (totales y QR) va sólo en la última y todas
 * llevan "Página N de M". En homologación cada página lleva la marca "SIN
 * VALIDEZ FISCAL". Función pura: los bytes del logo llegan como parámetro.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { paginar, type DatosPdfComprobante, type ItemPdf } from "./pdf-datos";
import { ZONA_SILENCIO, matrizQr } from "./qr-matriz";

// Medidas en puntos. A4 = 595,28 × 841,89.
const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 28;
const DERECHA = ANCHO - MARGEN;
const ARRIBA = ALTO - MARGEN;

// Encabezado
const ANCHO_LOGO = 130;
const ALTO_LOGO = 48;
const LADO_LETRA = 44;
const X_DATOS = 368;
const X_VALOR = 432;
const Y_FIN_ENCABEZADO = 694;

// Receptor y fila de moneda
const Y_RECEPTOR = 680;
const X_RECEPTOR_DERECHA = 398;
const Y_FIN_RECEPTOR = 646;
const Y_MONEDA = 632;
const Y_FIN_MONEDA = 624;

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
const LIMITE_CUERPO_ULTIMA = 168;
const Y_REGLA_PIE = 164;
const Y_IVA = 153;
const Y_BANDA = 126;
const ALTO_BANDA = 18;
const LADO_QR = 85;
const Y_QR = 34;

const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.35, 0.35, 0.35);
const FONDO = rgb(0.9, 0.9, 0.9);
const MARCA = rgb(0.75, 0.1, 0.1);

type Alineacion = "izquierda" | "derecha" | "centro";

type Columna = { titulo: string; ancho: number; alinear: Alineacion; campo: keyof ItemPdf; ajustar?: boolean };

/** Columnas de la tabla: suman el ancho útil de la página (539 pt). */
const COLUMNAS: Columna[] = [
  { titulo: "Cód.", ancho: 42, alinear: "izquierda", campo: "codigo", ajustar: true },
  { titulo: "Artículo", ancho: 130, alinear: "izquierda", campo: "articulo", ajustar: true },
  { titulo: "Observaciones", ancho: 80, alinear: "izquierda", campo: "observaciones", ajustar: true },
  { titulo: "Cantidad", ancho: 45, alinear: "derecha", campo: "cantidad" },
  { titulo: "Precio", ancho: 55, alinear: "derecha", campo: "precio" },
  { titulo: "% Dto.", ancho: 30, alinear: "derecha", campo: "descuento" },
  { titulo: "Importe", ancho: 57, alinear: "derecha", campo: "importe" },
  { titulo: "Alíc. IVA", ancho: 38, alinear: "derecha", campo: "alicuota" },
  { titulo: "Impt. c/IVA", ancho: 62.28, alinear: "derecha", campo: "importeConIva" },
];

/** Arma el texto que la fuente estándar (WinAnsi) puede dibujar: lo que no soporta se cambia por "?". */
function crearSaneador(fuente: PDFFont) {
  const soportados = new Set(fuente.getCharacterSet());
  return (texto: string) =>
    Array.from(texto.replace(/[\t\r\n]+/g, " "))
      .map((c) => (soportados.has(c.codePointAt(0)!) ? c : "?"))
      .join("");
}

/** Corta un texto en líneas que entran en el ancho: por palabras y, si una no entra, por caracteres. */
function partirEnLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  const entra = (t: string) => fuente.widthOfTextAtSize(t, tamano) <= ancho;
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (entra(candidata)) {
      actual = candidata;
      continue;
    }
    if (actual) lineas.push(actual);
    actual = "";
    for (const caracter of Array.from(palabra)) {
      if (actual && !entra(actual + caracter)) {
        lineas.push(actual);
        actual = caracter;
      } else {
        actual += caracter;
      }
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

/** Recorta a la cantidad de líneas dada, marcando con "…" que sigue. */
function recortar(lineas: string[], maximo: number): string[] {
  if (lineas.length <= maximo) return lineas;
  const resto = lineas.slice(0, maximo);
  resto[maximo - 1] = `${resto[maximo - 1].replace(/.$/, "")}…`;
  return resto;
}

export async function generarPdfComprobante(datos: DatosPdfComprobante, logoPng?: Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(datos.nombreArchivo);
  doc.setCreator("Silfe Costos");
  doc.setProducer("Silfe Costos");

  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const cursiva = await doc.embedFont(StandardFonts.HelveticaOblique);
  const sanear = crearSaneador(normal);

  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  if (logoPng) {
    try {
      logo = await doc.embedPng(logoPng);
    } catch {
      // Logo ilegible: el comprobante sale sin logo.
    }
  }

  /** Escribe en la línea base y dada. */
  function escribir(
    pagina: PDFPage,
    texto: string,
    x: number,
    y: number,
    fuente: PDFFont,
    tamano: number,
    alinear: Alineacion = "izquierda",
    color = NEGRO,
  ) {
    const limpio = sanear(texto);
    const ancho = fuente.widthOfTextAtSize(limpio, tamano);
    const xFinal = alinear === "derecha" ? x - ancho : alinear === "centro" ? x - ancho / 2 : x;
    pagina.drawText(limpio, { x: xFinal, y, size: tamano, font: fuente, color });
  }

  /** "Etiqueta: valor", con la etiqueta en negrita. */
  function etiquetaValor(pagina: PDFPage, etiqueta: string, valor: string, x: number, y: number, tamano = 8) {
    escribir(pagina, etiqueta, x, y, negrita, tamano);
    escribir(pagina, valor, x + negrita.widthOfTextAtSize(sanear(etiqueta), tamano) + 3, y, normal, tamano);
  }

  function regla(pagina: PDFPage, y: number) {
    pagina.drawLine({ start: { x: MARGEN, y }, end: { x: DERECHA, y }, thickness: 0.6, color: NEGRO });
  }

  // ----- Encabezado y receptor (en todas las páginas) ------------------------

  function encabezado(pagina: PDFPage) {
    // Izquierda: logo, razón social y domicilio del emisor.
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

    // Centro: letra en un recuadro, código de ARCA y condición de IVA del emisor.
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
    escribir(pagina, datos.codigoArca, xCentro, yCaja - 11, negrita, 9, "centro");
    escribir(pagina, datos.emisor.condicionIva, xCentro, yCaja - 22, normal, 7, "centro");
    pagina.drawLine({
      start: { x: xCentro, y: yCaja - 28 },
      end: { x: xCentro, y: Y_FIN_ENCABEZADO },
      thickness: 0.6,
      color: NEGRO,
    });

    // Derecha: título y datos del comprobante y del emisor.
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

    // Receptor: razón social y domicilio a la izquierda; documento y condición de IVA a la derecha.
    const xValor = MARGEN + 46;
    escribir(pagina, "Sr. (es):", MARGEN, Y_RECEPTOR, negrita, 8);
    const anchoReceptor = X_RECEPTOR_DERECHA - 10 - xValor;
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
    etiquetaValor(
      pagina,
      `${datos.receptor.documentoEtiqueta}:`,
      datos.receptor.documento,
      X_RECEPTOR_DERECHA,
      Y_RECEPTOR,
    );
    etiquetaValor(pagina, "Cond. IVA:", datos.receptor.condicionIva, X_RECEPTOR_DERECHA, Y_RECEPTOR - 12);
    if (datos.asociados.length > 0) {
      // Notas de crédito y débito: el comprobante asociado, achicado si no entra en la columna.
      const etiqueta = "Comprobante asociado:";
      const valor =
        datos.asociados.length > 1 ? `${datos.asociados[0]} y ${datos.asociados.length - 1} más` : datos.asociados[0];
      let tamano = 8;
      const ancho = (t: number) =>
        negrita.widthOfTextAtSize(sanear(etiqueta), t) + 3 + normal.widthOfTextAtSize(sanear(valor), t);
      while (tamano > 6 && ancho(tamano) > DERECHA - X_RECEPTOR_DERECHA) tamano -= 0.5;
      etiquetaValor(pagina, etiqueta, valor, X_RECEPTOR_DERECHA, Y_RECEPTOR - 24, tamano);
    }
    regla(pagina, Y_FIN_RECEPTOR);

    // Moneda, provincia de destino, vencimiento y forma de pago.
    const cuarto = (DERECHA - MARGEN) / 4;
    etiquetaValor(pagina, "Moneda:", datos.moneda, MARGEN, Y_MONEDA);
    etiquetaValor(pagina, "Prov. Destino:", datos.provinciaDestino, MARGEN + cuarto, Y_MONEDA);
    etiquetaValor(pagina, "Fecha Vto.:", datos.fechaVencimientoPago, MARGEN + cuarto * 2, Y_MONEDA);
    etiquetaValor(pagina, "Forma de pago:", datos.formaPago, MARGEN + cuarto * 3, Y_MONEDA);
    regla(pagina, Y_FIN_MONEDA);

    // Cabecera de la tabla, sobre una banda gris.
    pagina.drawRectangle({
      x: MARGEN,
      y: Y_CABECERA_TABLA - ALTO_CABECERA_TABLA,
      width: DERECHA - MARGEN,
      height: ALTO_CABECERA_TABLA,
      color: FONDO,
    });
    let x = MARGEN;
    for (const columna of COLUMNAS) {
      const xTexto =
        columna.alinear === "derecha" ? x + columna.ancho - RELLENO_CELDA : x + RELLENO_CELDA;
      escribir(pagina, columna.titulo, xTexto, Y_CABECERA_TABLA - 10, negrita, 7.5, columna.alinear);
      x += columna.ancho;
    }
  }

  // ----- Renglones -----------------------------------------------------------

  type Celda = { lineas: string[]; tamano: number };

  /** Las columnas de texto se parten en líneas; las de números se achican si no entran. */
  function medir(item: ItemPdf): { celdas: Celda[]; alto: number } {
    const celdas = COLUMNAS.map((columna): Celda => {
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
    COLUMNAS.forEach((columna, i) => {
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
    escribir(
      pagina,
      datos.ivaPorAlicuota.map((a) => `${a.etiqueta}: ${a.importe}`).join("     "),
      MARGEN,
      Y_IVA,
      normal,
      8,
    );

    pagina.drawRectangle({ x: MARGEN, y: Y_BANDA, width: DERECHA - MARGEN, height: ALTO_BANDA, color: FONDO });
    const yBanda = Y_BANDA + 6;
    etiquetaValor(pagina, "Bruto:", datos.bruto, MARGEN + 6, yBanda, 9);
    etiquetaValor(pagina, "No gravado:", datos.noGravado, MARGEN + 130, yBanda, 9);
    etiquetaValor(pagina, "Impuestos:", datos.impuestos, MARGEN + 265, yBanda, 9);
    const total = `Total: ${datos.total}`;
    escribir(pagina, total, DERECHA - 6, yBanda - 0.5, negrita, 10.5, "derecha");

    // QR vectorial: cada tramo horizontal de módulos oscuros es un rectángulo.
    const matriz = matrizQr(datos.qrUrl);
    const modulo = LADO_QR / (matriz.length + ZONA_SILENCIO * 2);
    const origenX = MARGEN + ZONA_SILENCIO * modulo;
    const origenY = Y_QR + LADO_QR - ZONA_SILENCIO * modulo;
    matriz.forEach((fila, f) => {
      let c = 0;
      while (c < fila.length) {
        if (!fila[c]) {
          c += 1;
          continue;
        }
        const inicio = c;
        while (c < fila.length && fila[c]) c += 1;
        pagina.drawRectangle({
          x: origenX + inicio * modulo,
          y: origenY - (f + 1) * modulo,
          width: (c - inicio) * modulo,
          height: modulo,
          color: NEGRO,
        });
      }
    });

    const xLeyenda = MARGEN + LADO_QR + 8;
    escribir(pagina, "ARCA", xLeyenda, Y_QR + 58, negrita, 16);
    escribir(pagina, "Comprobante Autorizado", xLeyenda, Y_QR + 44, negrita, 9);
    partirEnLineas(
      "Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación",
      cursiva,
      6.5,
      200,
    ).forEach((linea, i) => escribir(pagina, linea, xLeyenda, Y_QR + 33 - i * 8, cursiva, 6.5));

    escribir(pagina, `CAE: ${datos.cae}`, DERECHA, Y_QR + 58, negrita, 10, "derecha");
    escribir(pagina, `Fecha Vto. CAE: ${datos.caeVencimiento}`, DERECHA, Y_QR + 44, normal, 9, "derecha");
  }

  function marcaHomologacion(pagina: PDFPage) {
    const texto = "HOMOLOGACIÓN – SIN VALIDEZ FISCAL";
    const tamano = 36;
    const ancho = negrita.widthOfTextAtSize(texto, tamano);
    const angulo = (35 * Math.PI) / 180;
    pagina.drawText(texto, {
      x: ANCHO / 2 - (ancho / 2) * Math.cos(angulo),
      y: ALTO / 2 - (ancho / 2) * Math.sin(angulo),
      size: tamano,
      font: negrita,
      color: MARCA,
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
    if (datos.homologacion) marcaHomologacion(pagina);
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

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { armarRenglones, type Renglon } from "./renglones";
import type { DatosListaDescarga } from "./tipos";

// Medidas en puntos. A4 = 595,28 × 841,89.
const ANCHO_PAGINA = 595.28;
const ALTO_PAGINA = 841.89;
const MARGEN = 50;
const MARGEN_SUPERIOR = 40;
const ANCHO_LOGO = 110;

const TAMANO_TITULO = 14;
const TAMANO_TEXTO = 10;
const TAMANO_DESTACADO = 22;
const INTERLINEA = 14;
const ESPACIO_ENTRE_GRUPOS = 10;
const SANGRIA_REPUESTO = 18;

const X_PRESENTACION = 330;
const X_DERECHA = ANCHO_PAGINA - MARGEN;
/** Espacio entre columnas. */
const SEPARACION = 10;
/** Ancho mínimo de la columna de la presentación, aunque el precio sea muy largo. */
const ANCHO_MINIMO_PRESENTACION = 40;

const NEGRO = rgb(0, 0, 0);

/** Arma el texto que la fuente estándar (WinAnsi) puede dibujar: lo que no soporta se cambia por "?". */
function crearSaneador(fuente: PDFFont) {
  const soportados = new Set(fuente.getCharacterSet());
  return (texto: string) =>
    Array.from(texto.replace(/[\t\r\n]+/g, " "))
      .map((c) => (soportados.has(c.codePointAt(0)!) ? c : "?"))
      .join("");
}

/** Corta una palabra más ancha que el ancho dado en pedazos que entran, por caracteres. */
function cortarPalabra(palabra: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const pedazos: string[] = [];
  let actual = "";
  for (const caracter of Array.from(palabra)) {
    if (actual && fuente.widthOfTextAtSize(actual + caracter, tamano) > ancho) {
      pedazos.push(actual);
      actual = caracter;
    } else {
      actual += caracter;
    }
  }
  if (actual) pedazos.push(actual);
  return pedazos;
}

/**
 * Corta un texto en líneas que entran en el ancho dado: por palabras, y las
 * palabras más anchas que la línea, por caracteres.
 */
function partirEnLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(candidata, tamano) <= ancho) {
      actual = candidata;
      continue;
    }
    if (actual) lineas.push(actual);
    if (fuente.widthOfTextAtSize(palabra, tamano) <= ancho) {
      actual = palabra;
    } else {
      const pedazos = cortarPalabra(palabra, fuente, tamano, ancho);
      lineas.push(...pedazos.slice(0, -1));
      actual = pedazos.at(-1) ?? "";
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

/**
 * Genera el PDF de una lista de precios con el formato de la lista de
 * referencia: logo, título subrayado, productos con sus repuestos y pie.
 * Función pura: los bytes del logo llegan en los datos.
 */
export async function generarPdf(datos: DatosListaDescarga): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(datos.titulo);
  doc.setCreator("Silfe Costos");
  doc.setProducer("Silfe Costos");
  // Fechas fijas de la lista (no la hora de generación): la misma lista da los mismos bytes.
  const creada = new Date(datos.creadoEn);
  if (!Number.isNaN(creada.getTime())) {
    doc.setCreationDate(creada);
    doc.setModificationDate(creada);
  }

  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const sanear = crearSaneador(normal);

  let pagina: PDFPage = doc.addPage([ANCHO_PAGINA, ALTO_PAGINA]);
  /** Borde superior del próximo renglón. */
  let y = ALTO_PAGINA - MARGEN_SUPERIOR;

  function asegurarEspacio(alto: number) {
    if (y - alto < MARGEN) {
      pagina = doc.addPage([ANCHO_PAGINA, ALTO_PAGINA]);
      y = ALTO_PAGINA - MARGEN;
    }
  }

  function escribir(texto: string, x: number, fuente: PDFFont, tamano = TAMANO_TEXTO) {
    pagina.drawText(texto, { x, y: y - tamano, size: tamano, font: fuente, color: NEGRO });
  }

  function escribirCentrado(texto: string, fuente: PDFFont, tamano: number) {
    const ancho = fuente.widthOfTextAtSize(texto, tamano);
    escribir(texto, (ANCHO_PAGINA - ancho) / 2, fuente, tamano);
    return ancho;
  }

  // Logo centrado arriba. Si los bytes no son un PNG válido, la lista sale sin logo.
  if (datos.logo) {
    try {
      const logo = await doc.embedPng(datos.logo);
      const alto = (logo.height / logo.width) * ANCHO_LOGO;
      pagina.drawImage(logo, {
        x: (ANCHO_PAGINA - ANCHO_LOGO) / 2,
        y: y - alto,
        width: ANCHO_LOGO,
        height: alto,
      });
      y -= alto + 20;
    } catch {
      // Logo ilegible: se sigue sin logo.
    }
  }

  // Título centrado, en negrita y subrayado.
  for (const linea of partirEnLineas(sanear(datos.titulo), negrita, TAMANO_TITULO, X_DERECHA - MARGEN)) {
    asegurarEspacio(TAMANO_TITULO + 6);
    const ancho = escribirCentrado(linea, negrita, TAMANO_TITULO);
    const xInicio = (ANCHO_PAGINA - ancho) / 2;
    const yLinea = y - TAMANO_TITULO - 2;
    pagina.drawLine({
      start: { x: xInicio, y: yLinea },
      end: { x: xInicio + ancho, y: yLinea },
      thickness: 0.8,
      color: NEGRO,
    });
    y -= TAMANO_TITULO + 6;
  }
  y -= 16;

  // Renglones. Cada ítem se mide antes de dibujarlo: la descripción, la
  // presentación y el precio van en columnas que no se superponen.
  type ItemMedido = {
    fuente: PDFFont;
    x: number;
    descripcion: string[];
    presentacion: string[];
    precio: string;
    separarAntes: boolean;
  };

  function medir(renglon: Extract<Renglon, { tipo: "item" }>): ItemMedido {
    const fuente = renglon.repuesto ? normal : negrita;
    const x = MARGEN + (renglon.repuesto ? SANGRIA_REPUESTO : 0);
    const texto = sanear([renglon.codigo, renglon.descripcion].filter(Boolean).join(" "));
    const precio = sanear(`${renglon.precio} ${renglon.iva}`);
    const xPrecio = X_DERECHA - fuente.widthOfTextAtSize(precio, TAMANO_TEXTO);
    const anchoPresentacion = Math.max(xPrecio - SEPARACION - X_PRESENTACION, ANCHO_MINIMO_PRESENTACION);
    return {
      fuente,
      x,
      descripcion: partirEnLineas(texto, fuente, TAMANO_TEXTO, X_PRESENTACION - SEPARACION - x),
      presentacion: renglon.presentacion
        ? partirEnLineas(sanear(renglon.presentacion), fuente, TAMANO_TEXTO, anchoPresentacion)
        : [],
      precio,
      separarAntes: renglon.separarAntes,
    };
  }

  function altoDe(item: ItemMedido) {
    return Math.max(item.descripcion.length, item.presentacion.length, 1) * INTERLINEA;
  }

  const renglones = armarRenglones(datos.items);
  const medidos = renglones.map((r) => (r.tipo === "item" ? medir(r) : null));

  renglones.forEach((renglon, indice) => {
    if (renglon.tipo === "etiqueta") {
      // La etiqueta va en la misma página que su primer repuesto (un ítem
      // no se parte entre páginas, así que se reserva el ítem entero).
      const siguiente = medidos[indice + 1];
      asegurarEspacio(INTERLINEA + (siguiente ? altoDe(siguiente) : 0));
      escribir(sanear(renglon.texto), MARGEN + SANGRIA_REPUESTO, normal);
      y -= INTERLINEA;
      return;
    }

    const item = medidos[indice]!;
    if (item.separarAntes) y -= ESPACIO_ENTRE_GRUPOS;
    asegurarEspacio(altoDe(item));

    const lineas = Math.max(item.descripcion.length, item.presentacion.length, 1);
    for (let i = 0; i < lineas; i++) {
      if (item.descripcion[i]) escribir(item.descripcion[i], item.x, item.fuente);
      if (item.presentacion[i]) escribir(item.presentacion[i], X_PRESENTACION, item.fuente);
      if (i === 0) {
        escribir(item.precio, X_DERECHA - item.fuente.widthOfTextAtSize(item.precio, TAMANO_TEXTO), item.fuente);
      }
      y -= INTERLINEA;
    }
  });

  // Pie: texto destacado grande y centrado, y el contacto en negrita a la izquierda.
  const destacado = datos.textoDestacado?.trim();
  if (destacado) {
    y -= 30;
    for (const parrafo of destacado.split(/\r?\n/)) {
      for (const linea of partirEnLineas(sanear(parrafo), negrita, TAMANO_DESTACADO, X_DERECHA - MARGEN)) {
        asegurarEspacio(TAMANO_DESTACADO + 6);
        escribirCentrado(linea, negrita, TAMANO_DESTACADO);
        y -= TAMANO_DESTACADO + 6;
      }
    }
  }

  const contacto = datos.contacto?.trim();
  if (contacto) {
    y -= destacado ? 14 : 30;
    for (const parrafo of contacto.split(/\r?\n/)) {
      for (const linea of partirEnLineas(sanear(parrafo), negrita, TAMANO_TEXTO, X_DERECHA - MARGEN)) {
        asegurarEspacio(INTERLINEA);
        if (linea) escribir(linea, MARGEN, negrita);
        y -= INTERLINEA;
      }
    }
  }

  return doc.save();
}

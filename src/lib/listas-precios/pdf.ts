import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { armarRenglones } from "./renglones";
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

const NEGRO = rgb(0, 0, 0);

/** Arma el texto que la fuente estándar (WinAnsi) puede dibujar: lo que no soporta se cambia por "?". */
function crearSaneador(fuente: PDFFont) {
  const soportados = new Set(fuente.getCharacterSet());
  return (texto: string) =>
    Array.from(texto.replace(/[\t\r\n]+/g, " "))
      .map((c) => (soportados.has(c.codePointAt(0)!) ? c : "?"))
      .join("");
}

/** Corta un texto en líneas que entran en el ancho dado (por palabras). */
function partirEnLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (actual && fuente.widthOfTextAtSize(candidata, tamano) > ancho) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = candidata;
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

  // Renglones.
  for (const renglon of armarRenglones(datos.items)) {
    if (renglon.tipo === "etiqueta") {
      asegurarEspacio(INTERLINEA);
      escribir(sanear(renglon.texto), MARGEN + SANGRIA_REPUESTO, normal);
      y -= INTERLINEA;
      continue;
    }

    const fuente = renglon.repuesto ? normal : negrita;
    const x = MARGEN + (renglon.repuesto ? SANGRIA_REPUESTO : 0);
    const texto = sanear([renglon.codigo, renglon.descripcion].filter(Boolean).join(" "));
    const lineas = partirEnLineas(texto, fuente, TAMANO_TEXTO, X_PRESENTACION - 10 - x);
    const precio = sanear(`${renglon.precio} ${renglon.iva}`);

    if (renglon.separarAntes) y -= ESPACIO_ENTRE_GRUPOS;
    asegurarEspacio(lineas.length * INTERLINEA);

    lineas.forEach((linea, i) => {
      escribir(linea, x, fuente);
      if (i === 0) {
        if (renglon.presentacion) escribir(sanear(renglon.presentacion), X_PRESENTACION, fuente);
        escribir(precio, X_DERECHA - fuente.widthOfTextAtSize(precio, TAMANO_TEXTO), fuente);
      }
      y -= INTERLINEA;
    });
  }

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

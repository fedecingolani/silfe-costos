import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFPage } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generarPdf } from "./pdf";
import { datosDeReferencia, itemsDeReferencia } from "./fixtures";
import type { ItemListaDescarga } from "./tipos";

/** Decodifica un byte de WinAnsi (cp1252) a texto, para los caracteres que usa el test. */
const WIN_ANSI_EXTRA: Record<number, string> = { 0x96: "–", 0x97: "—" };

function streamsDePagina(pagina: PDFPage): PDFRawStream[] {
  const contenido = pagina.node.get(PDFName.of("Contents"));
  const resuelto = contenido ? pagina.doc.context.lookup(contenido) : undefined;
  if (resuelto instanceof PDFArray) {
    return resuelto.asArray().map((ref) => pagina.doc.context.lookup(ref) as PDFRawStream);
  }
  return resuelto ? [resuelto as PDFRawStream] : [];
}

/** Texto dibujado con un operador Tj y su posición (x, y de la línea base). */
type Fragmento = { x: number; y: number; texto: string };

function decodificar(hex: string): string {
  return Array.from(Buffer.from(hex, "hex"))
    .map((b) => WIN_ANSI_EXTRA[b] ?? String.fromCharCode(b))
    .join("");
}

/** Extrae los textos de los operadores Tj de una página, en el orden en que se dibujan. */
function fragmentosDePagina(pagina: PDFPage): Fragmento[] {
  return streamsDePagina(pagina).flatMap((stream) => {
    const filtro = stream.dict.get(PDFName.of("Filter"));
    const bytes = filtro ? inflateSync(stream.contents) : stream.contents;
    const operadores = Buffer.from(bytes).toString("latin1");
    return [...operadores.matchAll(/(-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]*)>\s*Tj/g)].map(([, x, y, hex]) => ({
      x: Number(x),
      y: Number(y),
      texto: decodificar(hex),
    }));
  });
}

/** Texto de una página: cada Tj en una línea. */
function textoDePagina(pagina: PDFPage): string {
  return fragmentosDePagina(pagina)
    .map((f) => f.texto)
    .join("\n");
}

async function leer(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const paginas = doc.getPages().map(textoDePagina);
  const fragmentos = doc.getPages().map(fragmentosDePagina);
  return { doc, paginas, fragmentos, texto: paginas.join("\n") };
}

// Columnas del PDF (en puntos): la descripción termina 10 puntos antes de la presentación.
const X_PRESENTACION = 330;
const LIMITE_DESCRIPCION = X_PRESENTACION - 10;

afterEach(() => {
  vi.useRealTimers();
});

describe("generarPdf", () => {
  it("devuelve un PDF", async () => {
    const bytes = await generarPdf(datosDeReferencia);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
  });

  it("contiene el título, las descripciones, la presentación y los precios", async () => {
    const { texto, doc } = await leer(await generarPdf(datosDeReferencia));
    expect(doc.getPageCount()).toBe(1);
    expect(texto).toContain("LISTA DE PRECIOS DICIEMBRE 2023");
    expect(texto).toContain("001 Recolector grande con correa reforzada");
    expect(texto).toContain("Repuestos:");
    expect(texto).toContain("101 Correa para recolector");
    expect(texto).toContain("x docena");
    expect(texto).toContain("$ 24.500 + IVA (21%)");
    expect(texto).toContain("$ 9.750,50 + IVA (10,5%)");
    expect(texto).toContain("Flete a cargo del cliente – consultar");
  });

  it("imprime el pie con el texto destacado y el contacto", async () => {
    const { texto } = await leer(await generarPdf(datosDeReferencia));
    expect(texto).toContain("SIL – FE 30 AÑOS");
    expect(texto).toContain("Ventas: (0299) 555-1234");
    expect(texto).toContain("Cipolletti, Río Negro");
  });

  it("omite el pie si no está configurado", async () => {
    const { texto } = await leer(
      await generarPdf({ ...datosDeReferencia, textoDestacado: null, contacto: null }),
    );
    expect(texto).not.toContain("SIL – FE");
    expect(texto).not.toContain("Ventas:");
  });

  it("reemplaza los caracteres que la fuente no puede dibujar", async () => {
    const { texto } = await leer(
      await generarPdf({
        ...datosDeReferencia,
        items: [{ ...itemsDeReferencia[0], descripcion: "Recolector ↳ especial ✓" }],
      }),
    );
    expect(texto).toContain("001 Recolector ? especial ?");
  });

  it("parte en varias páginas una lista larga sin perder ni repetir ítems", async () => {
    const items: ItemListaDescarga[] = Array.from({ length: 120 }, (_, i) => ({
      ...itemsDeReferencia[i % 4],
      codigo: String(i + 1).padStart(3, "0"),
      descripcion: `Artículo número ${String(i + 1).padStart(3, "0")}`,
    }));
    const { doc, paginas, texto } = await leer(await generarPdf({ ...datosDeReferencia, items }));
    expect(doc.getPageCount()).toBeGreaterThan(1);

    let anterior = -1;
    for (const item of items) {
      const linea = `${item.codigo} ${item.descripcion}`;
      const apariciones = texto.split("\n").filter((l) => l === linea).length;
      expect(apariciones, linea).toBe(1);
      const posicion = texto.indexOf(linea);
      expect(posicion, linea).toBeGreaterThan(anterior);
      anterior = posicion;
    }
    expect(paginas.at(-1)).toContain("SIL – FE 30 AÑOS");
  });

  it("corta las palabras más largas que la columna de la descripción", async () => {
    const palabra = "W".repeat(150);
    const { fragmentos } = await leer(
      await generarPdf({
        ...datosDeReferencia,
        items: [{ ...itemsDeReferencia[0], descripcion: `Recolector ${palabra}` }],
      }),
    );
    const negrita = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    const partes = fragmentos.flat().filter((f) => f.texto.includes("WWW"));
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.map((f) => f.texto.replace(/[^W]/g, "")).join("")).toBe(palabra);
    for (const parte of partes) {
      expect(parte.x + negrita.widthOfTextAtSize(parte.texto, 10)).toBeLessThanOrEqual(LIMITE_DESCRIPCION);
    }
  });

  it("la presentación larga no se superpone con el precio", async () => {
    const presentacion = "Caja de cartón corrugado reforzado para exportación de 24 unidades surtidas";
    const { fragmentos } = await leer(
      await generarPdf({
        ...datosDeReferencia,
        items: [{ ...itemsDeReferencia[4], presentacion, precio_final: 123456789.5 }],
      }),
    );
    const negrita = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    const todos = fragmentos.flat();
    const precio = todos.find((f) => f.texto.startsWith("$ "));
    expect(precio).toBeDefined();
    const partes = todos.filter((f) => f.x === X_PRESENTACION);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.map((f) => f.texto).join(" ")).toBe(`x ${presentacion.toLowerCase()}`);
    for (const parte of partes) {
      expect(parte.x + negrita.widthOfTextAtSize(parte.texto, 10)).toBeLessThan(precio!.x);
    }
  });

  it("no deja la etiqueta de repuestos sola al pie de una página", async () => {
    // Variando la cantidad de repuestos del primer grupo, la etiqueta del
    // segundo grupo cae en cada posición posible del final de la página.
    let paginasRevisadas = 0;
    for (let cantidad = 30; cantidad <= 75; cantidad++) {
      const items: ItemListaDescarga[] = [
        itemsDeReferencia[0],
        ...Array.from({ length: cantidad }, (_, i) => ({
          ...itemsDeReferencia[1],
          codigo: `R${String(i).padStart(3, "0")}`,
        })),
        { ...itemsDeReferencia[4], codigo: "900" },
        { ...itemsDeReferencia[1], codigo: "901" },
      ];
      const { fragmentos } = await leer(
        await generarPdf({ ...datosDeReferencia, items, textoDestacado: null, contacto: null }),
      );
      for (const pagina of fragmentos.slice(0, -1)) {
        paginasRevisadas += 1;
        expect(pagina.at(-1)?.texto, `con ${cantidad} repuestos`).not.toBe("Repuestos:");
      }
    }
    expect(paginasRevisadas).toBeGreaterThan(0);
  });

  it("genera los mismos bytes para la misma lista, con las fechas de su creación", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const primera = await generarPdf(datosDeReferencia);
    vi.setSystemTime(new Date("2031-06-15T10:30:00Z"));
    const segunda = await generarPdf(datosDeReferencia);
    vi.useRealTimers();

    expect(Buffer.from(segunda).equals(Buffer.from(primera))).toBe(true);
    const doc = await PDFDocument.load(primera, { updateMetadata: false });
    expect(doc.getCreationDate()?.toISOString()).toBe("2023-12-01T12:00:00.000Z");
    expect(doc.getModificationDate()?.toISOString()).toBe("2023-12-01T12:00:00.000Z");
  });

  it("incluye el logo cuando se lo pasa", async () => {
    const logo = new Uint8Array(readFileSync("public/logo-silfe.png"));
    const sinLogo = await generarPdf(datosDeReferencia);
    const conLogo = await generarPdf({ ...datosDeReferencia, logo });
    expect(conLogo.length).toBeGreaterThan(sinLogo.length + 1000);
    const { texto } = await leer(conLogo);
    expect(texto).toContain("LISTA DE PRECIOS DICIEMBRE 2023");
  });

  it("ignora un logo que no se puede leer", async () => {
    const bytes = await generarPdf({ ...datosDeReferencia, logo: new Uint8Array([1, 2, 3]) });
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
  });
});

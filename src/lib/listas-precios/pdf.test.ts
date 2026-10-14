import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
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

/** Extrae el texto de los operadores Tj de una página (cada uno en una línea). */
function textoDePagina(pagina: PDFPage): string {
  return streamsDePagina(pagina)
    .map((stream) => {
      const filtro = stream.dict.get(PDFName.of("Filter"));
      const bytes = filtro ? inflateSync(stream.contents) : stream.contents;
      const operadores = Buffer.from(bytes).toString("latin1");
      return [...operadores.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)]
        .map(([, hex]) =>
          Array.from(Buffer.from(hex, "hex"))
            .map((b) => WIN_ANSI_EXTRA[b] ?? String.fromCharCode(b))
            .join(""),
        )
        .join("\n");
    })
    .join("\n");
}

async function leer(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const paginas = doc.getPages().map(textoDePagina);
  return { doc, paginas, texto: paginas.join("\n") };
}

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

  it("parte en varias páginas una lista larga", async () => {
    const items: ItemListaDescarga[] = Array.from({ length: 120 }, (_, i) => ({
      ...itemsDeReferencia[i % 4],
      codigo: String(i + 1).padStart(3, "0"),
    }));
    const { doc, paginas } = await leer(await generarPdf({ ...datosDeReferencia, items }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(paginas.join("\n")).toContain("120 ");
    expect(paginas.at(-1)).toContain("SIL – FE 30 AÑOS");
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

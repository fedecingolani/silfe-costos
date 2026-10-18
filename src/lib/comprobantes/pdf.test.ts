import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { generarPdfComprobante } from "./pdf";
import { armarDatosPdf } from "./pdf-datos";
import { ejemploConItems } from "./pdf-fixtures";

/** Bytes WinAnsi (cp1252) que usa el test y no coinciden con latin1. */
const WIN_ANSI_EXTRA: Record<number, string> = { 0x96: "–" };

function streamsDePagina(pagina: PDFPage): PDFRawStream[] {
  const contenido = pagina.node.get(PDFName.of("Contents"));
  const resuelto = contenido ? pagina.doc.context.lookup(contenido) : undefined;
  if (resuelto instanceof PDFArray) {
    return resuelto.asArray().map((ref) => pagina.doc.context.lookup(ref) as PDFRawStream);
  }
  return resuelto ? [resuelto as PDFRawStream] : [];
}

/** Textos de los operadores Tj de una página, uno por línea. */
function textoDePagina(pagina: PDFPage): string {
  return streamsDePagina(pagina)
    .flatMap((stream) => {
      const filtro = stream.dict.get(PDFName.of("Filter"));
      const bytes = filtro ? inflateSync(stream.contents) : stream.contents;
      const operadores = Buffer.from(bytes).toString("latin1");
      return [...operadores.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map(([, hex]) =>
        Array.from(Buffer.from(hex, "hex"))
          .map((b) => WIN_ANSI_EXTRA[b] ?? String.fromCharCode(b))
          .join(""),
      );
    })
    .join("\n");
}

async function generar(n: number, ambiente: "produccion" | "homologacion" = "produccion") {
  const bytes = await generarPdfComprobante(armarDatosPdf(ejemploConItems(n, ambiente)));
  const doc = await PDFDocument.load(bytes);
  return { bytes, doc, paginas: doc.getPages().map(textoDePagina) };
}

describe("generarPdfComprobante", () => {
  it("imprime el comprobante asociado debajo del receptor en una nota de crédito", async () => {
    const ejemplo = ejemploConItems(1);
    const datos = armarDatosPdf({
      ...ejemplo,
      comprobante: { ...ejemplo.comprobante, clase: "nota_credito", tipo_arca: 3 },
      asociados: [{ tipo_arca: 1, punto_venta: 7, numero: 361, fecha: "2026-10-10" }],
    });
    const doc = await PDFDocument.load(await generarPdfComprobante(datos));
    const texto = textoDePagina(doc.getPages()[0]);
    expect(texto).toContain("NOTA DE CRÉDITO");
    expect(texto).toContain("Comprobante asociado:");
    expect(texto).toContain("A-00007-00000361 del 10/10/2026");
  });

  it("genera un PDF de una página con los datos del comprobante", async () => {
    const { bytes, paginas } = await generar(1);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(paginas).toHaveLength(1);
    const texto = paginas[0];
    for (const esperado of [
      "FACTURA DE VENTA",
      "A",
      "001",
      "A-00007-00000361",
      "16/10/2026",
      "30-71234567-1",
      "SILFE S.A.",
      "Frutícola del Valle S.R.L.",
      "Pesos Argentinos",
      "Cuenta Corriente",
      "P-001",
      "Producto 1",
      "1.210,00",
      "$ 1.210,00",
      "Comprobante Autorizado",
      "76123456789012",
      "Página 1 de 1",
    ]) {
      expect(texto).toContain(esperado);
    }
    expect(texto).not.toContain("HOMOLOGACIÓN");
  });

  it("reparte 40 ítems en varias páginas, con el encabezado en todas y el pie sólo en la última", async () => {
    const { paginas } = await generar(40);
    expect(paginas.length).toBeGreaterThan(1);
    const total = paginas.length;
    paginas.forEach((texto, i) => {
      expect(texto).toContain("A-00007-00000361");
      expect(texto).toContain("Frutícola del Valle S.R.L.");
      expect(texto).toContain(`Página ${i + 1} de ${total}`);
      const ultima = i === total - 1;
      expect(texto.includes("Comprobante Autorizado")).toBe(ultima);
      expect(texto.includes("$ 48.400,00")).toBe(ultima);
    });
    const todos = paginas.join("\n");
    for (let i = 1; i <= 40; i++) expect(todos).toContain(`P-${String(i).padStart(3, "0")}`);
  });

  it("marca cada página de homologación como sin validez fiscal", async () => {
    const { paginas } = await generar(40, "homologacion");
    for (const texto of paginas) expect(texto).toContain("HOMOLOGACIÓN – SIN VALIDEZ FISCAL");
  });

  it("dibuja el QR como rectángulos, sin imágenes", async () => {
    const { bytes } = await generar(1);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("/Image");
  });

  it("sale sin logo si los bytes no son un PNG", async () => {
    const bytes = await generarPdfComprobante(armarDatosPdf(ejemploConItems(1)), new Uint8Array([1, 2, 3]));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { generarPdfRecibo } from "./pdf-recibo";
import { armarDatosPdfRecibo } from "./pdf-recibo-datos";
import { MEDIOS_EJEMPLO, ejemploRecibo, ejemploReciboAnulado } from "./pdf-recibo-fixtures";

/** Bytes WinAnsi (cp1252) que no coinciden con latin1. */
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

async function generar(ejemplo: ReturnType<typeof ejemploRecibo>) {
  const bytes = await generarPdfRecibo(armarDatosPdfRecibo(ejemplo));
  const doc = await PDFDocument.load(bytes);
  return { doc, paginas: doc.getPages().map(textoDePagina) };
}

describe("generarPdfRecibo", () => {
  it("imprime encabezado, cliente, importe en letras, medios, comprobantes y pie", async () => {
    const { doc, paginas } = await generar(ejemploRecibo());
    expect(paginas).toHaveLength(1);
    expect(doc.getTitle()).toBe("Recibo R-00001-00000042");
    const texto = paginas[0];
    for (const esperado of [
      "RECIBO",
      "R-00001-00000042",
      "18/10/2026",
      "SILFE S.A.",
      "30-71234567-1",
      "Frutícola del Valle S.R.L.",
      "30-69876543-2",
      "Responsable Inscripto",
      "Efectivo",
      "Banco Patagonia cta. 123-456/7 · Ref. TRF 998877",
      "Pago 15/11/2026",
      "IIBB (Río Negro) · Certificado RN-0001-000123 · 18/10/2026",
      "Factura A-00007-00000361",
      "600.000,00",
      "Queda a favor:",
      "$ 234.567,89",
      "Total: $ 1.234.567,89",
      "Firma y aclaración",
      "Página 1 de 1",
    ]) {
      expect(texto).toContain(esperado);
    }
    expect(texto.replace(/\n/g, " ")).toContain("UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL");
    expect(texto).not.toContain("ANULADO");
  });

  it("un recibo anulado lleva la marca, la fecha y el motivo", async () => {
    const { paginas } = await generar(ejemploReciboAnulado());
    expect(paginas[0]).toContain("ANULADO");
    expect(paginas[0].replace(/\n/g, " ")).toContain("RECIBO ANULADO el 18/10/2026. Motivo: Cargado al cliente equivocado.");
    expect(paginas[0]).toContain("Las imputaciones se deshicieron al anular el recibo.");
  });

  it("pagina como el comprobante: encabezado en todas, pie sólo en la última", async () => {
    const ejemplo = ejemploRecibo();
    const muchos = Array.from({ length: 80 }, (_, i) => ({ ...MEDIOS_EJEMPLO[2], orden: i + 1 }));
    const { paginas } = await generar({ ...ejemplo, medios: muchos });
    expect(paginas.length).toBeGreaterThan(1);
    paginas.forEach((texto, i) => {
      expect(texto).toContain("RECIBO");
      expect(texto).toContain("Frutícola del Valle S.R.L.");
      expect(texto).toContain(`Página ${i + 1} de ${paginas.length}`);
      expect(texto.includes("Firma y aclaración")).toBe(i === paginas.length - 1);
    });
  });
});

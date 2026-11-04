import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { EMISOR_EJEMPLO, IDENTIDAD_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import { PNG_1X1 } from "@/lib/empresa/logo-fixtures";
import { generarPdfRemito } from "./pdf";
import { armarDatosPdfRemito } from "./pdf-datos";
import { CLIENTE_REMITO_EJEMPLO, ITEM_REMITO_EJEMPLO, REMITO_EJEMPLO, ejemploRemitoConItems } from "./pdf-fixtures";

/** Bytes WinAnsi (cp1252) que no coinciden con latin1. */
const WIN_ANSI_EXTRA: Record<number, string> = { 0x96: "–", 0x85: "…", 0x97: "—" };

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

function datos(cambios: Partial<Parameters<typeof armarDatosPdfRemito>[0]> = {}) {
  return armarDatosPdfRemito({
    remito: REMITO_EJEMPLO,
    cliente: CLIENTE_REMITO_EJEMPLO,
    transporte: "Expreso Alto Valle",
    items: [ITEM_REMITO_EJEMPLO],
    emisor: EMISOR_EJEMPLO,
    identidad: IDENTIDAD_EJEMPLO,
    ...cambios,
  });
}

async function textos(d: ReturnType<typeof datos>, logo: Uint8Array | null = null) {
  const doc = await PDFDocument.load(await generarPdfRemito(d, logo));
  return { doc, paginas: doc.getPages().map(textoDePagina) };
}

describe("generarPdfRemito", () => {
  it("dibuja el remito: letra R, leyenda, número, entrega, bultos, valor declarado y recibí conforme", async () => {
    const { doc, paginas } = await textos(datos(), PNG_1X1);
    expect(doc.getTitle()).toBe("Remito R-00001-00000001");
    expect(paginas).toHaveLength(1);
    const texto = paginas[0];
    for (const esperado of [
      "REMITO",
      "R",
      "Documento no válido",
      "como factura",
      "R-00001-00000001",
      "04/11/2026",
      "SIL - FE",
      "Frutícola del Valle S.R.L.",
      "30-69876543-2",
      "Expreso Alto Valle",
      "Ruta 151 Km 4, Cinco Saltos, Río Negro",
      "Bultos",
      "Bultos total: 12",
      "Valor declarado: $ 1.500.000,00",
      "Entregar por la tarde",
      "Recibí conforme",
      "Firma",
      "Aclaración",
      "Fecha",
      "Total: $ 1.694.000,00",
      "Página 1 de 1",
    ]) {
      expect(texto.split("\n")).toContain(esperado);
    }
  });

  it("no lleva nada fiscal: ni CAE, ni la leyenda de ARCA", async () => {
    const { paginas } = await textos(datos());
    expect(paginas[0]).not.toMatch(/CAE|ARCA|Comprobante Autorizado/);
  });

  it("sin precios no dibuja las columnas de precio ni los totales", async () => {
    const { paginas } = await textos(datos({ conPrecios: false }));
    const lineas = paginas[0].split("\n");
    expect(lineas).not.toContain("Precio");
    expect(lineas).not.toContain("Importe");
    expect(paginas[0]).not.toMatch(/Total: \$/);
    expect(lineas).toContain("Bultos total: 12");
    expect(lineas).toContain("Valor declarado: $ 1.500.000,00");
  });

  it("sin transporte ni domicilio de entrega muestra —", async () => {
    const { paginas } = await textos(
      datos({ transporte: null, remito: { ...REMITO_EJEMPLO, domicilio_entrega: null } }),
    );
    expect(paginas[0].split("\n").filter((l) => l === "—").length).toBeGreaterThanOrEqual(2);
  });

  it("pagina los ítems: el pie (bultos, valor declarado y conforme) sólo en la última", async () => {
    const ejemplo = ejemploRemitoConItems(90);
    const { paginas } = await textos(datos({ remito: ejemplo.remito, items: ejemplo.items }));
    expect(paginas.length).toBeGreaterThan(1);
    paginas.forEach((texto, i) => {
      expect(texto).toContain(`Página ${i + 1} de ${paginas.length}`);
      expect(texto).toContain("R-00001-00000001");
      const esUltima = i === paginas.length - 1;
      expect(texto.includes("Recibí conforme")).toBe(esUltima);
      expect(texto.includes("Bultos total: 90")).toBe(esUltima);
    });
    expect(paginas.join("\n")).toContain("P-090");
  });

  it("un remito anulado lleva la marca ANULADO", async () => {
    const { paginas } = await textos(datos({ remito: { ...REMITO_EJEMPLO, estado: "anulado" } }));
    expect(paginas[0].split("\n")).toContain("ANULADO");
  });
});

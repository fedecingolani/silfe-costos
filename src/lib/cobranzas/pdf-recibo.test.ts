import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { JPEG_1X1, PNG_1X1 } from "@/lib/empresa/logo-fixtures";
import { generarPdfRecibo } from "./pdf-recibo";
import { armarDatosPdfRecibo } from "./pdf-recibo-datos";
import { MEDIOS_EJEMPLO, ejemploRecibo, ejemploReciboAnulado } from "./pdf-recibo-fixtures";
import { IDENTIDAD_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import type { IdentidadPdf } from "@/lib/empresa/pdf-empresa";

/** Bytes WinAnsi (cp1252) que no coinciden con latin1. */
const WIN_ANSI_EXTRA: Record<number, string> = { 0x96: "–", 0x85: "…" };

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

type TextoUbicado = { texto: string; fuente: string; tamano: number; x: number; y: number };

/** Textos del bloque izquierdo del encabezado (logo, emisor y contacto), con fuente, tamaño y línea base. */
function bloqueIzquierdo(pagina: PDFPage): TextoUbicado[] {
  const operadores = streamsDePagina(pagina)
    .map((stream) => {
      const filtro = stream.dict.get(PDFName.of("Filter"));
      return Buffer.from(filtro ? inflateSync(stream.contents) : stream.contents).toString("latin1");
    })
    .join("\n");
  return [
    ...operadores.matchAll(
      /\/(Helvetica[\w-]*?)-\d+ ([\d.]+) Tf\s+\d+ TL\s+1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g,
    ),
  ]
    .map(([, fuente, tamano, x, y, hex]) => ({
      texto: Array.from(Buffer.from(hex, "hex"))
        .map((b) => WIN_ANSI_EXTRA[b] ?? String.fromCharCode(b))
        .join(""),
      fuente,
      tamano: Number(tamano),
      x: Number(x),
      y: Number(y),
    }))
    .filter((t) => t.x < 250 && t.y > 694);
}

/** Lo que el encabezado imprimía antes del nombre de fantasía y el contacto, con un logo de 48 pt de alto. */
const BLOQUE_SIN_IDENTIDAD: TextoUbicado[] = [
  { texto: "Razón Social:", fuente: "Helvetica-Bold", tamano: 8, x: 28, y: 753.89 },
  { texto: "EMPRESA DE EJEMPLO S.A.", fuente: "Helvetica", tamano: 8, x: 83.456, y: 753.89 },
  { texto: "Domicilio:", fuente: "Helvetica-Bold", tamano: 8, x: 28, y: 742.89 },
  { texto: "Ruta 22 Km 1200, General Roca, Río Negro", fuente: "Helvetica", tamano: 8, x: 69.672, y: 742.89 },
];

const NOMBRE_LARGO = "COMERCIALIZADORA Y FABRICANTE DE ELEMENTOS DE COSECHA DEL ALTO VALLE – SIL - FE";
const CONTACTO_LARGO =
  "Tel. (0298) 444-5555 / 15-412-3456 · administracion.ventas@elementosdecosecha.com.ar · www.elementosdecosecha.com.ar";

/** Ancho que ocupa un texto ubicado, con las mismas fuentes estándar. */
async function medidor() {
  const doc = await PDFDocument.create();
  const fuentes: Record<string, PDFFont> = {
    Helvetica: await doc.embedFont(StandardFonts.Helvetica),
    "Helvetica-Bold": await doc.embedFont(StandardFonts.HelveticaBold),
  };
  return (t: TextoUbicado) => t.x + fuentes[t.fuente].widthOfTextAtSize(t.texto, t.tamano);
}

/** Primera página del recibo de ejemplo con la identidad dada. */
async function paginaRecibo(identidad: IdentidadPdf | undefined, logo: Uint8Array | null) {
  const bytes = await generarPdfRecibo(armarDatosPdfRecibo({ ...ejemploRecibo(), identidad }), logo);
  return (await PDFDocument.load(bytes)).getPages()[0];
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
      "EMPRESA DE EJEMPLO S.A.",
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

describe("generarPdfRecibo: logo", () => {
  it.each([
    ["PNG", PNG_1X1],
    ["JPEG", JPEG_1X1],
  ])("incluye el logo %s", async (_tipo, logo) => {
    const bytes = await generarPdfRecibo(armarDatosPdfRecibo(ejemploRecibo()), logo);
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Image");
  });

  it("sale sin logo si los bytes no son una imagen", async () => {
    const bytes = await generarPdfRecibo(armarDatosPdfRecibo(ejemploRecibo()), new Uint8Array([1, 2, 3]));
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("/Image");
  });
});

describe("generarPdfRecibo: nombre de fantasía y contacto", () => {
  it("sin identidad, el encabezado queda exactamente como antes", async () => {
    const pagina = await paginaRecibo(undefined, PNG_1X1);
    expect(bloqueIzquierdo(pagina)).toEqual(BLOQUE_SIN_IDENTIDAD);
  });

  it("imprime el nombre arriba, destacado, y el contacto en letra chica debajo del domicilio", async () => {
    const pagina = await paginaRecibo(IDENTIDAD_EJEMPLO, PNG_1X1);
    const bloque = bloqueIzquierdo(pagina);
    expect(bloque.map((t) => t.texto)).toEqual([
      "SIL - FE",
      "Razón Social:",
      "EMPRESA DE EJEMPLO S.A.",
      "Domicilio:",
      "Ruta 22 Km 1200, General Roca, Río Negro",
      "Tel. 0298 444-5555 · ventas@ejemplo.com.ar · www.ejemplo.com.ar",
    ]);
    const [nombre, razonSocial, , domicilio, , contacto] = bloque;
    expect(nombre).toMatchObject({ fuente: "Helvetica-Bold", y: 753.89 });
    expect(nombre.tamano).toBeGreaterThan(razonSocial.tamano);
    expect(razonSocial.y).toBeLessThan(nombre.y - nombre.tamano);
    expect(contacto.tamano).toBeLessThan(8);
    expect(contacto.y).toBeLessThan(domicilio.y);
    expect(contacto.y).toBeGreaterThan(694 + 3);
  });

  it("omite la línea que no tiene dato", async () => {
    const soloContacto = bloqueIzquierdo(await paginaRecibo({ nombreFantasia: "", contacto: "Tel. 0298 444-5555" }, null)).map((t) => t.texto);
    expect(soloContacto[0]).toBe("Razón Social:");
    expect(soloContacto.at(-1)).toBe("Tel. 0298 444-5555");
    const soloNombre = bloqueIzquierdo(await paginaRecibo({ nombreFantasia: "SIL - FE", contacto: "" }, null)).map((t) => t.texto);
    expect(soloNombre[0]).toBe("SIL - FE");
    expect(soloNombre.at(-1)).toBe("Ruta 22 Km 1200, General Roca, Río Negro");
  });

  it("recorta un nombre y un contacto largos sin invadir el centro del encabezado", async () => {
    const pagina = await paginaRecibo({ nombreFantasia: NOMBRE_LARGO, contacto: CONTACTO_LARGO }, PNG_1X1);
    const bloque = bloqueIzquierdo(pagina);
    const ancho = await medidor();
    const nombre = bloque[0];
    const contacto = bloque.at(-1)!;
    expect(nombre.texto.endsWith("…")).toBe(true);
    expect(contacto.texto.endsWith("…")).toBe(true);
    for (const t of [nombre, contacto]) expect(ancho(t)).toBeLessThanOrEqual(248);
    expect(contacto.y).toBeGreaterThan(694 + 3);
  });
});

import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { JPEG_1X1, PNG_1X1 } from "@/lib/empresa/logo-fixtures";
import { generarPdfComprobante } from "./pdf";
import { armarDatosPdfPresupuesto } from "@/lib/presupuestos/pdf-datos";
import { armarDatosPdf } from "./pdf-datos";
import { IDENTIDAD_EJEMPLO, ejemploConItems, ejemploX } from "./pdf-fixtures";
import type { IdentidadPdf } from "@/lib/empresa/pdf-empresa";

/** Bytes WinAnsi (cp1252) que usa el test y no coinciden con latin1. */
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

/** Primera página de la factura de ejemplo con la identidad dada. */
async function paginaFactura(identidad: IdentidadPdf | undefined, logo: Uint8Array | null) {
  const bytes = await generarPdfComprobante(armarDatosPdf({ ...ejemploConItems(1), identidad }), logo);
  return (await PDFDocument.load(bytes)).getPages()[0];
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
      "EMPRESA DE EJEMPLO S.A.",
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

  it.each([
    ["PNG", PNG_1X1],
    ["JPEG", JPEG_1X1],
  ])("incluye el logo %s", async (_tipo, logo) => {
    const bytes = await generarPdfComprobante(armarDatosPdf(ejemploConItems(1)), logo);
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Image");
  });

  it("sale sin logo si los bytes no son una imagen", async () => {
    const bytes = await generarPdfComprobante(armarDatosPdf(ejemploConItems(1)), new Uint8Array([1, 2, 3]));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("generarPdfComprobante: no gravado y período asociado", () => {
  it("imprime la línea No gravado, \"No grav.\" en el renglón y el período asociado", async () => {
    const { comprobante, items, emisor } = ejemploConItems(1);
    const datos = armarDatosPdf({
      comprobante: {
        ...comprobante,
        clase: "nota_debito",
        tipo_arca: 2,
        no_gravado: 150000,
        total: comprobante.total + 150000,
        periodo_asoc_desde: "2026-10-01",
        periodo_asoc_hasta: "2026-10-15",
      },
      items: [...items, { ...items[0], gravado: false, alicuota_iva: null, importe: 150000, iva: 0 }],
      emisor,
    });
    const doc = await PDFDocument.load(await generarPdfComprobante(datos));
    const texto = doc.getPages().map(textoDePagina).join("\n");
    expect(texto).toContain("No gravado:");
    expect(texto).toContain("150.000,00");
    expect(texto).toContain("No grav.");
    expect(texto).toContain("Período asociado:");
    expect(texto).toContain("01/10/2026 – 15/10/2026");
  });
});

describe("generarPdfComprobante: presupuesto", () => {
  it("titula PRESUPUESTO con número P-… y validez, sin letra, CAE ni QR", async () => {
    const { items, emisor } = ejemploConItems(1);
    const datos = armarDatosPdfPresupuesto({
      presupuesto: {
        numero: 49,
        fecha: "2026-10-24",
        valido_hasta: "2026-11-08",
        fecha_vencimiento_pago: "2026-10-24",
        condicion_pago: "contado",
        neto: 1000,
        no_gravado: 0,
        iva: 210,
        total: 1210,
      },
      cliente: {
        razon_social: "Frutícola del Valle S.R.L.",
        cuit: "30698765432",
        condicion_iva: "Responsable Inscripto",
        direccion: null,
        localidad: null,
        provincia: "Río Negro",
      },
      items,
      emisor,
    });
    const bytes = await generarPdfComprobante(datos);
    const texto = (await PDFDocument.load(bytes)).getPages().map(textoDePagina).join("\n");
    for (const esperado of ["PRESUPUESTO", "P-00000049", "Válido hasta:", "08/11/2026", "$ 1.210,00", "Página 1 de 1"]) {
      expect(texto).toContain(esperado);
    }
    for (const ausente of ["CAE", "Comprobante Autorizado", "ARCA", "FACTURA"]) expect(texto).not.toContain(ausente);
  });

  it("una factura no lleva la validez del presupuesto", async () => {
    const { paginas } = await generar(1);
    expect(paginas[0]).not.toContain("Válido hasta");
    expect(paginas[0]).not.toContain("no válido como factura");
  });
});

describe("generarPdfComprobante: comprobante X", () => {
  it("recuadro X con la leyenda de no válido como factura, sin CAE, QR, ARCA ni IVA", async () => {
    const bytes = await generarPdfComprobante(armarDatosPdf(ejemploX()));
    const texto = (await PDFDocument.load(bytes)).getPages().map(textoDePagina).join("\n");
    for (const esperado of [
      "FACTURA DE VENTA",
      "X",
      "X-09999-00000001",
      "Documento no válido",
      "como factura",
      "Precio c/Dto.",
      "Importe",
      "1.400.000,00",
      "$ 1.400.000,00",
      "Página 1 de 1",
    ]) {
      expect(texto).toContain(esperado);
    }
    for (const ausente of ["CAE", "Comprobante Autorizado", "ARCA", "Alíc. IVA", "Impt. c/IVA", "IVA 21", "Impuestos:", "21%"]) {
      expect(texto).not.toContain(ausente);
    }
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("HOMOLOGACI");
  });
});

describe("generarPdfComprobante: nombre de fantasía y contacto", () => {
  it("sin identidad, el encabezado queda exactamente como antes", async () => {
    const pagina = await paginaFactura(undefined, PNG_1X1);
    expect(bloqueIzquierdo(pagina)).toEqual(BLOQUE_SIN_IDENTIDAD);
  });

  it("imprime el nombre arriba, destacado, y el contacto en letra chica debajo del domicilio", async () => {
    const pagina = await paginaFactura(IDENTIDAD_EJEMPLO, PNG_1X1);
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
    const soloContacto = bloqueIzquierdo(await paginaFactura({ nombreFantasia: "", contacto: "Tel. 0298 444-5555" }, null)).map((t) => t.texto);
    expect(soloContacto[0]).toBe("Razón Social:");
    expect(soloContacto.at(-1)).toBe("Tel. 0298 444-5555");
    const soloNombre = bloqueIzquierdo(await paginaFactura({ nombreFantasia: "SIL - FE", contacto: "" }, null)).map((t) => t.texto);
    expect(soloNombre[0]).toBe("SIL - FE");
    expect(soloNombre.at(-1)).toBe("Ruta 22 Km 1200, General Roca, Río Negro");
  });

  it("recorta un nombre y un contacto largos sin invadir el centro del encabezado", async () => {
    const pagina = await paginaFactura({ nombreFantasia: NOMBRE_LARGO, contacto: CONTACTO_LARGO }, PNG_1X1);
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

import type { PDFDocument, PDFImage } from "pdf-lib";
import { tipoDeImagen } from "./validacion";

/**
 * Incrusta el logo en el documento como PNG o JPEG según sus bytes. Si no hay
 * logo o no se puede leer, devuelve null y el PDF sale sin logo.
 */
export async function incrustarLogo(doc: PDFDocument, bytes: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!bytes) return null;
  try {
    const tipo = tipoDeImagen(bytes);
    if (tipo === "image/png") return await doc.embedPng(bytes);
    if (tipo === "image/jpeg") return await doc.embedJpg(bytes);
    return null;
  } catch {
    return null;
  }
}

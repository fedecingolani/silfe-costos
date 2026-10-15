/**
 * Utilidades mínimas de XML para los sobres SOAP de ARCA. Las respuestas
 * tienen una estructura fija y chica: alcanza con buscar etiquetas por
 * nombre, sin un parser completo.
 */

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function desescaparXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Contenido de la primera etiqueta con ese nombre (con o sin prefijo de namespace). */
export function etiqueta(xml: string, nombre: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`);
  return xml.match(re)?.[1]?.trim() ?? null;
}

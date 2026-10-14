/** Nombre de archivo ASCII a partir del nombre de la lista: "Lista Año 1" → "lista-ano-1". */
export function slugArchivo(nombre: string): string {
  const slug = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "lista-de-precios";
}

/** Codifica según RFC 5987 (encodeURIComponent deja sin codificar ' ( ) * !). */
function codificarRfc5987(texto: string): string {
  return encodeURIComponent(texto).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Content-Disposition de descarga, con nombre ASCII y nombre UTF-8 para los navegadores que lo soportan. */
export function dispositionAdjunto(nombre: string, extension: "pdf" | "xlsx"): string {
  const ascii = `${slugArchivo(nombre)}.${extension}`;
  const utf8 = codificarRfc5987(`${nombre.trim()}.${extension}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

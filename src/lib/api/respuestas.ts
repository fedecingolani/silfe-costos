/**
 * Respuestas JSON de la API (/api/v1/*). Los errores siguen el contrato de
 * odd/tasks/api-compras.md: `{ "error": { "codigo", "mensaje" } }`.
 */

/** Estados de error que usa la API. */
export type EstadoError = 400 | 401 | 404 | 409 | 422 | 500;

/** Códigos de error estables (los lee Factura Digital). */
export const CODIGOS_ERROR = {
  JSON_INVALIDO: "JSON_INVALIDO",
  NO_AUTORIZADO: "NO_AUTORIZADO",
  NO_ENCONTRADO: "NO_ENCONTRADO",
  PROVEEDOR_EXISTE: "PROVEEDOR_EXISTE",
  VALIDACION: "VALIDACION",
  PROVEEDOR_NO_EXISTE: "PROVEEDOR_NO_EXISTE",
  ERROR_INTERNO: "ERROR_INTERNO",
} as const;

export type CodigoError = (typeof CODIGOS_ERROR)[keyof typeof CODIGOS_ERROR];

const ENCABEZADOS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: ENCABEZADOS });
}

/** Error del contrato. `extra` suma claves al cuerpo (p. ej. el proveedor existente en un 409). */
export function errorApi(
  estado: EstadoError,
  codigo: CodigoError,
  mensaje: string,
  extra: Record<string, unknown> = {},
): Response {
  return respuestaJson({ error: { codigo, mensaje }, ...extra }, estado);
}

export function errorInterno(): Response {
  return errorApi(500, CODIGOS_ERROR.ERROR_INTERNO, "Error interno. Probá de nuevo más tarde.");
}

/** El cuerpo JSON del pedido, o la respuesta 400 para devolver. */
export async function leerJson(request: Request): Promise<{ datos: unknown } | { respuesta: Response }> {
  try {
    return { datos: await request.json() };
  } catch {
    return { respuesta: errorApi(400, CODIGOS_ERROR.JSON_INVALIDO, "El cuerpo del pedido no es JSON válido.") };
  }
}

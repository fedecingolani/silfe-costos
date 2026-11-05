/**
 * Mensajes legibles de los errores de la base al guardar, confirmar, anular
 * o borrar comprobantes de compra (SQLSTATE CP001–CP009, ver
 * 20261105000003_comprobantes_compra.sql). Cada código trae su pista (HINT)
 * con el motivo: se busca por las dos, por si llega sólo una. Las acciones
 * devuelven el mensaje en lugar de lanzarlo.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string; hint?: string | null };

const INMUTABLE = "El comprobante está confirmado o anulado: no se puede modificar.";
const TRANSICION = "El comprobante cambió de estado. Recargá la página.";
const BORRADO = "Sólo se pueden borrar comprobantes en borrador. Uno confirmado se anula.";
const INEXISTENTE = "No se encontró el comprobante. Puede que lo hayan borrado.";
const SIN_ITEMS = "Agregá al menos un renglón antes de confirmar el comprobante.";
const TOTAL = "El total del comprobante tiene que ser mayor que cero.";
const OTRO_PROVEEDOR = "Hay renglones con artículos de otro proveedor. Elegí artículos del proveedor del comprobante.";
const ALICUOTA = "Los comprobantes B y C no discriminan IVA: sacá la alícuota de los renglones.";

const PROPIOS: Record<string, string> = {
  CP001: INMUTABLE,
  comprobante_inmutable: INMUTABLE,
  CP002: TRANSICION,
  transicion_invalida: TRANSICION,
  CP003: BORRADO,
  borrado_no_permitido: BORRADO,
  CP004: INEXISTENTE,
  comprobante_inexistente: INEXISTENTE,
  CP005: SIN_ITEMS,
  comprobante_sin_items: SIN_ITEMS,
  CP006: TOTAL,
  total_no_positivo: TOTAL,
  CP008: OTRO_PROVEEDOR,
  articulo_de_otro_proveedor: OTRO_PROVEEDOR,
  CP009: ALICUOTA,
  alicuota_no_discriminada: ALICUOTA,
  "23503": "El proveedor, un artículo o una materia prima ya no existen. Recargá la página.",
};

/** El mensaje de la base dice qué artículo no tiene materia prima. */
const SIN_MATERIA_PRIMA = new Set(["CP007", "articulo_sin_materia_prima"]);

/** Claves únicas (23505), por nombre del índice. */
const MENSAJES_UNICO: [indice: string, mensaje: string][] = [
  ["comprobante_compra_numero_unico", "Ese comprobante de ese proveedor ya está cargado."],
  ["proveedor_articulo_", "Ese artículo ya está en el catálogo del proveedor. Recargá la página."],
];

/** Controles de la tabla (23514), por nombre de la restricción. */
const MENSAJES_CONTROL: [restriccion: string, mensaje: string][] = [
  ["comprobante_compra_percepcion_jurisdiccion_check", "Indicá la jurisdicción de cada percepción de ingresos brutos."],
  ["comprobante_compra_percepcion_", "Revisá las percepciones: cada una tiene tipo e importe mayor que cero."],
  ["comprobante_compra_vencimiento_check", "El vencimiento no puede ser anterior a la fecha del comprobante."],
  ["comprobante_compra_punto_venta_check", "El punto de venta va de 1 a 99999."],
  ["comprobante_compra_numero_check", "El número del comprobante tiene que ser mayor que cero."],
  ["comprobante_compra_item_", "Revisá los renglones: hay datos que no son válidos."],
  ["proveedor_articulo_", "Revisá los artículos nuevos: la descripción es obligatoria y el factor, mayor que cero."],
];

function porNombre(lista: [string, string][], mensaje: string): string | undefined {
  return lista.find(([nombre]) => mensaje.includes(nombre))?.[1];
}

/**
 * Mensaje legible de un error de la base.
 * @param accion lo que se intentaba, para un error sin traducción («confirmar el comprobante»).
 */
export function mensajeErrorComprobanteCompra(error: ErrorBase, accion = "guardar el comprobante"): string {
  if (error.code === "23505") {
    const unico = porNombre(MENSAJES_UNICO, error.message);
    if (unico) return unico;
  }
  if (error.code === "23514") {
    const control = porNombre(MENSAJES_CONTROL, error.message);
    if (control) return control;
  }
  if ((error.code && SIN_MATERIA_PRIMA.has(error.code)) || (error.hint && SIN_MATERIA_PRIMA.has(error.hint))) {
    return `${error.message} Asociala en el catálogo del proveedor.`;
  }
  // Object.hasOwn: una pista como "constructor" no tiene que encontrar lo heredado de Object.
  const propio = (clave: string | null | undefined) => (clave && Object.hasOwn(PROPIOS, clave) ? PROPIOS[clave] : undefined);
  return propio(error.code) ?? propio(error.hint) ?? `No se pudo ${accion}: ${error.message}`;
}

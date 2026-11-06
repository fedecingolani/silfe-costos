/**
 * Mensajes legibles de los errores de la base al guardar, recibir, anular
 * o borrar remitos de compra y al facturarlos (SQLSTATE RC001–RC011, ver
 * 20261105000007_remitos_compra.sql). Cada código trae su pista (HINT) con
 * el motivo: se busca por las dos, por si llega sólo una. Las acciones
 * devuelven el mensaje en lugar de lanzarlo.
 */

import { mensajeErrorComprobanteCompra, type ErrorBase } from "@/lib/compras/comprobantes/errores";

export type { ErrorBase };

const INMUTABLE = "El remito está recibido o anulado: no se puede modificar.";
const TRANSICION = "El remito cambió de estado. Recargá la página.";
const BORRADO = "Sólo se pueden borrar remitos en borrador. Uno recibido se anula.";
const INEXISTENTE = "No se encontró el remito. Puede que lo hayan borrado.";
const SIN_ITEMS = "Agregá al menos un renglón antes de registrar el remito como recibido.";
const OTRO_PROVEEDOR = "Hay renglones con artículos de otro proveedor. Elegí artículos del proveedor del remito.";
const FACTURADO = "El remito tiene cantidades facturadas: no se puede anular. Anulá o borrá antes las facturas que lo usan.";
const FACTURACION =
  "No se pueden facturar esos renglones: tienen que ser de remitos recibidos del mismo proveedor, con el mismo artículo y en una factura.";
const SIN_ARTICULO = "Cada renglón del remito lleva un artículo del proveedor: elegilo del catálogo o cargalo como nuevo.";

const PROPIOS: Record<string, string> = {
  RC001: INMUTABLE,
  remito_inmutable: INMUTABLE,
  RC002: TRANSICION,
  transicion_invalida: TRANSICION,
  RC003: BORRADO,
  borrado_no_permitido: BORRADO,
  RC004: INEXISTENTE,
  remito_inexistente: INEXISTENTE,
  RC005: SIN_ITEMS,
  remito_sin_items: SIN_ITEMS,
  RC006: OTRO_PROVEEDOR,
  articulo_de_otro_proveedor: OTRO_PROVEEDOR,
  RC008: FACTURADO,
  remito_facturado: FACTURADO,
  RC009: FACTURACION,
  facturacion_invalida: FACTURACION,
  RC011: SIN_ARTICULO,
  renglon_sin_articulo: SIN_ARTICULO,
  "23503": "El proveedor, un artículo o una materia prima ya no existen. Recargá la página.",
};

/** El mensaje de la base dice qué artículo no tiene materia prima. */
const SIN_MATERIA_PRIMA = new Set(["RC007", "articulo_sin_materia_prima"]);

/** El mensaje de la base dice qué renglón y cuánto queda pendiente. */
const EXCEDE_PENDIENTE = new Set(["RC010", "excede_pendiente"]);

/** Claves únicas (23505), por nombre del índice. */
const MENSAJES_UNICO: [indice: string, mensaje: string][] = [
  ["remito_compra_numero_unico", "Ese remito de ese proveedor ya está cargado."],
  ["proveedor_articulo_", "Ese artículo ya está en el catálogo del proveedor. Recargá la página."],
];

/** Controles de la tabla (23514), por nombre de la restricción. */
const MENSAJES_CONTROL: [restriccion: string, mensaje: string][] = [
  ["remito_compra_punto_venta_check", "El punto de venta va de 1 a 99999."],
  ["remito_compra_numero_check", "El número del remito tiene que ser mayor que cero."],
  ["remito_compra_item_", "Revisá los renglones: cada uno lleva descripción y una cantidad mayor que cero."],
  ["proveedor_articulo_", "Revisá los artículos nuevos: la descripción es obligatoria y el factor, mayor que cero."],
];

function porNombre(lista: [string, string][], mensaje: string): string | undefined {
  return lista.find(([nombre]) => mensaje.includes(nombre))?.[1];
}

function esDe(conjunto: Set<string>, error: ErrorBase): boolean {
  return Boolean((error.code && conjunto.has(error.code)) || (error.hint && conjunto.has(error.hint)));
}

/**
 * Mensaje legible de un error de la base.
 * @param accion lo que se intentaba, para un error sin traducción («recibir el remito»).
 */
export function mensajeErrorRemitoCompra(error: ErrorBase, accion = "guardar el remito"): string {
  if (error.code === "23505") {
    const unico = porNombre(MENSAJES_UNICO, error.message);
    if (unico) return unico;
  }
  if (error.code === "23514") {
    const control = porNombre(MENSAJES_CONTROL, error.message);
    if (control) return control;
  }
  if (esDe(SIN_MATERIA_PRIMA, error)) return `${error.message} Asociala en el catálogo del proveedor.`;
  if (esDe(EXCEDE_PENDIENTE, error)) return error.message;
  // Object.hasOwn: una pista como "constructor" no tiene que encontrar lo heredado de Object.
  const propio = (clave: string | null | undefined) => (clave && Object.hasOwn(PROPIOS, clave) ? PROPIOS[clave] : undefined);
  return propio(error.code) ?? propio(error.hint) ?? `No se pudo ${accion}: ${error.message}`;
}

/**
 * Mensaje de un error de facturar_remitos_compra: los RC (remitos elegidos,
 * pendiente) se traducen como remitos; el resto viene de guardar la factura
 * (número repetido, deadlock, controles de la tabla) y se traduce como
 * comprobante. Se decide por el código: varias pistas se repiten en los dos.
 */
export function mensajeErrorFacturarRemitosCompra(error: ErrorBase): string {
  if (error.code?.startsWith("RC")) return mensajeErrorRemitoCompra(error, "facturar los remitos");
  return mensajeErrorComprobanteCompra(error, "facturar los remitos");
}

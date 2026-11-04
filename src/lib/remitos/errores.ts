/**
 * Mensajes legibles de los errores de la base al guardar, emitir, anular,
 * borrar o facturar remitos (SQLSTATE RM001–RM010, ver
 * 20261104000001_remitos.sql y 20261104000003_remitos_facturacion.sql).
 * Cada código trae su pista (HINT) con el motivo: se busca por las dos, por
 * si llega sólo una. Las acciones devuelven el mensaje en lugar de lanzarlo.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string; hint?: string | null };

const PROPIOS: Record<string, string> = {
  RM001: "El remito está anulado: no se puede modificar.",
  remito_anulado_inmutable: "El remito está anulado: no se puede modificar.",
  RM002: "El remito cambió de estado. Recargá la página.",
  transicion_invalida: "El remito cambió de estado. Recargá la página.",
  RM003: "Sólo se pueden borrar remitos en borrador. Un remito emitido se anula.",
  borrado_no_permitido: "Sólo se pueden borrar remitos en borrador. Un remito emitido se anula.",
  RM004: "No se encontró el remito. Puede que lo hayan borrado.",
  remito_inexistente: "No se encontró el remito. Puede que lo hayan borrado.",
  RM005: "Agregá al menos un ítem antes de emitir el remito.",
  remito_sin_items: "Agregá al menos un ítem antes de emitir el remito.",
  RM006: "En un remito emitido no se cambian el número, el punto de venta ni el cliente.",
  campo_no_editable: "En un remito emitido no se cambian el número, el punto de venta ni el cliente.",
  RM007: "El punto de venta no existe o no está activo.",
  punto_venta_invalido: "El punto de venta no existe o no está activo.",
  RM008:
    "El remito tiene cantidades facturadas: no se puede modificar ni anular. Borrá antes los borradores de factura que lo usan.",
  remito_facturado:
    "El remito tiene cantidades facturadas: no se puede modificar ni anular. Borrá antes los borradores de factura que lo usan.",
  "23503":
    "El cliente, el transporte, la lista de precios, el punto de venta o un producto ya no existen. Recargá la página.",
};

/**
 * Se muestran con el mensaje de la base, que dice el detalle: qué ítem, de
 * qué remito y cuánto queda pendiente.
 */
const CON_MENSAJE_DE_LA_BASE = new Set(["RM009", "facturacion_invalida", "RM010", "excede_pendiente"]);

/** Controles de la tabla (23514), por nombre de la restricción. */
const MENSAJES_CONTROL: [restriccion: string, mensaje: string][] = [
  ["remito_item_bultos_check", "Los bultos de cada ítem tienen que ser un número entero, 0 o más."],
  ["remito_valor_declarado_check", "El valor declarado no puede ser negativo."],
  ["remito_vencimiento_check", "El vencimiento del cobro no puede ser anterior a la fecha."],
  ["remito_condicion_pago_check", "Elegí la condición de pago."],
  ["remito_item_", "Revisá los ítems: hay datos que no son válidos."],
];

/**
 * Mensaje legible de un error de la base.
 * @param accion lo que se intentaba, para un error sin traducción («emitir el remito»).
 */
export function mensajeErrorRemito(error: ErrorBase, accion = "guardar el remito"): string {
  if (error.code === "23514") {
    const control = MENSAJES_CONTROL.find(([restriccion]) => error.message.includes(restriccion));
    if (control) return control[1];
  }
  if ((error.code && CON_MENSAJE_DE_LA_BASE.has(error.code)) || (error.hint && CON_MENSAJE_DE_LA_BASE.has(error.hint))) {
    return error.message;
  }
  // Al facturar, los triggers del comprobante (CMxxx) pueden rechazar el borrador: su mensaje ya es legible.
  if (error.code?.startsWith("CM")) return `No se pudo ${accion}: ${error.message}`;
  // Object.hasOwn: una pista como "constructor" no tiene que encontrar lo heredado de Object.
  const propio = (clave: string | null | undefined) => (clave && Object.hasOwn(PROPIOS, clave) ? PROPIOS[clave] : undefined);
  return propio(error.code) ?? propio(error.hint) ?? `No se pudo ${accion}: ${error.message}`;
}

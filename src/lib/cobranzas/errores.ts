/**
 * Mensajes legibles de los errores de la base de cobranzas (SQLSTATE CB0xx,
 * ver 20261026000001_cobranzas.sql y
 * 20261028000001_cobranzas_cartera.sql). Los mensajes de la base ya están en
 * castellano y dicen el detalle (importes, comprobante): para esos se
 * muestra el de la base. Los demás tienen un texto propio.
 */

const PROPIOS: Record<string, string> = {
  CB001: "El recibo ya no es un borrador: no se puede modificar. Recargá la página.",
  CB002: "El recibo cambió de estado. Recargá la página.",
  CB013: "No se encontró el recibo. Puede que lo hayan borrado.",
  CB014: "No se pudo asignar el número del recibo. Volvé a intentar.",
  CB021: "No se encontró el cheque. Recargá la página.",
  "23503": "El cliente o el comprobante ya no existen. Recargá la página.",
  "23514": "Hay un dato inválido en los medios de pago: revisá importes, cheques y retenciones.",
};

/** Los que se muestran con el mensaje de la base (dice el importe o el comprobante). */
const CON_MENSAJE_DE_LA_BASE = new Set([
  "CB003",
  "CB004",
  "CB005",
  "CB006",
  "CB007",
  "CB008",
  "CB009",
  "CB010",
  "CB012",
  "CB015",
  "CB016",
  "CB017",
  "CB018",
  "CB019",
  "CB020",
  "CB022",
]);

export function mensajeErrorCobranza(error: { code?: string; message: string }, contexto = "guardar el recibo"): string {
  const code = error.code ?? "";
  if (CON_MENSAJE_DE_LA_BASE.has(code)) return error.message;
  return PROPIOS[code] ?? `No se pudo ${contexto}: ${error.message}`;
}

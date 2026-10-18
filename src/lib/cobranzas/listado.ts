/**
 * Listado de cobranzas: filtros que llegan por la URL y nombres para
 * mostrar el estado del recibo.
 */
import { ESTADOS_RECIBO, type EstadoRecibo } from "@/lib/tipos";
import { esFechaValida } from "@/lib/comprobantes/validacion";

export type FiltrosCobranzas = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Texto para buscar el cliente (razón social, CUIT o código). */
  cliente: string;
  estado: EstadoRecibo | "";
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

/** Filtros del listado. Valores desconocidos se ignoran. */
export function leerFiltrosCobranzas(parametros: Parametros): FiltrosCobranzas {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const estado = primero(parametros.estado);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    cliente: primero(parametros.cliente),
    estado: (ESTADOS_RECIBO as readonly string[]).includes(estado) ? (estado as EstadoRecibo) : "",
  };
}

export const NOMBRES_ESTADO_RECIBO: Record<EstadoRecibo, string> = {
  borrador: "Borrador",
  emitido: "Emitido",
  anulado: "Anulado",
};

export const TONO_ESTADO_RECIBO: Record<EstadoRecibo, "neutro" | "verde" | "rojo"> = {
  borrador: "neutro",
  emitido: "verde",
  anulado: "rojo",
};

/** Resumen de la confirmación de emisión. */
export function resumenEmision(total: string, cliente: string): string {
  return `Se va a emitir el recibo por ${total} a ${cliente}. No se puede modificar después.`;
}

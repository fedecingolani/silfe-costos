/**
 * Listado de presupuestos: filtros que llegan por la URL, número visible,
 * estados y vencimiento.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto } from "@/lib/tipos";

export type FiltrosPresupuestos = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Texto para buscar el cliente (razón social, CUIT o código). */
  cliente: string;
  estado: EstadoPresupuesto | "";
  /** Sólo los abiertos cuya validez ya pasó. */
  vencidos: boolean;
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

/** Filtros del listado. Valores desconocidos se ignoran; vencidos=1 activa el de vencidos. */
export function leerFiltros(parametros: Parametros): FiltrosPresupuestos {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const estado = primero(parametros.estado);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    cliente: primero(parametros.cliente),
    estado: (ESTADOS_PRESUPUESTO as readonly string[]).includes(estado) ? (estado as EstadoPresupuesto) : "",
    vencidos: primero(parametros.vencidos) === "1",
  };
}

/** P-00000001 */
export function numeroPresupuesto(numero: number | string): string {
  return `P-${String(numero).padStart(8, "0")}`;
}

export const NOMBRES_ESTADO_PRESUPUESTO: Record<EstadoPresupuesto, string> = {
  abierto: "Abierto",
  convertido: "Convertido",
};

export const TONO_ESTADO_PRESUPUESTO: Record<EstadoPresupuesto, "neutro" | "verde"> = {
  abierto: "neutro",
  convertido: "verde",
};

/**
 * true si la validez ya pasó (vence al terminar el día "válido hasta").
 * Sólo tiene sentido para un presupuesto abierto: el que llama mira el
 * estado. Un vencido se puede convertir igual.
 *
 * @param hoy fecha de hoy en Argentina, yyyy-mm-dd.
 */
export function estaVencido(validoHasta: string, hoy: string): boolean {
  return esFechaValida(validoHasta) && esFechaValida(hoy) && validoHasta < hoy;
}

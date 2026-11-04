/**
 * Listado de remitos: filtros que llegan por la URL, estados y tonos de la
 * pastilla. El estado que se filtra y se muestra es el derivado
 * (v_remito_estado.estado): parcial y facturado salen de lo facturado.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { ESTADOS_REMITO, NOMBRES_ESTADO_REMITO, type EstadoRemito } from "@/lib/tipos";

export { NOMBRES_ESTADO_REMITO };

export type FiltrosRemitos = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Texto para buscar el cliente (razón social, CUIT o código). */
  cliente: string;
  estado: EstadoRemito | "";
  /** Número del punto de venta, o null para todos. */
  puntoVenta: number | null;
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

/** Número de punto de venta (entero positivo) o null. */
function leerPuntoVenta(valor: string): number | null {
  return /^\d+$/.test(valor) && Number(valor) > 0 ? Number(valor) : null;
}

/** Filtros del listado. Valores desconocidos se ignoran. El punto de venta llega como punto_venta. */
export function leerFiltros(parametros: Parametros): FiltrosRemitos {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const estado = primero(parametros.estado);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    cliente: primero(parametros.cliente),
    estado: (ESTADOS_REMITO as readonly string[]).includes(estado) ? (estado as EstadoRemito) : "",
    puntoVenta: leerPuntoVenta(primero(parametros.punto_venta)),
  };
}

/** Consulta de URL con sólo los filtros aplicados; vacía si no hay ninguno. */
export function consultaFiltros(filtros: FiltrosRemitos): string {
  const consulta = new URLSearchParams();
  if (filtros.desde) consulta.set("desde", filtros.desde);
  if (filtros.hasta) consulta.set("hasta", filtros.hasta);
  if (filtros.cliente) consulta.set("cliente", filtros.cliente);
  if (filtros.estado) consulta.set("estado", filtros.estado);
  if (filtros.puntoVenta !== null) consulta.set("punto_venta", String(filtros.puntoVenta));
  return consulta.toString();
}

export const TONO_ESTADO_REMITO: Record<EstadoRemito, "neutro" | "azul" | "ambar" | "verde" | "rojo"> = {
  borrador: "neutro",
  emitido: "azul",
  parcial: "ambar",
  facturado: "verde",
  anulado: "rojo",
};

/**
 * Listado de comprobantes de compra: filtros que llegan por la URL, nombres
 * y tonos de los estados, y qué se puede hacer en cada estado.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import {
  ESTADOS_COMPROBANTE_COMPRA,
  TIPOS_COMPROBANTE_COMPRA,
  type EstadoComprobanteCompra,
  type TipoComprobanteCompra,
} from "@/lib/tipos";

export type FiltrosComprobantesCompra = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Id del proveedor o vacío. */
  proveedor: string;
  tipo: TipoComprobanteCompra | "";
  estado: EstadoComprobanteCompra | "";
};

type Parametros = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

function deLista<T extends string>(lista: readonly T[], valor: string): T | "" {
  return (lista as readonly string[]).includes(valor) ? (valor as T) : "";
}

/** Filtros del listado. Valores desconocidos se ignoran. */
export function leerFiltros(parametros: Parametros): FiltrosComprobantesCompra {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const proveedor = primero(parametros.proveedor);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    proveedor: UUID.test(proveedor) ? proveedor : "",
    tipo: deLista(TIPOS_COMPROBANTE_COMPRA, primero(parametros.tipo)),
    estado: deLista(ESTADOS_COMPROBANTE_COMPRA, primero(parametros.estado)),
  };
}

/** Consulta de URL con sólo los filtros aplicados; vacía si no hay ninguno. */
export function consultaFiltros(filtros: FiltrosComprobantesCompra): string {
  const consulta = new URLSearchParams();
  if (filtros.desde) consulta.set("desde", filtros.desde);
  if (filtros.hasta) consulta.set("hasta", filtros.hasta);
  if (filtros.proveedor) consulta.set("proveedor", filtros.proveedor);
  if (filtros.tipo) consulta.set("tipo", filtros.tipo);
  if (filtros.estado) consulta.set("estado", filtros.estado);
  return consulta.toString();
}

export const NOMBRES_ESTADO_COMPROBANTE_COMPRA: Record<EstadoComprobanteCompra, string> = {
  borrador: "Borrador",
  confirmado: "Confirmado",
  anulado: "Anulado",
};

export const TONO_ESTADO_COMPROBANTE_COMPRA: Record<EstadoComprobanteCompra, "neutro" | "verde" | "rojo"> = {
  borrador: "neutro",
  confirmado: "verde",
  anulado: "rojo",
};

/**
 * | Estado     | Se puede                     |
 * | ---------- | ---------------------------- |
 * | borrador   | editar, confirmar, borrar    |
 * | confirmado | anular                       |
 * | anulado    | ver                          |
 */
export function permisosComprobanteCompra(estado: EstadoComprobanteCompra) {
  return {
    puedeEditar: estado === "borrador",
    puedeConfirmar: estado === "borrador",
    puedeBorrar: estado === "borrador",
    puedeAnular: estado === "confirmado",
  };
}

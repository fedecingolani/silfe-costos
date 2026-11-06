/**
 * Listado de órdenes de pago: filtros que llegan por la URL, nombres y tonos
 * del estado, el resumen de la confirmación y los avisos que viajan por la
 * URL después de guardar, confirmar o anular (la navegación vuelve a montar
 * la pantalla y perdería el mensaje).
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { aCentavos, textoPesos } from "@/lib/cobranzas/dinero";
import { ESTADOS_ORDEN_PAGO, type EstadoOrdenPago } from "@/lib/tipos";

export type FiltrosPagos = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Id del proveedor o vacío. */
  proveedor: string;
  estado: EstadoOrdenPago | "";
};

type Parametros = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

/** Filtros del listado. Valores desconocidos se ignoran. */
export function leerFiltrosPagos(parametros: Parametros): FiltrosPagos {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const proveedor = primero(parametros.proveedor);
  const estado = primero(parametros.estado);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    proveedor: UUID.test(proveedor) ? proveedor : "",
    estado: (ESTADOS_ORDEN_PAGO as readonly string[]).includes(estado) ? (estado as EstadoOrdenPago) : "",
  };
}

export const NOMBRES_ESTADO_ORDEN_PAGO: Record<EstadoOrdenPago, string> = {
  borrador: "Borrador",
  confirmado: "Confirmada",
  anulado: "Anulada",
};

export const TONO_ESTADO_ORDEN_PAGO: Record<EstadoOrdenPago, "neutro" | "verde" | "rojo"> = {
  borrador: "neutro",
  confirmado: "verde",
  anulado: "rojo",
};

/** Texto de la confirmación: total, proveedor, cheques que se entregan y lo que queda a favor. */
export function resumenConfirmacion({
  total,
  proveedor,
  aFavor,
  cheques,
}: {
  total: number;
  proveedor: string;
  aFavor: number;
  cheques: number;
}): string {
  const partes = [`Se va a confirmar la orden de pago por ${textoPesos(total)} a ${proveedor}.`];
  if (cheques === 1) partes.push("Se entrega 1 cheque de terceros.");
  else if (cheques > 1) partes.push(`Se entregan ${cheques} cheques de terceros.`);
  if (aCentavos(aFavor) > 0) partes.push(`Quedan ${textoPesos(aFavor)} a favor del proveedor.`);
  partes.push("No se puede modificar después.");
  return partes.join(" ");
}

const AVISOS: Record<string, string> = {
  guardado: "Borrador guardado.",
  confirmado: "Orden de pago confirmada.",
  anulado: "Orden de pago anulada.",
};

/** Aviso de `?aviso=…`; sólo los conocidos, nunca texto arbitrario de la URL. */
export function avisoDeParametroPago(valor: string | string[] | undefined): string | null {
  if (typeof valor !== "string") return null;
  return Object.hasOwn(AVISOS, valor) ? AVISOS[valor] : null;
}

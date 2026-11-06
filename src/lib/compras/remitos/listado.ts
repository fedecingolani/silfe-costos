/**
 * Remitos de compra: número del proveedor tal como se muestra, estado
 * visible (el guardado más lo facturado, de v_remito_compra_estado),
 * filtros del listado que llegan por la URL y qué se puede hacer en cada
 * estado.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import type { EstadoFacturacionRemitoCompra, EstadoRemitoCompra } from "@/lib/tipos";

/** 00003-00000123: punto de venta y número del remito del proveedor. */
export function numeroRemitoCompra(remito: { punto_venta: number | string; numero: number | string }): string {
  return `${String(remito.punto_venta).padStart(5, "0")}-${String(remito.numero).padStart(8, "0")}`;
}

/**
 * Estado tal como se muestra: un recibido se distingue por lo facturado
 * (recibido sin facturar, facturado en parte o facturado).
 */
export const ESTADOS_VISIBLES_REMITO_COMPRA = ["borrador", "recibido", "parcial", "facturado", "anulado"] as const;

export type EstadoVisibleRemitoCompra = (typeof ESTADOS_VISIBLES_REMITO_COMPRA)[number];

export const NOMBRES_ESTADO_REMITO_COMPRA: Record<EstadoVisibleRemitoCompra, string> = {
  borrador: "Borrador",
  recibido: "Recibido",
  parcial: "Facturado en parte",
  facturado: "Facturado",
  anulado: "Anulado",
};

export const TONO_ESTADO_REMITO_COMPRA: Record<EstadoVisibleRemitoCompra, "neutro" | "azul" | "ambar" | "verde" | "rojo"> = {
  borrador: "neutro",
  recibido: "azul",
  parcial: "ambar",
  facturado: "verde",
  anulado: "rojo",
};

export const NOMBRES_FACTURACION_REMITO_COMPRA: Record<EstadoFacturacionRemitoCompra, string> = {
  pendiente: "Pendiente",
  parcial: "Facturado en parte",
  facturado: "Facturado",
};

export function estadoVisibleRemitoCompra(
  estado: EstadoRemitoCompra,
  facturacion: EstadoFacturacionRemitoCompra,
): EstadoVisibleRemitoCompra {
  if (estado !== "recibido") return estado;
  return facturacion === "pendiente" ? "recibido" : facturacion;
}

/** Columnas de v_remito_compra_estado que corresponden a un estado visible (para filtrar). */
export function condicionEstadoVisible(
  estado: EstadoVisibleRemitoCompra,
): { estado: EstadoRemitoCompra; estado_facturacion?: EstadoFacturacionRemitoCompra } {
  if (estado === "borrador" || estado === "anulado") return { estado };
  return { estado: "recibido", estado_facturacion: estado === "recibido" ? "pendiente" : estado };
}

// ----- Filtros ----------------------------------------------------------------

export type FiltrosRemitosCompra = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Id del proveedor o vacío. */
  proveedor: string;
  estado: EstadoVisibleRemitoCompra | "";
};

type Parametros = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

/** Filtros del listado. Valores desconocidos se ignoran. */
export function leerFiltros(parametros: Parametros): FiltrosRemitosCompra {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const proveedor = primero(parametros.proveedor);
  const estado = primero(parametros.estado);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    proveedor: UUID.test(proveedor) ? proveedor : "",
    estado: (ESTADOS_VISIBLES_REMITO_COMPRA as readonly string[]).includes(estado)
      ? (estado as EstadoVisibleRemitoCompra)
      : "",
  };
}

/** Consulta de URL con sólo los filtros aplicados; vacía si no hay ninguno. */
export function consultaFiltros(filtros: FiltrosRemitosCompra): string {
  const consulta = new URLSearchParams();
  if (filtros.desde) consulta.set("desde", filtros.desde);
  if (filtros.hasta) consulta.set("hasta", filtros.hasta);
  if (filtros.proveedor) consulta.set("proveedor", filtros.proveedor);
  if (filtros.estado) consulta.set("estado", filtros.estado);
  return consulta.toString();
}

// ----- Qué se puede hacer en cada estado ---------------------------------------

export type PermisosRemitoCompra = {
  puedeEditar: boolean;
  puedeBorrar: boolean;
  puedeRecibir: boolean;
  puedeAnular: boolean;
  puedeFacturar: boolean;
};

/**
 * | Estado    | Se puede                    |
 * | --------- | --------------------------- |
 * | borrador  | editar, borrar, recibir     |
 * | recibido  | anular, facturar            |
 * | parcial   | facturar lo pendiente       |
 * | facturado | ver                         |
 * | anulado   | ver                         |
 *
 * Un remito con algo facturado (aunque sea en una factura en borrador) no
 * se anula: la base lo rechaza con RC008.
 */
export function permisosRemitoCompra(estado: EstadoVisibleRemitoCompra): PermisosRemitoCompra {
  return {
    puedeEditar: estado === "borrador",
    puedeBorrar: estado === "borrador",
    puedeRecibir: estado === "borrador",
    puedeAnular: estado === "recibido",
    puedeFacturar: estado === "recibido" || estado === "parcial",
  };
}

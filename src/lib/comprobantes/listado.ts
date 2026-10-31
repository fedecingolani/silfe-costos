/**
 * Listado de comprobantes: filtros que llegan por la URL, orden y nombres
 * para mostrar.
 */
import {
  AMBIENTES_ARCA,
  CLASES_COMPROBANTE,
  ESTADOS_COMPROBANTE,
  NOMBRES_CLASE_COMPROBANTE,
  type AmbienteArca,
  type ClaseComprobante,
  type EstadoComprobante,
  type LetraComprobante,
} from "@/lib/tipos";
import { formatearNumero } from "./numero";
import { esFechaValida } from "./validacion";

export type FiltrosListado = {
  /** yyyy-mm-dd o vacío */
  desde: string;
  hasta: string;
  /** Texto para buscar el cliente (razón social, CUIT o código). */
  cliente: string;
  clase: ClaseComprobante | "";
  estado: EstadoComprobante | "";
  /** "interno": comprobantes X de puntos de venta no electrónicos (sin ambiente de ARCA). */
  ambiente: AmbienteArca | "todos" | "interno";
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

function deLista<T extends string>(valor: string, lista: readonly T[]): T | "" {
  return (lista as readonly string[]).includes(valor) ? (valor as T) : "";
}

/**
 * Filtros del listado. Valores desconocidos se ignoran; por defecto, el
 * ambiente activo. "interno" muestra los comprobantes sin ARCA (X).
 */
export function leerFiltros(parametros: Parametros, ambienteActivo: AmbienteArca): FiltrosListado {
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  const ambiente = primero(parametros.ambiente);
  return {
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    cliente: primero(parametros.cliente),
    clase: deLista(primero(parametros.clase), CLASES_COMPROBANTE),
    estado: deLista(primero(parametros.estado), ESTADOS_COMPROBANTE),
    ambiente:
      ambiente === "todos" || ambiente === "interno" ? ambiente : deLista(ambiente, AMBIENTES_ARCA) || ambienteActivo,
  };
}

/**
 * El aviso de homologación acompaña al ambiente activo. Con el filtro de
 * comprobantes sin ARCA (X) no va: esos no pasan por ningún ambiente.
 */
export function mostrarAvisoHomologacion(
  ambienteActivo: AmbienteArca,
  ambienteFiltro: FiltrosListado["ambiente"],
): boolean {
  return ambienteActivo === "homologacion" && ambienteFiltro !== "interno";
}

/** Borradores arriba; después por fecha y alta, del más nuevo al más viejo. */
export function ordenarListado<T extends { estado: EstadoComprobante; fecha: string; creado_en: string }>(
  filas: readonly T[],
): T[] {
  return [...filas].sort((a, b) => {
    const borrador = Number(b.estado === "borrador") - Number(a.estado === "borrador");
    if (borrador !== 0) return borrador;
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return a.creado_en < b.creado_en ? 1 : a.creado_en > b.creado_en ? -1 : 0;
  });
}

export const NOMBRES_ESTADO: Record<EstadoComprobante, string> = {
  borrador: "Borrador",
  verificando: "Verificando",
  autorizado: "Autorizado",
  rechazado: "Rechazado",
};

export const TONO_ESTADO: Record<EstadoComprobante, "neutro" | "ambar" | "verde" | "rojo"> = {
  borrador: "neutro",
  verificando: "ambar",
  autorizado: "verde",
  rechazado: "rojo",
};

/** "Factura A", o sólo la clase si todavía no tiene letra. */
export function nombreComprobante(clase: ClaseComprobante, letra: LetraComprobante | null): string {
  return letra ? `${NOMBRES_CLASE_COMPROBANTE[clase]} ${letra}` : NOMBRES_CLASE_COMPROBANTE[clase];
}

/** A-00007-00000361, o "—" si todavía no tiene número. */
export function numeroVisible(c: { letra: LetraComprobante | null; punto_venta: number; numero: number | null }): string {
  return c.letra && c.numero !== null ? formatearNumero(c.letra, c.punto_venta, Number(c.numero)) : "—";
}

/**
 * Lectura de los comprobantes asociados de un comprobante y de las notas
 * que apuntan a uno. La usan la autorización (saldo y CbtesAsoc), el
 * detalle, el editor, el PDF y "Duplicar". Columnas explícitas: nada de
 * arca_credencial.
 *
 * comprobante_asociado tiene dos claves foráneas a comprobante, así que en
 * lugar de un embed ambiguo se hacen dos consultas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AmbienteArca,
  ClaseComprobante,
  EstadoComprobante,
  LetraComprobante,
  TipoComprobanteArca,
} from "@/lib/tipos";
import { letraDeTipoArca, saldoNotaCredito, type AsociadoGuardado } from "./asociados";
import { formatearNumero } from "./numero";

type Cliente = Pick<SupabaseClient, "from">;

/** Comprobante de la base relacionado (asociado o nota que lo asocia). */
export type ComprobanteRelacionado = {
  id: string;
  estado: EstadoComprobante;
  clase: ClaseComprobante;
  letra: LetraComprobante | null;
  tipo_arca: TipoComprobanteArca | null;
  punto_venta: number;
  numero: number | null;
  fecha: string;
  total: number;
  ambiente: AmbienteArca | null;
};

/** Fila de comprobante_asociado, con el comprobante de la base si es interno. */
export type AsociadoLeido = {
  asociado_id: string | null;
  tipo_arca: number | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  cuit: string | null;
  interno: ComprobanteRelacionado | null;
};

export const COLUMNAS_RELACIONADO = "id, estado, clase, letra, tipo_arca, punto_venta, numero, fecha, total, ambiente";

function relacionado(fila: Record<string, unknown>): ComprobanteRelacionado {
  return {
    ...(fila as ComprobanteRelacionado),
    punto_venta: Number(fila.punto_venta),
    numero: fila.numero === null || fila.numero === undefined ? null : Number(fila.numero),
    tipo_arca: fila.tipo_arca === null || fila.tipo_arca === undefined ? null : (Number(fila.tipo_arca) as TipoComprobanteArca),
    total: Number(fila.total),
  };
}

const entero = (valor: unknown) => (valor === null || valor === undefined ? null : Number(valor));

/** Asociados del comprobante `id`, o el mensaje de error. */
export async function leerAsociados(cliente: Cliente, id: string): Promise<AsociadoLeido[] | string> {
  const { data, error } = await cliente
    .from("comprobante_asociado")
    .select("asociado_id, tipo_arca, punto_venta, numero, fecha, cuit")
    .eq("comprobante_id", id);
  if (error) return `No se pudieron leer los comprobantes asociados: ${error.message}`;
  const filas = (data ?? []) as Record<string, unknown>[];

  const ids = filas.map((f) => f.asociado_id).filter((v): v is string => typeof v === "string");
  const internos = new Map<string, ComprobanteRelacionado>();
  if (ids.length > 0) {
    const { data: comprobantes, error: errorInternos } = await cliente
      .from("comprobante")
      .select(COLUMNAS_RELACIONADO)
      .in("id", ids);
    if (errorInternos) return `No se pudieron leer los comprobantes asociados: ${errorInternos.message}`;
    for (const c of (comprobantes ?? []) as unknown as Record<string, unknown>[]) internos.set(String(c.id), relacionado(c));
  }

  return filas.map((f) => ({
    asociado_id: (f.asociado_id as string | null) ?? null,
    tipo_arca: entero(f.tipo_arca),
    punto_venta: entero(f.punto_venta),
    numero: entero(f.numero),
    fecha: (f.fecha as string | null) ?? null,
    cuit: (f.cuit as string | null) ?? null,
    interno: typeof f.asociado_id === "string" ? (internos.get(f.asociado_id) ?? null) : null,
  }));
}

/** Notas (de crédito o débito) que asocian alguno de `ids`, sin `excluir`. */
export async function leerNotasSobre(
  cliente: Cliente,
  ids: readonly string[],
  excluir?: string,
): Promise<ComprobanteRelacionado[] | string> {
  if (ids.length === 0) return [];
  const { data, error } = await cliente.from("comprobante_asociado").select("comprobante_id").in("asociado_id", ids);
  if (error) return `No se pudieron leer las notas del comprobante: ${error.message}`;
  const notas = [...new Set(((data ?? []) as { comprobante_id: string }[]).map((f) => f.comprobante_id))].filter(
    (id) => id !== excluir,
  );
  if (notas.length === 0) return [];
  const { data: comprobantes, error: errorNotas } = await cliente
    .from("comprobante")
    .select(COLUMNAS_RELACIONADO)
    .in("id", notas);
  if (errorNotas) return `No se pudieron leer las notas del comprobante: ${errorNotas.message}`;
  return ((comprobantes ?? []) as unknown as Record<string, unknown>[]).map(relacionado);
}

/**
 * Datos del asociado para mostrar e imprimir (los del comprobante de la base
 * si es interno). Un X de la base no tiene código de ARCA: va su letra.
 */
export function datosAsociado(a: AsociadoLeido) {
  return a.interno
    ? {
        tipo_arca: a.interno.tipo_arca,
        letra: a.interno.letra,
        punto_venta: a.interno.punto_venta,
        numero: a.interno.numero,
        fecha: a.interno.fecha,
      }
    : { tipo_arca: a.tipo_arca, letra: letraDeTipoArca(a.tipo_arca), punto_venta: a.punto_venta, numero: a.numero, fecha: a.fecha };
}

/**
 * Saldo para una nota de crédito sobre los asociados de la base: su total
 * menos las otras notas de crédito autorizadas o en verificación (éstas
 * pueden quedar autorizadas: se descuentan para no pasarse). null si no
 * hay asociados de la base (cargado a mano: no se conoce el importe).
 */
export function saldoDe(
  asociados: readonly AsociadoLeido[],
  notas: readonly ComprobanteRelacionado[],
): { saldo: number; asociado: string } | null {
  const internos = asociados.map((a) => a.interno).filter((c): c is ComprobanteRelacionado => c !== null);
  if (internos.length === 0) return null;
  const otras = notas.filter((n) => n.clase === "nota_credito" && (n.estado === "autorizado" || n.estado === "verificando"));
  const primero = internos[0];
  return {
    saldo: saldoNotaCredito(
      internos.map((c) => c.total),
      otras.map((n) => n.total),
    ),
    asociado:
      primero.letra && primero.numero !== null
        ? formatearNumero(primero.letra, primero.punto_venta, primero.numero)
        : "el comprobante asociado",
  };
}

/** Asociados para volver a guardarlos (Duplicar copia los de la base y los cargados a mano). */
export function asociadosParaGuardar(asociados: readonly AsociadoLeido[]): AsociadoGuardado[] {
  return asociados.map((a) =>
    a.asociado_id
      ? { asociado_id: a.asociado_id }
      : {
          tipo_arca: a.tipo_arca as TipoComprobanteArca,
          punto_venta: a.punto_venta!,
          numero: a.numero!,
          fecha: a.fecha!,
          cuit: a.cuit!,
        },
  );
}

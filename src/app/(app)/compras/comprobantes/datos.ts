import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { FacturaAsociable, NotaAsociada } from "@/lib/compras/comprobantes/nota";
import { numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import { numeroRemitoCompra } from "@/lib/compras/remitos/listado";
import type {
  ComprobanteCompra,
  ComprobanteCompraItem,
  ComprobanteCompraPercepcion,
  CondicionIva,
  EstadoPago,
  LetraCompra,
  ProveedorArticulo,
  TipoComprobanteCompra,
} from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Columnas explícitas del comprobante de compra, sus renglones y percepciones. */
export const COLUMNAS_COMPROBANTE_COMPRA =
  "id, proveedor_id, tipo, letra, punto_venta, numero, fecha, fecha_vencimiento, observaciones, neto_gravado, " +
  "no_gravado, exento, iva, percepcion_iva, percepcion_iibb, otros_impuestos, total, estado, confirmado_en, " +
  "anulado_en, creado_por, creado_en, actualizado_en, comprobante_asociado_id";
const COLUMNAS_ITEM =
  "id, comprobante_compra_id, orden, proveedor_articulo_id, materia_prima_id, codigo_proveedor, descripcion, unidad, " +
  "cantidad, precio_unitario, descuento_pct, alicuota_iva, exento, importe, iva, remito_compra_item_id";
const COLUMNAS_PERCEPCION = "id, comprobante_compra_id, tipo, jurisdiccion, descripcion, importe";
const COLUMNAS_ARTICULO = "id, proveedor_id, codigo, descripcion, unidad, factor_conversion, materia_prima_id, activo";

/** Proveedor que se ofrece en el editor. Los inactivos sólo si el comprobante ya lo tiene. */
export type ProveedorOfrecido = { id: string; nombre: string; condicion_iva: CondicionIva | null; activo: boolean };

/** Materia prima con su unidad de compra (para el artículo nuevo y para mostrar la del artículo). */
export type MateriaPrimaOfrecida = { id: string; codigo: string; nombre: string; unidad_compra: string; activo: boolean };

export type ContextoEditorCompra = { proveedores: ProveedorOfrecido[]; materiasPrimas: MateriaPrimaOfrecida[] };

export async function cargarContextoEditorCompra(supabase: Supabase): Promise<ContextoEditorCompra | string> {
  const [{ data: proveedores, error }, { data: materias, error: errorMaterias }] = await Promise.all([
    supabase.from("proveedor").select("id, nombre, condicion_iva, activo").order("nombre"),
    supabase.from("v_materia_prima_costo").select("id, codigo, nombre, unidad_compra, activo").order("codigo"),
  ]);
  const errorCarga = error ?? errorMaterias;
  if (errorCarga) return `No se pudieron leer los proveedores y materias primas: ${errorCarga.message}`;
  return {
    proveedores: (proveedores ?? []) as ProveedorOfrecido[],
    materiasPrimas: (materias ?? []) as MateriaPrimaOfrecida[],
  };
}

/** Catálogo completo de un proveedor (activos e inactivos: un renglón guardado puede usar uno inactivo). */
export async function cargarArticulos(supabase: Supabase, proveedorId: string): Promise<ProveedorArticulo[] | string> {
  const { data, error } = await supabase
    .from("proveedor_articulo")
    .select(COLUMNAS_ARTICULO)
    .eq("proveedor_id", proveedorId)
    .order("descripcion");
  if (error) return `No se pudieron leer los artículos del proveedor: ${error.message}`;
  return ((data ?? []) as unknown as ProveedorArticulo[]).map((a) => ({
    ...a,
    factor_conversion: Number(a.factor_conversion),
  }));
}

/** Columnas de una factura o nota que se lista (asociables, factura asociada y notas). */
const COLUMNAS_RESUMEN = "id, tipo, letra, punto_venta, numero, fecha, total, estado";

function resumen<T extends { punto_venta: number; numero: number; total: number }>(fila: T): T {
  return { ...fila, punto_venta: Number(fila.punto_venta), numero: Number(fila.numero), total: Number(fila.total) };
}

/** Facturas confirmadas de un proveedor y una letra, las más nuevas primero: las que se asocian a una nota. */
export async function cargarFacturasAsociables(
  supabase: Supabase,
  proveedorId: string,
  letra: string,
): Promise<FacturaAsociable[] | string> {
  const { data, error } = await supabase
    .from("comprobante_compra")
    .select(COLUMNAS_RESUMEN)
    .eq("proveedor_id", proveedorId)
    .eq("letra", letra)
    .eq("tipo", "factura")
    .eq("estado", "confirmado")
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false })
    .limit(200);
  if (error) return `No se pudieron leer las facturas del proveedor: ${error.message}`;
  return ((data ?? []) as unknown as FacturaAsociable[]).map(resumen);
}

/**
 * La factura asociada a una nota (cualquier estado: pudo anularse después).
 * null si no existe; el mensaje si falló la lectura.
 */
export async function cargarFacturaAsociada(supabase: Supabase, id: string): Promise<NotaAsociada | null | string> {
  const { data, error } = await supabase.from("comprobante_compra").select(COLUMNAS_RESUMEN).eq("id", id).maybeSingle();
  if (error) return `No se pudo leer la factura asociada: ${error.message}`;
  return data ? resumen(data as unknown as NotaAsociada) : null;
}

/** Notas asociadas a una factura, en el orden en que se emitieron. */
export async function cargarNotasAsociadas(supabase: Supabase, facturaId: string): Promise<NotaAsociada[] | string> {
  const { data, error } = await supabase
    .from("comprobante_compra")
    .select(COLUMNAS_RESUMEN)
    .eq("comprobante_asociado_id", facturaId)
    .order("fecha")
    .order("creado_en");
  if (error) return `No se pudieron leer las notas de la factura: ${error.message}`;
  return ((data ?? []) as unknown as NotaAsociada[]).map(resumen);
}

/** Remito de compra de cada renglón de remito (por su id), para mostrar de dónde viene un renglón de factura. */
export type RemitosDeRenglones = Record<string, { remitoId: string; numero: string }>;

/**
 * Remitos de los renglones de una factura que vienen de remitos. Vacío si
 * ninguno; el mensaje si falló la lectura.
 */
export async function cargarRemitosDeRenglones(
  supabase: Supabase,
  items: readonly Pick<ComprobanteCompraItem, "remito_compra_item_id">[],
): Promise<RemitosDeRenglones | string> {
  const ids = [...new Set(items.map((i) => i.remito_compra_item_id).filter((v): v is string => v !== null))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("remito_compra_item")
    .select("id, remito_compra_id, remito_compra(punto_venta, numero)")
    .in("id", ids);
  if (error) return `No se pudieron leer los remitos de los renglones: ${error.message}`;
  const remitos: RemitosDeRenglones = {};
  for (const fila of (data ?? []) as unknown as {
    id: string;
    remito_compra_id: string;
    remito_compra: { punto_venta: number; numero: number } | null;
  }[]) {
    remitos[fila.id] = {
      remitoId: fila.remito_compra_id,
      numero: fila.remito_compra ? numeroRemitoCompra(fila.remito_compra) : "",
    };
  }
  return remitos;
}

export type ComprobanteCompraCargado = {
  comprobante: ComprobanteCompra;
  items: ComprobanteCompraItem[];
  percepciones: ComprobanteCompraPercepcion[];
};

/** Comprobante con renglones y percepciones, con los importes como números (numeric puede llegar como texto). */
export async function cargarComprobanteCompra(
  supabase: Supabase,
  id: string,
): Promise<ComprobanteCompraCargado | null | string> {
  const [{ data, error }, { data: itemsData, error: errorItems }, { data: percepcionesData, error: errorPercepciones }] =
    await Promise.all([
      supabase.from("comprobante_compra").select(COLUMNAS_COMPROBANTE_COMPRA).eq("id", id).maybeSingle(),
      supabase.from("comprobante_compra_item").select(COLUMNAS_ITEM).eq("comprobante_compra_id", id).order("orden"),
      supabase.from("comprobante_compra_percepcion").select(COLUMNAS_PERCEPCION).eq("comprobante_compra_id", id),
    ]);
  const errorCarga = error ?? errorItems ?? errorPercepciones;
  if (errorCarga) return errorCarga.message;
  if (!data) return null;
  const c = data as unknown as ComprobanteCompra;
  const comprobante: ComprobanteCompra = {
    ...c,
    punto_venta: Number(c.punto_venta),
    numero: Number(c.numero),
    neto_gravado: Number(c.neto_gravado),
    no_gravado: Number(c.no_gravado),
    exento: Number(c.exento),
    iva: Number(c.iva),
    percepcion_iva: Number(c.percepcion_iva),
    percepcion_iibb: Number(c.percepcion_iibb),
    otros_impuestos: Number(c.otros_impuestos),
    total: Number(c.total),
  };
  const items = ((itemsData ?? []) as unknown as ComprobanteCompraItem[]).map((i) => ({
    ...i,
    cantidad: Number(i.cantidad),
    precio_unitario: Number(i.precio_unitario),
    descuento_pct: Number(i.descuento_pct),
    alicuota_iva: i.alicuota_iva === null ? null : (Number(i.alicuota_iva) as ComprobanteCompraItem["alicuota_iva"]),
    importe: Number(i.importe),
    iva: Number(i.iva),
  }));
  const percepciones = ((percepcionesData ?? []) as unknown as ComprobanteCompraPercepcion[]).map((p) => ({
    ...p,
    importe: Number(p.importe),
  }));
  return { comprobante, items, percepciones };
}

/** Saldo y estado de pago de una factura o nota de débito confirmada (v_comprobante_compra_saldo). */
export type SaldoCompra = { total: number; imputado: number; saldo: number; estadoPago: EstadoPago };

/** null si no es un débito confirmado (borrador, anulado o nota de crédito); el mensaje si falló la lectura. */
export async function cargarSaldoCompra(supabase: Supabase, id: string): Promise<SaldoCompra | null | string> {
  const { data, error } = await supabase
    .from("v_comprobante_compra_saldo")
    .select("total, imputado, saldo, estado_pago")
    .eq("comprobante_compra_id", id)
    .maybeSingle();
  if (error) return `No se pudo leer el saldo del comprobante: ${error.message}`;
  if (!data) return null;
  return {
    total: Number(data.total),
    imputado: Number(data.imputado),
    saldo: Number(data.saldo),
    estadoPago: data.estado_pago as EstadoPago,
  };
}

/** Imputación vigente recibida por un débito de compra: de una orden de pago confirmada o de una nota de crédito. */
export type PagoRecibidoCompra = {
  id: string;
  importe: number;
  fecha: string;
  automatica: boolean;
  texto: string;
  href: string;
};

type FilaPagoRecibido = {
  id: string;
  importe: number | string;
  fecha: string;
  automatica: boolean;
  orden: { id: string; numero_texto: string | null; estado: string } | null;
  nota: { id: string; tipo: TipoComprobanteCompra; letra: LetraCompra; punto_venta: number; numero: number } | null;
};

/** Órdenes de pago confirmadas y notas de crédito imputadas a un débito de compra, por fecha. */
export async function cargarPagosRecibidosCompra(
  supabase: Supabase,
  comprobanteId: string,
): Promise<PagoRecibidoCompra[] | string> {
  const { data, error } = await supabase
    .from("imputacion_compra")
    .select(
      "id, importe, fecha, automatica, orden:orden_pago_id(id, numero_texto, estado), " +
        "nota:nota_credito_id(id, tipo, letra, punto_venta, numero)",
    )
    .eq("comprobante_compra_id", comprobanteId)
    .order("fecha")
    .order("creado_en");
  if (error) return `No se pudieron leer los pagos del comprobante: ${error.message}`;
  return ((data ?? []) as unknown as FilaPagoRecibido[])
    .filter((i) => i.nota || i.orden?.estado === "confirmado")
    .map((i) => ({
      id: i.id,
      importe: Number(i.importe),
      fecha: i.fecha,
      automatica: i.automatica,
      texto: i.orden
        ? `Orden de pago ${i.orden.numero_texto ?? ""}`.trim()
        : i.nota
          ? numeroComprobanteCompra({ ...i.nota, punto_venta: Number(i.nota.punto_venta) })
          : "Nota de crédito",
      href: i.orden ? `/compras/pagos/${i.orden.id}` : `/compras/comprobantes/${i.nota?.id}`,
    }));
}

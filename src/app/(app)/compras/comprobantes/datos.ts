import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type {
  ComprobanteCompra,
  ComprobanteCompraItem,
  ComprobanteCompraPercepcion,
  CondicionIva,
  ProveedorArticulo,
} from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Columnas explícitas del comprobante de compra, sus renglones y percepciones. */
export const COLUMNAS_COMPROBANTE_COMPRA =
  "id, proveedor_id, tipo, letra, punto_venta, numero, fecha, fecha_vencimiento, observaciones, neto_gravado, " +
  "no_gravado, exento, iva, percepcion_iva, percepcion_iibb, otros_impuestos, total, estado, confirmado_en, " +
  "anulado_en, creado_por, creado_en, actualizado_en";
const COLUMNAS_ITEM =
  "id, comprobante_compra_id, orden, proveedor_articulo_id, materia_prima_id, codigo_proveedor, descripcion, unidad, " +
  "cantidad, precio_unitario, descuento_pct, alicuota_iva, exento, importe, iva";
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

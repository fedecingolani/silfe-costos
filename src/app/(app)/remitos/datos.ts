import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Remito, RemitoItem } from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Los catálogos del editor (listas, puntos de venta, productos) y los precios
// de una lista son los de comprobantes: ver ../comprobantes/datos.ts. Los
// productos por id para armar los ítems, los de ../presupuestos/datos.ts.

/** Columnas explícitas del remito y sus ítems. */
export const COLUMNAS_REMITO =
  "id, punto_venta, numero, cliente_id, fecha, fecha_vencimiento_pago, condicion_pago, lista_precio_id, " +
  "transporte_id, domicilio_entrega, observaciones, neto, no_gravado, iva, total, valor_declarado, bultos_total, " +
  "estado, emitido_en, anulado_en, creado_por, creado_en, actualizado_en";
export const COLUMNAS_ITEM_REMITO =
  "id, remito_id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, " +
  "descuento_pct, gravado, alicuota_iva, importe, iva, bultos";

/** Transporte que se ofrece en el editor. Los inactivos sólo se muestran si el remito ya lo tiene. */
export type TransporteOfrecido = { id: string; nombre: string; activo: boolean };

export async function cargarTransportes(supabase: Supabase): Promise<TransporteOfrecido[] | string> {
  const { data, error } = await supabase.from("transporte").select("id, nombre, activo").order("nombre");
  if (error) return `No se pudieron leer los transportes: ${error.message}`;
  return (data ?? []) as TransporteOfrecido[];
}

/** Remito con sus ítems, con los importes como números (numeric puede llegar como texto). */
export async function cargarRemito(
  supabase: Supabase,
  id: string,
): Promise<{ remito: Remito; items: RemitoItem[] } | null | string> {
  const [{ data, error }, { data: itemsData, error: errorItems }] = await Promise.all([
    supabase.from("remito").select(COLUMNAS_REMITO).eq("id", id).maybeSingle(),
    supabase.from("remito_item").select(COLUMNAS_ITEM_REMITO).eq("remito_id", id).order("orden"),
  ]);
  const errorCarga = error ?? errorItems;
  if (errorCarga) return errorCarga.message;
  if (!data) return null;
  const r = data as unknown as Remito;
  const remito: Remito = {
    ...r,
    punto_venta: Number(r.punto_venta),
    numero: r.numero === null ? null : Number(r.numero),
    neto: Number(r.neto),
    no_gravado: Number(r.no_gravado),
    iva: Number(r.iva),
    total: Number(r.total),
    valor_declarado: Number(r.valor_declarado),
    bultos_total: Number(r.bultos_total),
  };
  const items = ((itemsData ?? []) as unknown as RemitoItem[]).map((i) => ({
    ...i,
    cantidad: Number(i.cantidad),
    precio_unitario: Number(i.precio_unitario),
    descuento_pct: Number(i.descuento_pct),
    alicuota_iva: i.alicuota_iva === null ? null : (Number(i.alicuota_iva) as RemitoItem["alicuota_iva"]),
    importe: Number(i.importe),
    iva: Number(i.iva),
    bultos: Number(i.bultos),
  }));
  return { remito, items };
}

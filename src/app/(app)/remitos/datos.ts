import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Remito, RemitoItem, RemitoItemPendiente } from "@/lib/tipos";

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

const COLUMNAS_PENDIENTE =
  "remito_item_id, remito_id, cliente_id, punto_venta, numero, fecha, estado_remito, orden, producto_id, codigo, " +
  "descripcion, unidad, precio_unitario, descuento_pct, gravado, alicuota_iva, bultos, cantidad, facturado, pendiente";

/**
 * Ítems con algo pendiente de los remitos emitidos de un cliente
 * (v_remito_item_pendiente). El estado de la vista es el guardado: parcial
 * y facturado se derivan, así que un remito facturado en parte sigue
 * "emitido" acá.
 */
export async function cargarPendientes(supabase: Supabase, clienteId: string): Promise<RemitoItemPendiente[] | string> {
  const { data, error } = await supabase
    .from("v_remito_item_pendiente")
    .select(COLUMNAS_PENDIENTE)
    .eq("cliente_id", clienteId)
    .eq("estado_remito", "emitido")
    .gt("pendiente", 0);
  if (error) return `No se pudieron leer los remitos pendientes: ${error.message}`;
  return (data ?? []) as unknown as RemitoItemPendiente[];
}

/** Clientes con algo pendiente de facturar en remitos emitidos, por razón social. */
export async function cargarClientesConPendientes(
  supabase: Supabase,
): Promise<{ id: string; razon_social: string; remitos: number }[] | string> {
  const { data, error } = await supabase
    .from("v_remito_item_pendiente")
    .select("cliente_id, remito_id")
    .eq("estado_remito", "emitido")
    .gt("pendiente", 0);
  if (error) return `No se pudieron leer los remitos pendientes: ${error.message}`;
  const remitosPorCliente = new Map<string, Set<string>>();
  for (const f of data ?? []) {
    const remitos = remitosPorCliente.get(f.cliente_id as string) ?? new Set<string>();
    remitos.add(f.remito_id as string);
    remitosPorCliente.set(f.cliente_id as string, remitos);
  }
  if (remitosPorCliente.size === 0) return [];
  const { data: clientes, error: errorClientes } = await supabase
    .from("cliente")
    .select("id, razon_social")
    .in("id", [...remitosPorCliente.keys()])
    .order("razon_social");
  if (errorClientes) return `No se pudieron leer los clientes: ${errorClientes.message}`;
  return (clientes ?? []).map((c) => ({
    id: c.id as string,
    razon_social: c.razon_social as string,
    remitos: remitosPorCliente.get(c.id as string)?.size ?? 0,
  }));
}

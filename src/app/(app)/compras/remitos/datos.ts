import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type {
  ComprobanteCompra,
  EstadoFacturacionRemitoCompra,
  RemitoCompra,
  RemitoCompraItem,
  RemitoCompraItemPendiente,
} from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// El contexto del editor (proveedores y materias primas) y el catálogo de un
// proveedor son los de los comprobantes de compra: ver ../comprobantes/datos.ts.

/** Columnas explícitas del remito de compra y sus renglones. */
const COLUMNAS_REMITO =
  "id, proveedor_id, punto_venta, numero, fecha, observaciones, estado, recibido_en, anulado_en, creado_por, " +
  "creado_en, actualizado_en";
const COLUMNAS_ITEM =
  "id, remito_compra_id, orden, proveedor_articulo_id, materia_prima_id, codigo_proveedor, descripcion, unidad, cantidad";
const COLUMNAS_PENDIENTE =
  "remito_compra_item_id, remito_compra_id, proveedor_id, punto_venta, numero, fecha, estado_remito, orden, " +
  "proveedor_articulo_id, materia_prima_id, codigo_proveedor, descripcion, unidad, cantidad, facturada, pendiente";

export type RemitoCompraCargado = {
  remito: RemitoCompra;
  items: RemitoCompraItem[];
  /** De v_remito_compra_estado. */
  facturacion: EstadoFacturacionRemitoCompra;
};

/** Remito con sus renglones y su estado de facturación. null si no existe; el mensaje si falló la lectura. */
export async function cargarRemitoCompra(supabase: Supabase, id: string): Promise<RemitoCompraCargado | null | string> {
  const [{ data, error }, { data: itemsData, error: errorItems }, { data: estado, error: errorEstado }] = await Promise.all([
    supabase.from("remito_compra").select(COLUMNAS_REMITO).eq("id", id).maybeSingle(),
    supabase.from("remito_compra_item").select(COLUMNAS_ITEM).eq("remito_compra_id", id).order("orden"),
    supabase.from("v_remito_compra_estado").select("estado_facturacion").eq("remito_compra_id", id).maybeSingle(),
  ]);
  const errorCarga = error ?? errorItems ?? errorEstado;
  if (errorCarga) return errorCarga.message;
  if (!data) return null;
  const r = data as unknown as RemitoCompra;
  const remito: RemitoCompra = { ...r, punto_venta: Number(r.punto_venta), numero: Number(r.numero) };
  const items = ((itemsData ?? []) as unknown as RemitoCompraItem[]).map((i) => ({ ...i, cantidad: Number(i.cantidad) }));
  const facturacion = (estado?.estado_facturacion as EstadoFacturacionRemitoCompra | undefined) ?? "pendiente";
  return { remito, items, facturacion };
}

function pendienteNumerico(f: RemitoCompraItemPendiente): RemitoCompraItemPendiente {
  return {
    ...f,
    punto_venta: Number(f.punto_venta),
    numero: Number(f.numero),
    cantidad: Number(f.cantidad),
    facturada: Number(f.facturada),
    pendiente: Number(f.pendiente),
  };
}

/** Lo facturado y lo pendiente de cada renglón de un remito. */
export async function cargarPendientesDelRemito(
  supabase: Supabase,
  remitoId: string,
): Promise<RemitoCompraItemPendiente[] | string> {
  const { data, error } = await supabase
    .from("v_remito_compra_item_pendiente")
    .select(COLUMNAS_PENDIENTE)
    .eq("remito_compra_id", remitoId);
  if (error) return `No se pudo leer lo facturado del remito: ${error.message}`;
  return ((data ?? []) as unknown as RemitoCompraItemPendiente[]).map(pendienteNumerico);
}

/** Renglones con algo pendiente de los remitos recibidos de un proveedor. */
export async function cargarPendientes(
  supabase: Supabase,
  proveedorId: string,
): Promise<RemitoCompraItemPendiente[] | string> {
  const { data, error } = await supabase
    .from("v_remito_compra_item_pendiente")
    .select(COLUMNAS_PENDIENTE)
    .eq("proveedor_id", proveedorId)
    .eq("estado_remito", "recibido")
    .gt("pendiente", 0);
  if (error) return `No se pudieron leer los remitos pendientes: ${error.message}`;
  return ((data ?? []) as unknown as RemitoCompraItemPendiente[]).map(pendienteNumerico);
}

/** Proveedores con algo pendiente de facturar en remitos recibidos, por nombre. */
export async function cargarProveedoresConPendientes(
  supabase: Supabase,
): Promise<{ id: string; nombre: string; remitos: number }[] | string> {
  const { data, error } = await supabase
    .from("v_remito_compra_item_pendiente")
    .select("proveedor_id, remito_compra_id")
    .eq("estado_remito", "recibido")
    .gt("pendiente", 0);
  if (error) return `No se pudieron leer los remitos pendientes: ${error.message}`;
  const remitosPorProveedor = new Map<string, Set<string>>();
  for (const f of data ?? []) {
    const remitos = remitosPorProveedor.get(f.proveedor_id as string) ?? new Set<string>();
    remitos.add(f.remito_compra_id as string);
    remitosPorProveedor.set(f.proveedor_id as string, remitos);
  }
  if (remitosPorProveedor.size === 0) return [];
  const { data: proveedores, error: errorProveedores } = await supabase
    .from("proveedor")
    .select("id, nombre")
    .in("id", [...remitosPorProveedor.keys()])
    .order("nombre");
  if (errorProveedores) return `No se pudieron leer los proveedores: ${errorProveedores.message}`;
  return (proveedores ?? []).map((p) => ({
    id: p.id as string,
    nombre: p.nombre as string,
    remitos: remitosPorProveedor.get(p.id as string)?.size ?? 0,
  }));
}

/** Factura (o borrador) que cubre renglones de un remito. */
export type FacturaDelRemito = Pick<
  ComprobanteCompra,
  "id" | "tipo" | "letra" | "punto_venta" | "numero" | "fecha" | "total" | "estado"
>;

/** Comprobantes con renglones de esos renglones de remito (anulados incluidos), por fecha. */
export async function cargarFacturasDelRemito(
  supabase: Supabase,
  itemIds: string[],
): Promise<FacturaDelRemito[] | string> {
  if (itemIds.length === 0) return [];
  const { data: vinculos, error } = await supabase
    .from("comprobante_compra_item")
    .select("comprobante_compra_id")
    .in("remito_compra_item_id", itemIds);
  if (error) return `No se pudieron leer las facturas del remito: ${error.message}`;
  const ids = [...new Set((vinculos ?? []).map((v) => v.comprobante_compra_id as string))];
  if (ids.length === 0) return [];
  const { data, error: errorFacturas } = await supabase
    .from("comprobante_compra")
    .select("id, tipo, letra, punto_venta, numero, fecha, total, estado")
    .in("id", ids)
    .order("fecha")
    .order("creado_en");
  if (errorFacturas) return `No se pudieron leer las facturas del remito: ${errorFacturas.message}`;
  return ((data ?? []) as unknown as FacturaDelRemito[]).map((f) => ({
    ...f,
    punto_venta: Number(f.punto_venta),
    numero: Number(f.numero),
    total: Number(f.total),
  }));
}

import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { ProductoCatalogo } from "@/lib/comprobantes/borrador";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Los catálogos del editor (listas, productos) y los precios de una lista
// son los de comprobantes: ver ../comprobantes/datos.ts.

/** Columnas explícitas del presupuesto y sus ítems. */
export const COLUMNAS_PRESUPUESTO =
  "id, numero, cliente_id, fecha, valido_hasta, fecha_vencimiento_pago, condicion_pago, lista_precio_id, " +
  "observaciones, neto, no_gravado, iva, total, estado, comprobante_id, convertido_en";
export const COLUMNAS_ITEM =
  "id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, " +
  "gravado, alicuota_iva, importe, iva";

/**
 * Productos del catálogo con la unidad de venta (o la de costeo) ya
 * resuelta, para armar los ítems en el servidor. Misma lectura que al
 * guardar un comprobante.
 */
export async function productosPorId(supabase: Supabase, ids: string[]): Promise<Map<string, ProductoCatalogo> | string> {
  const mapa = new Map<string, ProductoCatalogo>();
  if (ids.length === 0) return mapa;
  const [{ data: productos, error }, { data: unidades, error: errorUnidades }] = await Promise.all([
    supabase.from("producto").select("id, codigo, nombre, alicuota_iva, unidad_id, unidad_venta_id").in("id", ids),
    supabase.from("unidad_medida").select("id, nombre"),
  ]);
  if (error || errorUnidades) return `No se pudieron leer los productos: ${(error ?? errorUnidades)!.message}`;
  const nombreUnidad = new Map((unidades ?? []).map((u) => [u.id as string, u.nombre as string]));
  for (const p of productos ?? []) {
    const unidadId = p.unidad_venta_id ?? p.unidad_id;
    mapa.set(p.id, {
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      alicuota_iva: Number(p.alicuota_iva),
      unidad: unidadId ? (nombreUnidad.get(unidadId) ?? null) : null,
    });
  }
  return mapa;
}

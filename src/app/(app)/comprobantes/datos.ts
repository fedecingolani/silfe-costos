import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { alicuotaArca } from "@/lib/comprobantes/borrador";
import type { AlicuotaIva, AmbienteArca } from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Producto que se ofrece en el buscador de ítems (sólo activos). */
export type ProductoOfrecido = {
  id: string;
  codigo: string;
  nombre: string;
  /** null si la alícuota del producto no es una de ARCA: hay que corregirla en el producto. */
  alicuota: AlicuotaIva | null;
  alicuotaOriginal: number;
};

export type ListaOfrecida = { id: string; nombre: string };

/** Punto de venta activo. No electrónico: emite comprobantes X, sin ARCA. */
export type PuntoVentaOfrecido = { numero: number; electronico: boolean };

/** Lo que necesita el editor además del comprobante: catálogos y valores por defecto. */
export type ContextoEditor = {
  listas: ListaOfrecida[];
  /** Puntos de venta activos (electrónicos y no electrónicos), de menor a mayor. */
  puntosVenta: PuntoVentaOfrecido[];
  productos: ProductoOfrecido[];
  ambienteActivo: AmbienteArca;
};

/** Catálogos del editor. Columnas explícitas: nada de arca_credencial. */
export async function cargarContextoEditor(supabase: Supabase): Promise<ContextoEditor | string> {
  const [listas, puntos, productos, emisor] = await Promise.all([
    supabase.from("lista_precio").select("id, nombre").order("creado_en", { ascending: false }),
    supabase.from("punto_venta").select("numero, electronico").eq("activo", true).order("numero"),
    supabase
      .from("producto")
      .select("id, codigo, nombre, alicuota_iva")
      .eq("activo", true)
      .order("codigo"),
    supabase.from("arca_emisor").select("ambiente").eq("id", true).maybeSingle(),
  ]);
  const error = listas.error ?? puntos.error ?? productos.error ?? emisor.error;
  if (error) return error.message;

  return {
    listas: (listas.data ?? []) as ListaOfrecida[],
    puntosVenta: (puntos.data ?? []).map((p) => ({ numero: Number(p.numero), electronico: Boolean(p.electronico) })),
    productos: (productos.data ?? []).map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      alicuota: alicuotaArca(Number(p.alicuota_iva)),
      alicuotaOriginal: Number(p.alicuota_iva),
    })),
    ambienteActivo: (emisor.data?.ambiente ?? "homologacion") as AmbienteArca,
  };
}

/** Precios finales (sin IVA) de la lista, en el orden de la lista. */
export async function cargarPrecios(supabase: Supabase, listaId: string | null) {
  if (!listaId) return [];
  const { data } = await supabase
    .from("lista_precio_item")
    .select("producto_id, precio_final")
    .eq("lista_id", listaId)
    .order("orden");
  return (data ?? []).map((f) => ({ producto_id: f.producto_id as string | null, precio_final: Number(f.precio_final) }));
}

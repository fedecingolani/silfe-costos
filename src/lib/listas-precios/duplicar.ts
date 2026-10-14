import type { ListaPrecioBase, ListaPrecioItem } from "@/lib/tipos";

/** Datos actuales de un producto en v_lista_precio_base. */
export type BaseActual = Pick<ListaPrecioBase, "producto_id" | "precio_sugerido" | "costos_incompletos">;

/** Fila precargada del editor al duplicar una lista. Precios e IVA como texto, igual que en el editor. */
export type FilaDuplicada = {
  clave: string;
  es_repuesto: boolean;
  producto_id: string | null;
  codigo: string;
  descripcion: string;
  presentacion: string;
  alicuota_iva: string;
  precio_sugerido: number | null;
  precio_final: string;
  costos_incompletos: boolean;
  /** El producto ya no está en la base (inactivo): el sugerido es el de la lista original. */
  producto_no_disponible: boolean;
};

/**
 * Filas del editor para duplicar una lista: conserva descripción, orden,
 * precio final, código, presentación e IVA de la lista original, y toma el
 * precio sugerido y los costos incompletos actuales de cada producto.
 * Si el producto ya no está en la base, conserva el sugerido original y lo
 * marca como no disponible.
 */
export function filasDeDuplicado(items: ListaPrecioItem[], base: BaseActual[]): FilaDuplicada[] {
  const actuales = new Map<string, BaseActual>();
  for (const fila of base) {
    if (!actuales.has(fila.producto_id)) actuales.set(fila.producto_id, fila);
  }

  return [...items]
    .sort((a, b) => a.orden - b.orden)
    .map((it) => {
      const actual = it.producto_id ? actuales.get(it.producto_id) : undefined;
      return {
        clave: it.id,
        es_repuesto: it.es_repuesto,
        producto_id: it.producto_id,
        codigo: it.codigo ?? "",
        descripcion: it.descripcion,
        presentacion: it.presentacion ?? "",
        alicuota_iva: String(it.alicuota_iva),
        precio_sugerido: actual ? actual.precio_sugerido : it.precio_sugerido,
        precio_final: String(it.precio_final),
        costos_incompletos: actual?.costos_incompletos ?? false,
        producto_no_disponible: it.producto_id !== null && !actual,
      };
    });
}

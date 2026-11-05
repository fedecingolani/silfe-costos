/**
 * Actualización de precios al confirmar un comprobante de compra: qué
 * renglones se ofrecen marcados y cómo se muestra la diferencia con el
 * precio vigente. El precio de la factura y el vigente los calcula la base
 * (precios_comprobante_compra).
 *
 * Una materia prima recibe un solo precio por comprobante: de dos renglones
 * con la misma, se elige uno (la base rechaza los dos juntos).
 */
import { porcentaje } from "@/lib/formato";
import type { PrecioComprobanteCompra } from "@/lib/tipos";

/** Marcados de entrada: los que cambiaron o no tienen precio, uno por materia prima. */
export function seleccionInicialPrecios(lineas: readonly PrecioComprobanteCompra[]): Set<string> {
  const seleccion = new Set<string>();
  const materias = new Set<string>();
  for (const l of lineas) {
    if (!l.cambio || materias.has(l.materia_prima_id)) continue;
    seleccion.add(l.comprobante_compra_item_id);
    materias.add(l.materia_prima_id);
  }
  return seleccion;
}

/** Marca o desmarca un renglón; al marcarlo, desmarca otro de su materia prima. */
export function alternarPrecio(
  lineas: readonly PrecioComprobanteCompra[],
  seleccion: ReadonlySet<string>,
  itemId: string,
): Set<string> {
  const nueva = new Set(seleccion);
  if (nueva.has(itemId)) {
    nueva.delete(itemId);
    return nueva;
  }
  const materia = lineas.find((l) => l.comprobante_compra_item_id === itemId)?.materia_prima_id;
  for (const l of lineas) {
    if (l.materia_prima_id === materia) nueva.delete(l.comprobante_compra_item_id);
  }
  nueva.add(itemId);
  return nueva;
}

/** Variación en % del precio de la factura respecto del vigente; null sin vigente. */
export function diferenciaPrecio(linea: PrecioComprobanteCompra): number | null {
  if (linea.precio_vigente === null || linea.precio_vigente === 0) return null;
  return ((linea.precio_factura - linea.precio_vigente) / linea.precio_vigente) * 100;
}

/** «+25%», «-12,3%», «0%»; «Nuevo» si el proveedor no tenía precio. */
export function textoDiferencia(diferencia: number | null): string {
  if (diferencia === null) return "Nuevo";
  return `${diferencia > 0 ? "+" : ""}${porcentaje(diferencia)}`;
}

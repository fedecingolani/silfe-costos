/**
 * Renglones de ítems en pantalla, compartidos por los editores de ventas
 * (comprobantes y presupuestos): crear, cargar desde lo guardado, elegir un
 * producto y pasar a lo que se envía al servidor.
 */
import { precioPropuesto, type FilaItemEnviada } from "@/lib/comprobantes/borrador";
import { NO_GRAVADO, type AlicuotaIva } from "@/lib/tipos";

/** Producto activo que se ofrece en el buscador del editor. */
export type ProductoVendible = {
  id: string;
  codigo: string;
  nombre: string;
  /** null si la alícuota del producto no es una de ARCA: hay que corregirla en el producto. */
  alicuota: AlicuotaIva | null;
  alicuotaOriginal: number;
};

/** Renglón en pantalla: lo que se envía más lo que sólo sirve para mostrar. */
export type FilaItem = FilaItemEnviada & {
  clave: string;
  libre: boolean;
  codigo: string | null;
  /** Alícuota del producto (texto), para volver a ella después de pasar el renglón a no gravado. */
  alicuotaProducto: string | null;
  busqueda: string;
  aviso: string | null;
};

/** Ítem tal como está guardado, para cargarlo en el editor. */
export type ItemEditable = {
  producto_id: string | null;
  codigo: string | null;
  descripcion: string;
  observaciones: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  gravado: boolean;
  alicuota_iva: number | null;
};

let contador = 0;
const nuevaClave = () => `fila-${++contador}`;

export const filaVacia = (): FilaItem => ({
  clave: nuevaClave(),
  libre: false,
  productoId: null,
  codigo: null,
  alicuotaProducto: null,
  descripcion: "",
  observaciones: "",
  cantidad: "1",
  precioUnitario: "0",
  descuentoPct: "0",
  alicuotaIva: "21",
  busqueda: "",
  aviso: null,
});

/**
 * Renglón de un ítem guardado. Uno no gravado de producto toma la alícuota
 * del catálogo para poder volver a ella (si el producto sigue activo).
 */
export function filaDeItem(item: ItemEditable, productos: readonly ProductoVendible[]): FilaItem {
  return {
    clave: nuevaClave(),
    libre: item.producto_id === null,
    productoId: item.producto_id,
    codigo: item.codigo,
    alicuotaProducto: item.producto_id
      ? item.gravado
        ? String(item.alicuota_iva)
        : (() => {
            const p = productos.find((x) => x.id === item.producto_id);
            return p ? String(p.alicuota ?? p.alicuotaOriginal) : null;
          })()
      : null,
    descripcion: item.descripcion,
    observaciones: item.observaciones ?? "",
    cantidad: String(item.cantidad),
    precioUnitario: String(item.precio_unitario),
    descuentoPct: String(item.descuento_pct),
    alicuotaIva: item.gravado ? String(item.alicuota_iva) : NO_GRAVADO,
    busqueda: "",
    aviso: null,
  };
}

/** Renglones iniciales del editor: los guardados, o uno vacío. */
export function filasIniciales(items: readonly ItemEditable[] | undefined, productos: readonly ProductoVendible[]): FilaItem[] {
  return items && items.length > 0 ? items.map((i) => filaDeItem(i, productos)) : [filaVacia()];
}

/**
 * Cambios del renglón al elegir un producto: sus datos, su alícuota y el
 * precio de la lista (0 y un aviso si no está). Avisa si la alícuota del
 * producto no es una de ARCA.
 */
export function cambiosAlElegirProducto(
  producto: ProductoVendible,
  precios: ReadonlyMap<string, number>,
): Partial<FilaItem> {
  const { precio, enLista } = precioPropuesto(precios, producto.id);
  const alicuota = producto.alicuota !== null ? String(producto.alicuota) : String(producto.alicuotaOriginal);
  return {
    productoId: producto.id,
    codigo: producto.codigo,
    descripcion: producto.nombre,
    alicuotaIva: alicuota,
    alicuotaProducto: alicuota,
    precioUnitario: String(precio),
    busqueda: "",
    aviso:
      producto.alicuota === null
        ? `La alícuota del producto (${producto.alicuotaOriginal}%) no es una de ARCA: corregila en el producto.`
        : enLista
          ? null
          : "No está en la lista: cargá el precio.",
  };
}

/** Lo que se envía de un renglón (sin los datos que sólo sirven para mostrar). */
export function filaEnviada(fila: FilaItem): FilaItemEnviada {
  return {
    productoId: fila.productoId,
    descripcion: fila.descripcion,
    observaciones: fila.observaciones,
    cantidad: fila.cantidad,
    precioUnitario: fila.precioUnitario,
    descuentoPct: fila.descuentoPct,
    alicuotaIva: fila.alicuotaIva,
  };
}

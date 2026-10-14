import type { ItemListaDescarga } from "./tipos";

/** Renglón de la lista impresa, ya formateado. */
export type Renglon =
  | { tipo: "etiqueta"; texto: string }
  | {
      tipo: "item";
      /** Los repuestos van con sangría y sin negrita. */
      repuesto: boolean;
      /** Espacio en blanco antes del renglón: separa los grupos de primer nivel. */
      separarAntes: boolean;
      codigo: string | null;
      descripcion: string;
      /** "x docena", o null si es la unidad base. */
      presentacion: string | null;
      /** "$ 24.500" */
      precio: string;
      /** "+ IVA (21%)" */
      iva: string;
    };

const precioEnteroFmt = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

const precioDecimalFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
});

const alicuotaFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** "$ 24.500", o "$ 9.750,50" si el precio tiene centavos. */
export function formatearPrecio(valor: number): string {
  const redondeado = Math.round(valor * 100) / 100;
  const fmt = Number.isInteger(redondeado) ? precioEnteroFmt : precioDecimalFmt;
  return `$ ${fmt.format(redondeado)}`;
}

/** "+ IVA (21%)", "+ IVA (10,5%)". */
export function formatearIva(alicuota: number): string {
  return `+ IVA (${alicuotaFmt.format(alicuota)}%)`;
}

/** "x docena"; null para la unidad base o si no hay presentación. */
export function formatearPresentacion(presentacion: string | null): string | null {
  const texto = presentacion?.trim().toLowerCase() ?? "";
  if (texto === "" || texto === "unidad") return null;
  return `x ${texto}`;
}

/**
 * Arma los renglones de la lista impresa: antepone "Repuestos:" a cada tanda
 * de repuestos y marca el espacio entre los grupos de primer nivel.
 */
export function armarRenglones(items: ItemListaDescarga[]): Renglon[] {
  const renglones: Renglon[] = [];
  let anteriorEsRepuesto = false;

  items.forEach((item, i) => {
    if (item.es_repuesto && (i === 0 || !anteriorEsRepuesto)) {
      renglones.push({ tipo: "etiqueta", texto: "Repuestos:" });
    }
    renglones.push({
      tipo: "item",
      repuesto: item.es_repuesto,
      separarAntes: !item.es_repuesto && i > 0,
      codigo: item.codigo?.trim() || null,
      descripcion: item.descripcion,
      presentacion: formatearPresentacion(item.presentacion),
      precio: formatearPrecio(item.precio_final),
      iva: formatearIva(item.alicuota_iva),
    });
    anteriorEsRepuesto = item.es_repuesto;
  });

  return renglones;
}

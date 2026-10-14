import type { ListaPrecioItem } from "@/lib/tipos";

/** Datos de un ítem que se imprimen en la lista descargada. */
export type ItemListaDescarga = Pick<
  ListaPrecioItem,
  "codigo" | "descripcion" | "presentacion" | "alicuota_iva" | "precio_final" | "es_repuesto"
>;

/** Todo lo que necesitan los generadores de PDF y Excel. Ítems en el orden de impresión. */
export type DatosListaDescarga = {
  titulo: string;
  items: ItemListaDescarga[];
  /** Texto grande y centrado del pie (ej. "SIL – FE 30 AÑOS"). null: no se imprime. */
  textoDestacado: string | null;
  /** Datos de contacto del pie, en varias líneas. null: no se imprime. */
  contacto: string | null;
  /** Bytes del logo en PNG. null: la lista sale sin logo. */
  logo: Uint8Array | null;
};

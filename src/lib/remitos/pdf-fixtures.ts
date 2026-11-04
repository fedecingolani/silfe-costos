/**
 * Filas de ejemplo para los tests del PDF del remito. Datos ficticios: no
 * corresponden a remitos reales.
 */
import { ITEM_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import type { ClientePdfRemito, FilaItemRemitoPdf, FilaRemitoPdf } from "./pdf-datos";

export const REMITO_EJEMPLO: FilaRemitoPdf = {
  id: "5b7c0f5e-2d1a-4a8e-9f0b-3c6d7e8f9a01",
  punto_venta: 1,
  numero: 1,
  fecha: "2026-11-04",
  estado: "emitido",
  domicilio_entrega: "Ruta 151 Km 4, Cinco Saltos, Río Negro",
  observaciones: "Entregar por la tarde",
  neto: 1400000,
  no_gravado: 0,
  iva: 294000,
  total: 1694000,
  valor_declarado: 1500000,
  bultos_total: 12,
};

export const CLIENTE_REMITO_EJEMPLO: ClientePdfRemito = {
  razon_social: "Frutícola del Valle S.R.L.",
  cuit: "30698765432",
  condicion_iva: "Responsable Inscripto",
  direccion: "Av. Roca 1234",
  localidad: "Cipolletti",
  provincia: "Río Negro",
};

export const ITEM_REMITO_EJEMPLO: FilaItemRemitoPdf = { ...ITEM_EJEMPLO, bultos: 12 };

/** n ítems de 1.000 + 21% y 1 bulto cada uno, con los totales que corresponden. */
export function ejemploRemitoConItems(n: number) {
  const items: FilaItemRemitoPdf[] = Array.from({ length: n }, (_, i) => ({
    ...ITEM_REMITO_EJEMPLO,
    codigo: `P-${String(i + 1).padStart(3, "0")}`,
    descripcion: `Producto ${i + 1}`,
    observaciones: null,
    cantidad: 1,
    precio_unitario: 1000,
    importe: 1000,
    iva: 210,
    bultos: 1,
  }));
  const remito: FilaRemitoPdf = {
    ...REMITO_EJEMPLO,
    neto: 1000 * n,
    iva: 210 * n,
    total: 1210 * n,
    valor_declarado: 1000 * n,
    bultos_total: n,
  };
  return { remito, items };
}

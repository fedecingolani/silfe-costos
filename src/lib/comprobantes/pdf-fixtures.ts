/**
 * Filas de ejemplo para los tests del PDF y para generar PDFs de muestra.
 * Datos ficticios: no corresponden a comprobantes reales.
 */
import type { FilaComprobantePdf, FilaEmisorPdf, FilaItemPdf } from "./pdf-datos";

export const EMISOR_EJEMPLO: FilaEmisorPdf = {
  cuit: "30712345671",
  razon_social: "SILFE S.A.",
  condicion_iva: "Responsable Inscripto",
  domicilio_comercial: "Ruta 22 Km 1200, General Roca, Río Negro",
  ingresos_brutos: "30-71234567-1",
  inicio_actividades: "2005-03-01",
};

export const COMPROBANTE_EJEMPLO: FilaComprobantePdf = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  punto_venta: 7,
  ambiente: "produccion",
  estado: "autorizado",
  clase: "factura",
  letra: "A",
  tipo_arca: 1,
  numero: 361,
  fecha: "2026-10-16",
  fecha_vencimiento_pago: "2026-11-15",
  condicion_pago: "cuenta_corriente",
  receptor_razon_social: "Frutícola del Valle S.R.L.",
  receptor_doc_tipo: 80,
  receptor_doc_nro: "30698765432",
  receptor_condicion_iva: "Responsable Inscripto",
  receptor_domicilio: "Av. Roca 1234, Cipolletti",
  receptor_provincia: "Río Negro",
  neto: 1400000,
  no_gravado: 0,
  iva: 294000,
  total: 1694000,
  cae: "76123456789012",
  cae_vencimiento: "2026-10-26",
  iva_detalle: [{ id: 5, alicuota: 21, base: 1400000, importe: 294000 }],
  periodo_asoc_desde: null,
  periodo_asoc_hasta: null,
};

export const ITEM_EJEMPLO: FilaItemPdf = {
  codigo: "LC-001",
  descripcion: "Lona de cosecha reforzada 2 x 3 m",
  observaciones: "Color verde",
  unidad: "un",
  cantidad: 100,
  precio_unitario: 14000,
  descuento_pct: 0,
  gravado: true,
  alicuota_iva: 21,
  importe: 1400000,
  iva: 294000,
};

/** n ítems de 1.000 + 21% cada uno, con los totales que corresponden. */
export function ejemploConItems(n: number, ambiente: FilaComprobantePdf["ambiente"] = "produccion") {
  const items: FilaItemPdf[] = Array.from({ length: n }, (_, i) => ({
    ...ITEM_EJEMPLO,
    codigo: `P-${String(i + 1).padStart(3, "0")}`,
    descripcion: i % 7 === 3 ? `Correa de cosecha con hebilla metálica y refuerzo doble, modelo ${i + 1}` : `Producto ${i + 1}`,
    observaciones: i % 5 === 0 ? "Entrega parcial" : null,
    cantidad: 1,
    precio_unitario: 1000,
    importe: 1000,
    iva: 210,
  }));
  const comprobante: FilaComprobantePdf = {
    ...COMPROBANTE_EJEMPLO,
    ambiente,
    neto: 1000 * n,
    iva: 210 * n,
    total: 1210 * n,
    iva_detalle: [{ id: 5, alicuota: 21, base: 1000 * n, importe: 210 * n }],
  };
  return { comprobante, items, emisor: EMISOR_EJEMPLO };
}

/**
 * Factura X de un punto de venta no electrónico: sin código de ARCA, CAE ni
 * ambiente, y sin IVA (el ítem conserva su alícuota, que se ignora).
 */
export function ejemploX() {
  const items: FilaItemPdf[] = [{ ...ITEM_EJEMPLO, iva: 0 }];
  const comprobante: FilaComprobantePdf = {
    ...COMPROBANTE_EJEMPLO,
    punto_venta: 9999,
    ambiente: null,
    letra: "X",
    tipo_arca: null,
    numero: 1,
    neto: 1400000,
    no_gravado: 0,
    iva: 0,
    total: 1400000,
    iva_detalle: null,
    cae: null,
    cae_vencimiento: null,
  };
  return { comprobante, items, emisor: EMISOR_EJEMPLO };
}

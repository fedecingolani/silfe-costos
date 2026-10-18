/**
 * Filas de ejemplo para los tests del PDF del recibo y para generar PDFs de
 * muestra. Datos ficticios: no corresponden a recibos reales.
 */
import { EMISOR_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import type {
  FilaClienteReciboPdf,
  FilaImputacionReciboPdf,
  FilaMedioReciboPdf,
  FilaReciboPdf,
} from "./pdf-recibo-datos";

export const RECIBO_EJEMPLO: FilaReciboPdf = {
  id: "5b1f6c1e-6a0d-4a5a-9f39-0d1f3f0e7a11",
  numero_texto: "R-00001-00000042",
  fecha: "2026-10-18",
  estado: "emitido",
  total: 1_234_567.89,
  motivo_anulacion: null,
  anulado_en: null,
  observaciones: "Pago de las facturas de septiembre.",
};

export const CLIENTE_RECIBO_EJEMPLO: FilaClienteReciboPdf = {
  razon_social: "Frutícola del Valle S.R.L.",
  cuit: "30698765432",
  condicion_iva: "Responsable Inscripto",
  direccion: "Av. Roca 1234",
  localidad: "General Roca",
  provincia: "Río Negro",
  codigo_postal: "8332",
};

/** Efectivo, transferencia, cheque, e-cheq y retención de IIBB: suman el total del ejemplo. */
export const MEDIOS_EJEMPLO: FilaMedioReciboPdf[] = [
  {
    orden: 1,
    tipo: "efectivo",
    importe: 100_000,
    banco: null,
    referencia: null,
    retencion_tipo: null,
    retencion_jurisdiccion: null,
    certificado: null,
    fecha_retencion: null,
    cheque: null,
  },
  {
    orden: 2,
    tipo: "transferencia",
    importe: 534_567.89,
    banco: "Banco Patagonia cta. 123-456/7",
    referencia: "TRF 998877",
    retencion_tipo: null,
    retencion_jurisdiccion: null,
    certificado: null,
    fecha_retencion: null,
    cheque: null,
  },
  {
    orden: 3,
    tipo: "cheque",
    importe: 300_000,
    banco: null,
    referencia: null,
    retencion_tipo: null,
    retencion_jurisdiccion: null,
    certificado: null,
    fecha_retencion: null,
    cheque: {
      banco: "Banco Nación",
      numero: "00012345",
      fecha_pago: "2026-11-15",
      librador: "Distribuidora Sur S.A.",
      librador_cuit: "30711111112",
    },
  },
  {
    orden: 4,
    tipo: "echeq",
    importe: 250_000,
    banco: null,
    referencia: null,
    retencion_tipo: null,
    retencion_jurisdiccion: null,
    certificado: null,
    fecha_retencion: null,
    cheque: { banco: "Banco Galicia", numero: "E-778899", fecha_pago: "2026-12-01", librador: null, librador_cuit: null },
  },
  {
    orden: 5,
    tipo: "retencion",
    importe: 50_000,
    banco: null,
    referencia: null,
    retencion_tipo: "iibb",
    retencion_jurisdiccion: "Río Negro",
    certificado: "RN-0001-000123",
    fecha_retencion: "2026-10-18",
    cheque: null,
  },
];

/** Dos facturas canceladas por 1.000.000 en total: quedan 234.567,89 a favor. */
export const IMPUTACIONES_EJEMPLO: FilaImputacionReciboPdf[] = [
  {
    importe: 600_000,
    automatica: false,
    comprobante: { clase: "factura", letra: "A", punto_venta: 7, numero: 361, fecha: "2026-09-10" },
  },
  {
    importe: 400_000,
    automatica: false,
    comprobante: { clase: "factura", letra: "A", punto_venta: 7, numero: 375, fecha: "2026-09-25" },
  },
];

export function ejemploRecibo(cambios: Partial<FilaReciboPdf> = {}) {
  return {
    recibo: { ...RECIBO_EJEMPLO, ...cambios },
    cliente: CLIENTE_RECIBO_EJEMPLO,
    medios: MEDIOS_EJEMPLO,
    imputaciones: cambios.estado === "anulado" ? [] : IMPUTACIONES_EJEMPLO,
    emisor: EMISOR_EJEMPLO,
  };
}

/** Recibo anulado: sus imputaciones ya se deshicieron. */
export function ejemploReciboAnulado() {
  return ejemploRecibo({
    estado: "anulado",
    motivo_anulacion: "Cargado al cliente equivocado.",
    anulado_en: "2026-10-18T15:30:00Z",
  });
}

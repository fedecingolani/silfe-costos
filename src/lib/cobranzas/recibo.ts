/**
 * Recibo en borrador: validación de lo cargado en la pantalla (cliente,
 * fecha y medios de pago con los datos que pide cada tipo), total y número.
 * La base vuelve a controlar lo esencial al emitir (total = suma de medios,
 * al menos un medio); acá están los mensajes para la pantalla.
 */
import type { TipoMedioPago, TipoRetencion } from "@/lib/tipos";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { sumarPesos } from "./dinero";

export type ChequeBorrador = {
  banco: string;
  numero: string;
  /** yyyy-mm-dd */
  fechaEmision?: string | null;
  fechaPago: string;
  librador?: string | null;
  libradorCuit?: string | null;
};

export type RetencionBorrador = {
  tipo: TipoRetencion | null;
  /** Obligatoria en IIBB. */
  jurisdiccion?: string | null;
  certificado: string;
  /** yyyy-mm-dd */
  fecha: string;
};

/** Un medio de pago. cheque: tipos cheque y echeq; retencion: tipo retencion. */
export type MedioBorrador = {
  tipo: TipoMedioPago;
  importe: number;
  /** Transferencia: banco o cuenta destino. */
  banco?: string | null;
  referencia?: string | null;
  cheque?: ChequeBorrador | null;
  retencion?: RetencionBorrador | null;
};

export type ReciboBorrador = {
  clienteId: string | null;
  /** yyyy-mm-dd */
  fecha: string | null;
  medios: MedioBorrador[];
};

const vacio = (valor: string | null | undefined) => !valor || valor.trim() === "";

function erroresCheque(cheque: ChequeBorrador | null | undefined): string[] {
  const errores: string[] = [];
  if (vacio(cheque?.banco)) errores.push("completá el banco del cheque.");
  if (vacio(cheque?.numero)) errores.push("completá el número del cheque.");
  if (!esFechaValida(cheque?.fechaPago)) errores.push("completá la fecha de pago del cheque.");
  if (!vacio(cheque?.libradorCuit) && (cheque?.libradorCuit ?? "").replace(/\D/g, "").length !== 11) {
    errores.push("la CUIT del librador tiene 11 dígitos.");
  }
  return errores;
}

function erroresRetencion(retencion: RetencionBorrador | null | undefined): string[] {
  const errores: string[] = [];
  if (!retencion?.tipo) errores.push("elegí el tipo de retención.");
  if (vacio(retencion?.certificado)) errores.push("completá el número de certificado.");
  if (!esFechaValida(retencion?.fecha)) errores.push("completá la fecha de la retención.");
  if (retencion?.tipo === "iibb" && vacio(retencion.jurisdiccion)) {
    errores.push("una retención de IIBB necesita la jurisdicción.");
  }
  return errores;
}

export function validarRecibo(recibo: ReciboBorrador): string[] {
  const errores: string[] = [];
  if (vacio(recibo.clienteId)) errores.push("Elegí el cliente.");
  if (!esFechaValida(recibo.fecha)) errores.push("Completá la fecha.");
  if (recibo.medios.length === 0) errores.push("Cargá al menos un medio de pago.");

  recibo.medios.forEach((medio, indice) => {
    const propios: string[] = [];
    if (!Number.isFinite(medio.importe) || medio.importe <= 0) propios.push("el importe tiene que ser mayor a cero.");
    if (medio.tipo === "cheque" || medio.tipo === "echeq") propios.push(...erroresCheque(medio.cheque));
    if (medio.tipo === "retencion") propios.push(...erroresRetencion(medio.retencion));
    errores.push(...propios.map((error) => `Medio ${indice + 1}: ${error}`));
  });
  return errores;
}

/** Total del recibo: la suma de sus medios, exacta a centavos. */
export function totalRecibo(medios: readonly Pick<MedioBorrador, "importe">[]): number {
  return sumarPesos(medios.map((medio) => medio.importe));
}

/** Número para mostrar e imprimir: R-00001-00000001. */
export function formatearNumeroRecibo(puntoVenta: number, numero: number): string {
  return `R-${String(puntoVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

/**
 * Comprobantes asociados cargados a mano (emitidos con el sistema anterior,
 * que no están en la base). La base exige que estén todos los datos, pero
 * se valida antes de armar el CbteAsoc para no mandar a ARCA un NaN o una
 * fecha vacía, y para decir qué falta.
 */
import type { AsociadoSolicitud } from "@/lib/arca/wsfe";
import { esFechaValida } from "./validacion";

/** Fila de comprobante_asociado tal como llega de Postgres (bigint puede venir como texto). */
export type FilaAsociadoManual = {
  tipo_arca: number | string | null;
  punto_venta: number | string | null;
  numero: number | string | null;
  fecha: string | null;
  cuit: string | null;
};

const TIPOS_ARCA = new Set([1, 2, 3, 6, 7, 8]);

function entero(valor: number | string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isInteger(n) ? n : null;
}

/** CbteAsoc de un asociado manual. Lanza un error legible si falta o está mal algún dato. */
export function asociadoManual(fila: FilaAsociadoManual): AsociadoSolicitud {
  const tipo = entero(fila.tipo_arca);
  const puntoVenta = entero(fila.punto_venta);
  const numero = entero(fila.numero);
  const cuit = (fila.cuit ?? "").replace(/\D/g, "");

  const faltan: string[] = [];
  if (tipo === null || !TIPOS_ARCA.has(tipo)) faltan.push("tipo");
  if (puntoVenta === null || puntoVenta < 1 || puntoVenta > 99999) faltan.push("punto de venta");
  if (numero === null || numero < 1) faltan.push("número");
  if (!esFechaValida(fila.fecha)) faltan.push("fecha");
  if (cuit.length !== 11) faltan.push("CUIT del emisor");
  if (faltan.length > 0) {
    throw new Error(`El comprobante asociado cargado a mano está incompleto. Revisá: ${faltan.join(", ")}.`);
  }

  return { tipo: tipo!, puntoVenta: puntoVenta!, numero: numero!, fecha: fila.fecha!, cuit };
}

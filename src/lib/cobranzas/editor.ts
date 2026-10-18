/**
 * Ayudantes puros del editor de recibos: lectura de los importes a imputar
 * tal como los escribe el usuario y avisos que viajan por la URL después de
 * guardar o emitir (la navegación vuelve a montar el editor y perdería el
 * mensaje si quedara sólo en el estado).
 */
import { aDecimal } from "@/lib/comprobantes/borrador";
import { aCentavos } from "./dinero";
import type { ImputacionElegida } from "./imputacion";

/**
 * Importes a imputar escritos por el usuario. Los vacíos y los ceros se
 * ignoran (el comprobante no se imputa). Lo que no se puede leer como número
 * queda como NaN: tomarlo como 0 movería ese dinero a "a favor" sin avisar.
 */
export function leerImputacionesEditor(aImputar: Readonly<Record<string, string>>): ImputacionElegida[] {
  const elegidas: ImputacionElegida[] = [];
  for (const [comprobanteId, valor] of Object.entries(aImputar)) {
    if (valor.trim() === "") continue;
    const importe = aDecimal(valor) ?? Number.NaN;
    if (Number.isFinite(importe) && aCentavos(importe) === 0) continue;
    elegidas.push({ comprobanteId, importe });
  }
  return elegidas;
}

/** Un error por cada importe que no es un número, con el nombre del comprobante. */
export function erroresImporteImputado(
  elegidas: readonly ImputacionElegida[],
  nombres: ReadonlyMap<string, string>,
): string[] {
  return elegidas
    .filter((e) => !Number.isFinite(e.importe))
    .map((e) => `El importe a imputar de ${nombres.get(e.comprobanteId) ?? "un comprobante"} no es un número válido.`);
}

const AVISOS: Record<string, string> = {
  guardado: "Borrador guardado.",
  emitido: "Recibo emitido.",
  anulado: "Recibo anulado.",
};

/** Aviso de `?aviso=…`; sólo los conocidos, nunca texto arbitrario de la URL. */
export function avisoDeParametro(valor: string | string[] | undefined): string | null {
  if (typeof valor !== "string") return null;
  return Object.hasOwn(AVISOS, valor) ? AVISOS[valor] : null;
}

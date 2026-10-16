/**
 * Validaciones de un borrador antes de pedir el CAE. Devuelve todos los
 * problemas juntos, en castellano, para mostrarlos de una vez. El servidor
 * las vuelve a correr al autorizar: lo que valida la pantalla no alcanza.
 */
import { validarCuit } from "@/lib/clientes/validaciones";
import type { ClaseComprobante, CondicionIva } from "@/lib/tipos";
import { calcularTotales, type ItemACalcular } from "./calculo";
import { MENSAJE_SIN_CONDICION_IVA, letraDe } from "./letra";

/** Para concepto Productos, ARCA acepta la fecha hasta 5 días antes o después de hoy. */
export const DIAS_TOLERANCIA_FECHA = 5;

export type BorradorAValidar = {
  clase: ClaseComprobante;
  /** yyyy-mm-dd */
  fecha: string;
  receptor: { razonSocial: string | null; condicionIva: CondicionIva | null; cuit: string | null };
  items: readonly ItemACalcular[];
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Fecha yyyy-mm-dd como días desde la época (sin zona horaria). */
function dias(fecha: string): number {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia) / MS_POR_DIA;
}

function sumarDias(fecha: string, cantidad: number): string {
  return new Date((dias(fecha) + cantidad) * MS_POR_DIA).toISOString().slice(0, 10);
}

function formatoArgentino(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}

/**
 * @param hoy fecha de hoy en Argentina, yyyy-mm-dd.
 */
export function validarParaAutorizar(borrador: BorradorAValidar, hoy: string): string[] {
  const errores: string[] = [];
  const { receptor, items } = borrador;

  if (!receptor.razonSocial?.trim()) errores.push("Falta la razón social del cliente.");
  if (!receptor.condicionIva) {
    errores.push(MENSAJE_SIN_CONDICION_IVA);
  } else if (letraDe(receptor.condicionIva) === "A" && !(receptor.cuit && validarCuit(receptor.cuit).valido)) {
    errores.push("Para un comprobante A el cliente necesita una CUIT válida.");
  }

  if (items.length === 0) errores.push("Agregá al menos un ítem.");
  items.forEach((item, i) => {
    if (!(item.cantidad > 0)) errores.push(`La cantidad del ítem ${i + 1} tiene que ser mayor a cero.`);
  });

  try {
    if (!(calcularTotales(items).total > 0)) errores.push("El total tiene que ser mayor a cero.");
  } catch (e) {
    errores.push(e instanceof Error ? e.message : String(e));
  }

  if (Math.abs(dias(borrador.fecha) - dias(hoy)) > DIAS_TOLERANCIA_FECHA) {
    errores.push(
      `La fecha del comprobante tiene que estar entre el ${formatoArgentino(sumarDias(hoy, -DIAS_TOLERANCIA_FECHA))} ` +
        `y el ${formatoArgentino(sumarDias(hoy, DIAS_TOLERANCIA_FECHA))}.`,
    );
  }

  return errores;
}

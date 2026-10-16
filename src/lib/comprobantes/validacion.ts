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

/**
 * Fecha yyyy-mm-dd como días desde la época (sin zona horaria), o null si
 * está vacía, mal formada o no existe (por ejemplo, 30 de febrero).
 */
function dias(fecha: string): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!partes) return null;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const ms = Date.UTC(anio, mes - 1, dia);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return ms / MS_POR_DIA;
}

/** true si `fecha` es una fecha yyyy-mm-dd que existe. */
export function esFechaValida(fecha: string | null | undefined): fecha is string {
  return typeof fecha === "string" && dias(fecha) !== null;
}

function sumarDias(diasFecha: number, cantidad: number): string {
  return new Date((diasFecha + cantidad) * MS_POR_DIA).toISOString().slice(0, 10);
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

  // Una fecha inválida daría NaN y la comparación pasaría sin avisar.
  const diasFecha = dias(borrador.fecha);
  const diasHoy = dias(hoy);
  if (diasFecha === null) {
    errores.push("La fecha del comprobante no es válida.");
  } else if (diasHoy === null) {
    errores.push("No se pudo determinar la fecha de hoy para validar la fecha.");
  } else if (Math.abs(diasFecha - diasHoy) > DIAS_TOLERANCIA_FECHA) {
    errores.push(
      `La fecha del comprobante tiene que estar entre el ${formatoArgentino(sumarDias(diasHoy, -DIAS_TOLERANCIA_FECHA))} ` +
        `y el ${formatoArgentino(sumarDias(diasHoy, DIAS_TOLERANCIA_FECHA))}.`,
    );
  }

  return errores;
}

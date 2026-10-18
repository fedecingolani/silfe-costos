/**
 * Comprobantes asociados de las notas de crédito y débito (CbtesAsoc).
 *
 * - De la base: una factura (o nota de débito) autorizada en la app.
 * - Cargados a mano: emitidos con el sistema anterior (facturas 1 a 360),
 *   que no están en la base. La CUIT es la del emisor: son comprobantes
 *   propios. La base exige que estén todos los datos, pero se valida antes
 *   de armar el CbteAsoc para no mandar a ARCA un NaN o una fecha vacía, y
 *   para decir qué falta.
 *
 * Reglas (ARCA rechaza lo demás):
 * - una nota de crédito o débito lleva al menos un asociado, y la misma
 *   letra que sus asociados;
 * - nota de crédito: sobre una factura o una nota de débito (la anula);
 * - nota de débito: sólo sobre una factura;
 * - nunca una nota de crédito sobre otra nota de crédito.
 */
import type { AsociadoSolicitud } from "@/lib/arca/wsfe";
import {
  NOMBRES_CLASE_COMPROBANTE,
  type ClaseComprobante,
  type EstadoComprobante,
  type LetraComprobante,
  type TipoComprobanteArca,
} from "@/lib/tipos";
import { formatearNumero } from "./numero";
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

// ----- Tipos de ARCA ---------------------------------------------------------

const POR_TIPO: Record<TipoComprobanteArca, { letra: LetraComprobante; clase: ClaseComprobante }> = {
  1: { letra: "A", clase: "factura" },
  2: { letra: "A", clase: "nota_debito" },
  3: { letra: "A", clase: "nota_credito" },
  6: { letra: "B", clase: "factura" },
  7: { letra: "B", clase: "nota_debito" },
  8: { letra: "B", clase: "nota_credito" },
};

function porTipo(tipo: number | string | null | undefined) {
  return POR_TIPO[Number(tipo) as TipoComprobanteArca] ?? null;
}

export function letraDeTipoArca(tipo: number | string | null | undefined): LetraComprobante | null {
  return porTipo(tipo)?.letra ?? null;
}

export function claseDeTipoArca(tipo: number | string | null | undefined): ClaseComprobante | null {
  return porTipo(tipo)?.clase ?? null;
}

/** "Factura A", "Nota de débito B"... */
export function nombreTipoArca(tipo: TipoComprobanteArca): string {
  return `${NOMBRES_CLASE_COMPROBANTE[POR_TIPO[tipo].clase]} ${POR_TIPO[tipo].letra}`;
}

/** Notas que se pueden generar desde un comprobante (sólo autorizado). */
export function notasPermitidas(c: { clase: ClaseComprobante; estado: EstadoComprobante }): ClaseComprobante[] {
  if (c.estado !== "autorizado") return [];
  if (c.clase === "factura") return ["nota_credito", "nota_debito"];
  if (c.clase === "nota_debito") return ["nota_credito"];
  return [];
}

/** Tipos que se ofrecen para cargar a mano el asociado de cada nota. */
export const TIPOS_ASOCIADO_MANUAL: Record<"nota_credito" | "nota_debito", TipoComprobanteArca[]> = {
  nota_credito: [1, 6, 2, 7],
  nota_debito: [1, 6],
};

/**
 * Valida los asociados de un comprobante por sus códigos de ARCA. Devuelve
 * la letra que tiene que llevar la nota (null en una factura) o el error.
 */
export function validarAsociadosNota(
  clase: ClaseComprobante,
  tipos: readonly (number | string)[],
): { letra: LetraComprobante | null } | { error: string } {
  if (clase === "factura") {
    return tipos.length === 0 ? { letra: null } : { error: "Una factura no lleva comprobante asociado." };
  }
  if (tipos.length === 0) {
    return {
      error:
        clase === "nota_credito"
          ? "Una nota de crédito necesita el comprobante asociado (la factura que corrige)."
          : "Una nota de débito necesita el comprobante asociado (la factura que ajusta).",
    };
  }
  const letras = new Set<LetraComprobante>();
  for (const tipo of tipos) {
    const asociado = porTipo(tipo);
    if (!asociado) return { error: `El comprobante asociado tiene un tipo que no es de ARCA (${tipo}).` };
    if (!notasPermitidas({ clase: asociado.clase, estado: "autorizado" }).includes(clase)) {
      return {
        error:
          `Una ${NOMBRES_CLASE_COMPROBANTE[clase].toLowerCase()} no puede asociarse a una ` +
          `${NOMBRES_CLASE_COMPROBANTE[asociado.clase].toLowerCase()} ${asociado.letra}.`,
      };
    }
    letras.add(asociado.letra);
  }
  if (letras.size > 1) return { error: "Los comprobantes asociados tienen letras distintas: la nota lleva una sola letra." };
  return { letra: [...letras][0] };
}

// ----- Asociado de la base ---------------------------------------------------

export type FilaAsociadoInterno = {
  estado: EstadoComprobante;
  tipo_arca: number | string | null;
  punto_venta: number | string;
  numero: number | string | null;
  fecha: string;
};

/** CbteAsoc de un comprobante de la base: con su fecha y la CUIT del emisor (es propio). */
export function asociadoInterno(fila: FilaAsociadoInterno, cuitEmisor: string | null): AsociadoSolicitud {
  if (fila.estado !== "autorizado" || fila.numero === null || fila.tipo_arca === null) {
    throw new Error("El comprobante asociado no está autorizado: sólo se asocian comprobantes con número.");
  }
  const cuit = (cuitEmisor ?? "").replace(/\D/g, "");
  if (cuit.length !== 11) throw new Error("Completá la CUIT del emisor en Configuración → ARCA: va en el comprobante asociado.");
  return {
    tipo: Number(fila.tipo_arca),
    puntoVenta: Number(fila.punto_venta),
    numero: Number(fila.numero),
    fecha: fila.fecha,
    cuit,
  };
}

// ----- Saldo para notas de crédito ---------------------------------------------

const pesosFmt = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const centavos = (valor: number) => Math.round(valor * 100);

/**
 * Lo que queda para acreditar: el total de los asociados de la base menos
 * las otras notas de crédito que los acreditan.
 */
export function saldoNotaCredito(totalesAsociados: readonly number[], otrasNotas: readonly number[]): number {
  const suma = (valores: readonly number[]) => valores.reduce((total, v) => total + centavos(Number(v)), 0);
  return (suma(totalesAsociados) - suma(otrasNotas)) / 100;
}

/** Error si la nota de crédito supera el saldo; null si entra. */
export function mensajeExcedeSaldo(totalNota: number, saldo: number, asociado: string): string | null {
  if (centavos(totalNota) <= centavos(saldo)) return null;
  return (
    `La nota de crédito ($ ${pesosFmt.format(totalNota)}) supera el saldo disponible de ${asociado}: ` +
    `$ ${pesosFmt.format(Math.max(saldo, 0))}.`
  );
}

// ----- Texto -------------------------------------------------------------------

/** "A-00007-00000361 del 16/10/2026". */
export function textoAsociado(a: {
  tipo_arca: number | string | null;
  punto_venta: number | string | null;
  numero: number | string | null;
  fecha: string | null;
}): string {
  const letra = letraDeTipoArca(a.tipo_arca);
  const numero = letra ? formatearNumero(letra, Number(a.punto_venta), Number(a.numero)) : `${a.punto_venta}-${a.numero}`;
  const fecha = a.fecha ? /^(\d{4})-(\d{2})-(\d{2})/.exec(a.fecha) : null;
  return fecha ? `${numero} del ${fecha[3]}/${fecha[2]}/${fecha[1]}` : numero;
}

// ----- Asociado cargado a mano en la pantalla ----------------------------------------

/** Los campos tal como están en la pantalla. */
export type AsociadoManualEnviado = { tipoArca: string; puntoVenta: string; numero: string; fecha: string };

/** Lo que se guarda en comprobante_asociado (parámetro p_asociados de guardar_borrador_comprobante). */
export type AsociadoGuardado =
  | { asociado_id: string }
  | { tipo_arca: TipoComprobanteArca; punto_venta: number; numero: number; fecha: string; cuit: string };

function campo(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
}

/**
 * Lee el asociado cargado a mano. Sin ningún dato no hay asociado (el
 * borrador se guarda igual; para autorizar se exige).
 */
export function leerAsociadoManual(
  enviado: unknown,
  clase: "nota_credito" | "nota_debito",
  fechaNota: string | null,
  cuitEmisor: string | null,
): { asociado: AsociadoGuardado | null } | { errores: string[] } {
  const datos = typeof enviado === "object" && enviado !== null ? (enviado as Record<string, unknown>) : {};
  const [tipoTexto, puntoTexto, numeroTexto, fecha] = ["tipoArca", "puntoVenta", "numero", "fecha"].map((c) =>
    campo(datos[c]),
  );
  if (!tipoTexto && !puntoTexto && !numeroTexto && !fecha) return { asociado: null };

  const errores: string[] = [];
  const tipo = Number(tipoTexto) as TipoComprobanteArca;
  if (!TIPOS_ASOCIADO_MANUAL[clase].includes(tipo)) errores.push("Comprobante asociado: elegí el tipo.");
  const puntoVenta = Number(puntoTexto);
  if (!/^\d+$/.test(puntoTexto) || puntoVenta < 1 || puntoVenta > 99999) {
    errores.push("Comprobante asociado: el punto de venta va de 1 a 99999.");
  }
  const numero = Number(numeroTexto);
  if (!/^\d+$/.test(numeroTexto) || numero < 1) {
    errores.push("Comprobante asociado: el número tiene que ser un entero mayor a cero.");
  }
  if (!esFechaValida(fecha)) errores.push("Comprobante asociado: completá la fecha.");
  else if (fechaNota && fecha > fechaNota) errores.push("Comprobante asociado: la fecha no puede ser posterior a la de la nota.");
  const cuit = (cuitEmisor ?? "").replace(/\D/g, "");
  if (cuit.length !== 11) errores.push("Completá la CUIT del emisor en Configuración → ARCA: va en el comprobante asociado.");

  if (errores.length > 0) return { errores };
  return { asociado: { tipo_arca: tipo, punto_venta: puntoVenta, numero, fecha, cuit } };
}

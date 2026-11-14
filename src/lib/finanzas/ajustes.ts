// Validación pura del formulario de un ajuste manual de fondos. Repite los
// checks de `ajuste_fondos` para devolver un mensaje claro antes de ir a la
// base.

import { esFechaValida } from "@/lib/comprobantes/validacion";
import { aCentavos } from "@/lib/cobranzas/dinero";
import type { TipoAjusteFondos } from "@/lib/tipos";

/** Lo que llega del formulario, todo como texto. */
export type EntradaAjuste = {
  fecha: string | null;
  tipo: string | null;
  importe: string | null;
  concepto: string | null;
  observacion: string | null;
};

/** Columnas de `ajuste_fondos` que se cargan al registrarlo. */
export type DatosAjuste = {
  fecha: string;
  tipo: TipoAjusteFondos;
  importe: number;
  concepto: string;
  observacion: string | null;
};

type Resultado<T> = { datos: T } | { error: string };

/** Lo máximo que guarda numeric(14,2). */
const IMPORTE_TOPE = 999_999_999_999.99;

function limpiar(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
}

/**
 * Importe escrito a mano: acepta "$", coma o punto decimal y puntos de
 * miles ("1.500,25"). Con coma, los puntos son de miles. Sin coma, los
 * puntos en grupos de tres dígitos son de miles ("150.000") y si no, el
 * punto es el decimal ("1500.5"). null si no es un número.
 */
export function parsearImporte(valor: string | null | undefined): number | null {
  let texto = (valor ?? "").replace(/[$\s]/g, "");
  if (texto === "") return null;
  if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, "");
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

export function validarAjuste(entrada: EntradaAjuste): Resultado<DatosAjuste> {
  const fecha = limpiar(entrada.fecha);
  if (!esFechaValida(fecha)) return { error: "La fecha no es válida." };
  const tipo = limpiar(entrada.tipo);
  if (tipo !== "ingreso" && tipo !== "egreso") return { error: "El ajuste tiene que ser un ingreso o un egreso." };
  const importe = parsearImporte(entrada.importe);
  if (importe === null || importe <= 0) return { error: "El importe tiene que ser mayor que cero." };
  if (importe > IMPORTE_TOPE) return { error: "El importe no puede superar $ 999.999.999.999,99." };
  if (Math.abs(aCentavos(importe) / 100 - importe) > 1e-9) return { error: "El importe admite hasta 2 decimales." };
  const concepto = limpiar(entrada.concepto);
  if (concepto === null) return { error: "El concepto es obligatorio." };
  return { datos: { fecha, tipo, importe, concepto, observacion: limpiar(entrada.observacion) } };
}

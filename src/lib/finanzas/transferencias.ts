// Transferencias entre cuentas de fondos propias: validación pura del
// formulario (repite los checks de `transferencia_fondos` para devolver un
// mensaje claro antes de ir a la base), el selector de la cuenta destino y
// el enlace a la otra cuenta desde un movimiento.

import { esFechaValida } from "@/lib/comprobantes/validacion";
import type { CuentaElegible } from "@/lib/finanzas/medios";
import { PANTALLA_CUENTAS } from "@/lib/finanzas/cuentas";
import type { TipoCuentaFondos } from "@/lib/tipos";
import { validarImporte } from "./ajustes";

/** Lo que llega del formulario, todo como texto. La cuenta origen es la de la pantalla. */
export type EntradaTransferencia = {
  fecha: string | null;
  cuenta_destino_id: string | null;
  importe: string | null;
  concepto: string | null;
  observacion: string | null;
};

/** Columnas de `transferencia_fondos` que se cargan al registrarla. */
export type DatosTransferencia = {
  fecha: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  importe: number;
  concepto: string | null;
  observacion: string | null;
};

type Resultado<T> = { datos: T } | { error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limpiar(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
}

export function validarTransferencia(
  cuentaOrigenId: string,
  entrada: EntradaTransferencia,
): Resultado<DatosTransferencia> {
  const fecha = limpiar(entrada.fecha);
  if (!esFechaValida(fecha)) return { error: "La fecha no es válida." };
  const destino = limpiar(entrada.cuenta_destino_id);
  if (destino === null || !UUID.test(destino)) return { error: "Elegí la cuenta destino." };
  if (destino.toLowerCase() === cuentaOrigenId.toLowerCase()) {
    return { error: "La cuenta destino tiene que ser distinta de la de origen." };
  }
  const importe = validarImporte(entrada.importe);
  if (typeof importe === "string") return { error: importe };
  return {
    datos: {
      fecha,
      cuenta_origen_id: cuentaOrigenId,
      cuenta_destino_id: destino,
      importe,
      concepto: limpiar(entrada.concepto),
      observacion: limpiar(entrada.observacion),
    },
  };
}

export type GrupoCuentas<T extends CuentaElegible> = { etiqueta: string; cuentas: T[] };

/** Cuentas destino posibles (todas menos la origen), agrupadas: bancos y después cajas, sin grupos vacíos. */
export function gruposCuentasDestino<T extends CuentaElegible>(
  cuentas: readonly T[],
  cuentaOrigenId: string,
): GrupoCuentas<T>[] {
  const otras = cuentas.filter((c) => c.id !== cuentaOrigenId);
  return [
    { etiqueta: "Bancos", cuentas: otras.filter((c) => c.tipo === "banco") },
    { etiqueta: "Cajas", cuentas: otras.filter((c) => c.tipo === "caja") },
  ].filter((g) => g.cuentas.length > 0);
}

/** Transferencia con el tipo de sus dos cuentas, para enlazar a la otra. */
export type TransferenciaConCuentas = {
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  origen: { tipo: TipoCuentaFondos } | null;
  destino: { tipo: TipoCuentaFondos } | null;
};

/** Página de la otra cuenta de la transferencia, vista desde `cuentaId`; null si no se sabe su tipo. */
export function cuentaDeTransferencia(transferencia: TransferenciaConCuentas, cuentaId: string): string | null {
  const desdeOrigen = transferencia.cuenta_origen_id === cuentaId;
  const otraId = desdeOrigen ? transferencia.cuenta_destino_id : transferencia.cuenta_origen_id;
  const otra = desdeOrigen ? transferencia.destino : transferencia.origen;
  if (!otra) return null;
  return `${PANTALLA_CUENTAS[otra.tipo].ruta}/${otraId}`;
}

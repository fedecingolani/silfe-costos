import type { LetraComprobante } from "@/lib/tipos";

/** Número para mostrar e imprimir: A-00007-00000361. */
export function formatearNumero(letra: LetraComprobante, puntoVenta: number, numero: number): string {
  return `${letra}-${String(puntoVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

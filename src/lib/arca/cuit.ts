/**
 * CUIT del emisor de ARCA. Reutiliza el control de dígito verificador de los
 * clientes (módulo 11, pesos 5,4,3,2,7,6,5,4,3,2), pero acá la CUIT es
 * obligatoria y se guarda siempre como 11 dígitos sin separadores.
 */
import { validarCuit } from "@/lib/clientes/validaciones";

/** Saca guiones y espacios: "23-33477122-9" → "23334771229". */
export function normalizarCuit(valor: string): string {
  return valor.replace(/[\s-]/g, "");
}

/** true si son 11 dígitos con el verificador correcto. Vacía no es válida. */
export function esCuitValida(valor: string): boolean {
  const limpio = normalizarCuit(valor);
  if (!/^\d{11}$/.test(limpio)) return false;
  return validarCuit(limpio).valido;
}

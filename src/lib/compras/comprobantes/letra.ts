/**
 * Letra de un comprobante de compra. A y M discriminan IVA; B y C no (el
 * precio lo incluye y todo va a no gravado, salvo lo exento).
 */
import type { CondicionIva, LetraCompra } from "@/lib/tipos";

/**
 * Letra que suele emitir un proveedor según su condición frente al IVA (la
 * empresa es responsable inscripta): un responsable inscripto factura A; un
 * monotributista o un exento, C; cualquier otro caso, B. Es una sugerencia:
 * el usuario la puede cambiar.
 */
export function letraSugerida(condicion: CondicionIva | null | undefined): LetraCompra {
  if (condicion === "Responsable Inscripto") return "A";
  if (condicion === "Monotributista" || condicion === "Exento") return "C";
  return "B";
}

export function discriminaIva(letra: LetraCompra): boolean {
  return letra === "A" || letra === "M";
}

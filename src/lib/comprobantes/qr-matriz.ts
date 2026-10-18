/**
 * Matriz de módulos del QR de ARCA. Usa qrcode-generator (JS puro, sin
 * canvas ni dependencias nativas, funciona en el Worker); el PDF dibuja los
 * módulos oscuros como rectángulos vectoriales.
 */
import qrcode from "qrcode-generator";

/** Margen blanco alrededor del QR, en módulos (la especificación pide 4). */
export const ZONA_SILENCIO = 4;

/**
 * Módulos del QR: true = oscuro. Corrección de errores M y versión
 * automática (la más chica en la que entra el texto).
 */
export function matrizQr(texto: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(texto, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, fila) => Array.from({ length: n }, (_, columna) => qr.isDark(fila, columna)));
}

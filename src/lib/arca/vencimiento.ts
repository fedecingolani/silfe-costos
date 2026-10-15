/** Estado del certificado de ARCA según su vencimiento, para avisar con tiempo en la pantalla. */

export type EstadoVencimiento = "vigente" | "por-vencer" | "vencido";

/** Se avisa cuando faltan 30 días o menos para que venza. */
export const AVISO_VENCIMIENTO_MS = 30 * 24 * 60 * 60_000;

export function estadoVencimiento(vence: Date | string, ahora: Date): EstadoVencimiento {
  const restante = new Date(vence).getTime() - ahora.getTime();
  if (restante <= 0) return "vencido";
  if (restante <= AVISO_VENCIMIENTO_MS) return "por-vencer";
  return "vigente";
}

/**
 * Cuándo pedir un ticket de acceso nuevo a WSAA. Firmar es caro y WSAA
 * rechaza un login nuevo mientras haya un ticket vigente, así que:
 * - si el ticket guardado vence en más de MARGEN_TICKET_MS, se reutiliza;
 * - si otro pedido tomó el bloqueo y todavía no venció, se espera;
 * - si no, se toma el bloqueo (BLOQUEO_TICKET_MS) y se pide uno nuevo.
 */

export type DecisionTicket = "reutilizar" | "esperar" | "solicitar";

/** Un ticket que vence en 5 minutos o menos ya no se reutiliza. */
export const MARGEN_TICKET_MS = 5 * 60_000;

/** Duración del bloqueo mientras se pide un ticket nuevo. */
export const BLOQUEO_TICKET_MS = 60_000;

type Fecha = Date | string | null;

function ms(valor: Fecha): number | null {
  if (valor === null) return null;
  const t = new Date(valor).getTime();
  return Number.isNaN(t) ? null : t;
}

export function decidirTicket(
  estado: { taExpira: Fecha; taBloqueadoHasta: Fecha },
  ahora: Date,
): DecisionTicket {
  const actual = ahora.getTime();
  const expira = ms(estado.taExpira);
  if (expira !== null && expira - actual > MARGEN_TICKET_MS) return "reutilizar";
  const bloqueo = ms(estado.taBloqueadoHasta);
  if (bloqueo !== null && bloqueo > actual) return "esperar";
  return "solicitar";
}

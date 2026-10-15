/**
 * Lee el secreto ARCA_CLAVE_CIFRADO (32 bytes en base64) que cifra la clave
 * privada y el ticket de acceso. Sólo para el servidor.
 *
 * - En el Worker (producción y `npm run preview`) es un secreto cargado con
 *   `wrangler secret put ARCA_CLAVE_CIFRADO`. OpenNext lo expone en
 *   getCloudflareContext().env y además lo copia a process.env.
 * - En `next dev`, initOpenNextCloudflareForDev (next.config.ts) lee
 *   `.dev.vars` y lo deja en getCloudflareContext().env; Next no lo pone en
 *   process.env. process.env queda como respaldo (p. ej. si se define en
 *   `.env.local`).
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const NOMBRE_SECRETO = "ARCA_CLAVE_CIFRADO";

export const MENSAJE_SIN_SECRETO =
  "Falta configurar el secreto ARCA_CLAVE_CIFRADO en el servidor. Sin él no se pueden guardar ni usar " +
  "las credenciales de ARCA. En local va en .dev.vars; en producción, con `wrangler secret put ARCA_CLAVE_CIFRADO`.";

/** El secreto, o null si no está configurado. */
export function leerClaveCifrado(): string | null {
  let valor: unknown;
  try {
    valor = (getCloudflareContext().env as Record<string, unknown>)[NOMBRE_SECRETO];
  } catch {
    // Fuera de un pedido (o sin el contexto de Cloudflare) se usa process.env.
  }
  if (typeof valor !== "string" || valor.trim() === "") valor = process.env[NOMBRE_SECRETO];
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

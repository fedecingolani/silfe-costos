/**
 * Claves de API de las integraciones (Factura Digital). Ver
 * odd/tasks/api-compras.md y 20261106000005_api_compras_esquema.sql.
 *
 * Una clave es `chg_` + 32 bytes aleatorios en base64url (43 caracteres).
 * En la base se guarda sólo su SHA-256 en hexadecimal y un prefijo visible;
 * alcanza SHA-256 (sin sal ni derivación lenta) porque la clave es
 * aleatoria, no una contraseña. Usa Web Crypto: corre igual en el Worker de
 * Cloudflare, en Node y en los tests.
 */

export const PREFIJO_CLAVE = "chg_";
const BYTES_CLAVE = 32;
const LARGO_PREFIJO_VISIBLE = 12;
const FORMATO_CLAVE = /^chg_[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Una clave nueva. Se muestra completa una sola vez: después sólo queda el hash. */
export function generarClave(): string {
  const bytes = new Uint8Array(BYTES_CLAVE);
  crypto.getRandomValues(bytes);
  return PREFIJO_CLAVE + base64url(bytes);
}

/** Si tiene la forma de una clave generada (sin consultar la base). */
export function esFormatoClave(valor: string): boolean {
  return FORMATO_CLAVE.test(valor);
}

/** SHA-256 de la clave en hexadecimal (64 caracteres), como api_clave.hash. */
export async function hashClave(clave: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clave));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Los primeros caracteres de la clave, para reconocerla en la pantalla (api_clave.prefijo). */
export function prefijoClave(clave: string): string {
  return clave.slice(0, LARGO_PREFIJO_VISIBLE);
}

/** La clave de `Authorization: Bearer <clave>`, o null si no viene así. */
export function leerBearer(encabezado: string | null): string | null {
  const coincidencia = /^Bearer\s+(\S+)\s*$/i.exec(encabezado ?? "");
  return coincidencia ? coincidencia[1] : null;
}

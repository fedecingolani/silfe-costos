/**
 * Cifrado de la clave privada y del ticket de acceso de ARCA antes de
 * guardarlos en la base. AES-256-GCM con WebCrypto (disponible en Node y en
 * Cloudflare Workers). La clave de cifrado es el secreto del Worker
 * ARCA_CLAVE_CIFRADO (32 bytes en base64); se recibe como parámetro, este
 * módulo no lee variables de entorno.
 *
 * Formato: "v1.<iv en base64>.<texto cifrado + tag en base64>", con un IV
 * aleatorio de 12 bytes por cada cifrado.
 */

const VERSION = "v1";
const LARGO_IV = 12;
const LARGO_CLAVE = 32;

function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function importarClave(claveBase64: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = deBase64(claveBase64);
  } catch {
    bytes = new Uint8Array();
  }
  if (bytes.length !== LARGO_CLAVE) {
    throw new Error(
      `La clave de cifrado (ARCA_CLAVE_CIFRADO) tiene que ser de 32 bytes en base64; tiene ${bytes.length}.`,
    );
  }
  return globalThis.crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function cifrar(texto: string, claveBase64: string): Promise<string> {
  const clave = await importarClave(claveBase64);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(LARGO_IV));
  const cifrado = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    clave,
    new TextEncoder().encode(texto),
  );
  return `${VERSION}.${aBase64(iv)}.${aBase64(new Uint8Array(cifrado))}`;
}

export async function descifrar(cifrado: string, claveBase64: string): Promise<string> {
  const clave = await importarClave(claveBase64);
  const partes = cifrado.split(".");
  if (partes.length !== 3 || partes[0] !== VERSION) {
    throw new Error("El texto cifrado no tiene el formato esperado (v1.<iv>.<datos>).");
  }
  try {
    const claro = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deBase64(partes[1]) },
      clave,
      deBase64(partes[2]),
    );
    return new TextDecoder().decode(claro);
  } catch {
    throw new Error(
      "No se pudo descifrar: la clave ARCA_CLAVE_CIFRADO no es la que se usó para cifrar o el dato está dañado.",
    );
  }
}

/** Genera una clave nueva para ARCA_CLAVE_CIFRADO (32 bytes aleatorios en base64). */
export function generarClaveCifrado(): string {
  return aBase64(globalThis.crypto.getRandomValues(new Uint8Array(LARGO_CLAVE)));
}

// Validación pura de los datos de Configuración → Empresa. Repite los checks
// de la tabla `empresa` para devolver un mensaje claro antes de ir a la base.

export type TipoLogo = "image/png" | "image/jpeg";

/** Campos de texto editables de `empresa`. null = vacío. */
export type DatosEmpresa = {
  nombre_fantasia: string | null;
  color_marca: string | null;
  telefono: string | null;
  email: string | null;
  web: string | null;
};

/** Tope del archivo del logo. Su base64 (≈ 699 KB) entra en el check de la base (700000). */
export const TAMANO_MAXIMO_LOGO = 512 * 1024;

const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function esColorHex(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && COLOR_HEX.test(valor);
}

function limpiar(valor: string | null): string | null {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
}

export function validarDatosEmpresa(entrada: DatosEmpresa): { datos: DatosEmpresa } | { error: string } {
  const nombre = limpiar(entrada.nombre_fantasia);
  if (nombre !== null && nombre.length > 80) {
    return { error: "El nombre de fantasía puede tener hasta 80 caracteres." };
  }
  const color = limpiar(entrada.color_marca);
  if (color !== null && !esColorHex(color)) {
    return { error: "El color de marca tiene que ser un hex de 6 dígitos, como #4a7a58." };
  }
  const telefono = limpiar(entrada.telefono);
  if (telefono !== null && telefono.length > 40) {
    return { error: "El teléfono puede tener hasta 40 caracteres." };
  }
  const email = limpiar(entrada.email);
  if (email !== null && (!EMAIL.test(email) || email.length > 254)) {
    return { error: "El email no es válido." };
  }
  const web = limpiar(entrada.web);
  if (web !== null && web.length > 200) {
    return { error: "La web puede tener hasta 200 caracteres." };
  }
  return {
    datos: {
      nombre_fantasia: nombre,
      color_marca: color === null ? null : color.toLowerCase(),
      telefono,
      email,
      web,
    },
  };
}

/** Tipo de la imagen según sus primeros bytes (no según el nombre ni el MIME declarado). */
export function tipoDeImagen(bytes: Uint8Array): TipoLogo | null {
  const firmaPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= firmaPng.length && firmaPng.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export function validarLogo(bytes: Uint8Array): { tipo: TipoLogo; base64: string } | { error: string } {
  if (bytes.length > TAMANO_MAXIMO_LOGO) return { error: "El logo pesa más de 512 KB: achicalo y volvé a subirlo." };
  const tipo = tipoDeImagen(bytes);
  if (!tipo) return { error: "El logo tiene que ser una imagen PNG o JPEG." };
  return { tipo, base64: aBase64(bytes) };
}

export function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

export function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

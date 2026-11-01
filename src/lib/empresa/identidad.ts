import type { CSSProperties } from "react";
import { esColorHex } from "./validacion";

/** Lo que el menú necesita de la empresa: sin el logo en sí, que se sirve aparte. */
export type IdentidadEmpresa = {
  /** Nombre de fantasía, o la razón social de ARCA; null si no hay ninguno. */
  nombre: string | null;
  /** Color de marca validado (#rrggbb) o null para el verde por defecto. */
  color: string | null;
  /** URL versionada del logo, o null si no hay logo cargado. */
  logo: string | null;
};

/** Nombre que se muestra: el de fantasía y, si falta, la razón social. */
export function nombreVisible(nombreFantasia: string | null, razonSocial: string | null): string | null {
  return nombreFantasia?.trim() || razonSocial?.trim() || null;
}

/**
 * Estilo que reemplaza el color base de la escala `marca-*` (ver globals.css).
 * Sólo con un hex válido: nunca se interpola en el estilo un texto sin validar.
 */
export function estiloMarca(color: string | null): CSSProperties | undefined {
  if (!esColorHex(color)) return undefined;
  return { "--marca-base": color } as CSSProperties;
}

/** URL del logo; cambia con cada actualización de `empresa`, así el navegador puede guardarlo sin vencimiento. */
export function urlLogo(actualizadoEn: string): string {
  return `/empresa/logo?v=${encodeURIComponent(actualizadoEn)}`;
}

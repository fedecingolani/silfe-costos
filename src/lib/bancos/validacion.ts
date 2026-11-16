// Validación pura del formulario de un banco (Configuración → Bancos).
// Repite los checks de `banco` para devolver un mensaje claro antes de ir a
// la base.

export const LARGO_MAXIMO_NOMBRE_BANCO = 80;

/** Lo que llega del formulario. */
export type EntradaBanco = { nombre: string | null; activo: boolean };

/** Columnas editables de `banco`. */
export type DatosBanco = { nombre: string; activo: boolean };

type Resultado<T> = { datos: T } | { error: string };

/** Nombre sin espacios en los extremos y con los espacios internos colapsados. */
function limpiarNombre(valor: string | null): string {
  return (valor ?? "").trim().replace(/\s+/g, " ");
}

export function validarBanco(entrada: EntradaBanco): Resultado<DatosBanco> {
  const nombre = limpiarNombre(entrada.nombre);
  if (nombre === "") return { error: "El nombre del banco es obligatorio." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE_BANCO) {
    return { error: `El nombre del banco puede tener hasta ${LARGO_MAXIMO_NOMBRE_BANCO} caracteres.` };
  }
  return { datos: { nombre, activo: entrada.activo } };
}

/**
 * Clave de comparación de un nombre de banco: sin tildes, en minúsculas y con
 * los espacios colapsados. Es la misma expresión del índice único
 * banco_nombre_clave_uq (20261114000002_bancos.sql); sirve para buscar.
 */
export function claveBanco(nombre: string): string {
  return limpiarNombre(nombre)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

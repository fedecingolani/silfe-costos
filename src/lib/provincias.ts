/** Jurisdicciones de ingresos brutos: las 23 provincias y la Ciudad Autónoma de Buenos Aires. */
export const PROVINCIAS = [
  "Buenos Aires",
  "Ciudad Autónoma de Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
] as const;

export type Provincia = (typeof PROVINCIAS)[number];

/** Minúsculas, sin tildes y con los espacios colapsados, para comparar nombres. */
function clave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombres usuales que no coinciden con el de la lista. */
const ALIAS: Record<string, Provincia> = {
  caba: "Ciudad Autónoma de Buenos Aires",
  "capital federal": "Ciudad Autónoma de Buenos Aires",
};

const POR_CLAVE = new Map<string, Provincia>([
  ...PROVINCIAS.map((p) => [clave(p), p] as const),
  ...Object.entries(ALIAS),
]);

/**
 * Nombre de la lista que corresponde al valor, sin importar mayúsculas,
 * tildes ni espacios; null si no coincide con ninguno.
 */
export function normalizarProvincia(valor: string | null): Provincia | null {
  if (valor === null) return null;
  return POR_CLAVE.get(clave(valor)) ?? null;
}

/** true si el valor es uno de la lista (escrito igual). */
export function esProvincia(valor: string): valor is Provincia {
  return (PROVINCIAS as readonly string[]).includes(valor);
}

/**
 * Se puede guardar una provincia vacía o de la lista. Un valor fuera de la
 * lista sólo se admite si es el que ya estaba guardado (dato anterior a la
 * lista), para no perderlo al editar otros campos.
 */
export function provinciaAdmitida(valor: string | null, actual: string | null): boolean {
  return valor === null || esProvincia(valor) || valor === actual;
}

/**
 * Filtros del listado de clientes, armados a partir de los parámetros de la
 * URL y aplicados del lado del servidor con Supabase.
 */

/** Escapa los comodines de LIKE (% y _) y la barra invertida. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Valor entre comillas para un filtro `or` de PostgREST (protege comas y paréntesis). */
function entreComillas(texto: string): string {
  return `"${texto.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * Filtro `or` de PostgREST para buscar `texto` en la razón social y el CUIT
 * (contiene, sin distinguir mayúsculas) y, si es un número entero, también
 * por código legado exacto. null si no hay nada que buscar.
 *
 * El asterisco se descarta porque PostgREST lo toma como comodín de LIKE.
 */
export function filtroBusquedaClientes(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").replace(/\*/g, "").trim();
  if (limpio === "") return null;
  const patron = entreComillas(`%${escaparLike(limpio)}%`);
  const filtros = [`razon_social.ilike.${patron}`, `cuit.ilike.${patron}`];
  if (/^\d{1,9}$/.test(limpio)) filtros.push(`codigo_legado.eq.${Number(limpio)}`);
  return filtros.join(",");
}

export type ValorFiltroActivo = "activos" | "inactivos" | "todos";

/** Filtro de estado del listado: por defecto, sólo los activos. */
export function filtroActivo(valor: string | null | undefined): {
  valor: ValorFiltroActivo;
  activo: boolean | null;
} {
  if (valor === "inactivos") return { valor, activo: false };
  if (valor === "todos") return { valor, activo: null };
  return { valor: "activos", activo: true };
}

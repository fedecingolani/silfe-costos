import type { SupabaseClient } from "@supabase/supabase-js";

/** Nombres de los bancos activos, para los selectores. Devuelve el mensaje si falla. */
export async function cargarBancosActivos(supabase: SupabaseClient): Promise<string[] | string> {
  const { data, error } = await supabase.from("banco").select("nombre").eq("activo", true).order("nombre");
  if (error) return `Error al cargar los bancos: ${error.message}`;
  return (data ?? []).map((b: { nombre: string }) => b.nombre);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aTexto } from "@/lib/formato";
import { productosEnviados, validarItems } from "@/lib/listas-precios/items";

export type EstadoFormularioLista = { error?: string } | undefined;

export async function crearListaPrecio(
  _estado: EstadoFormularioLista,
  formData: FormData,
): Promise<EstadoFormularioLista> {
  const nombre = aTexto(formData.get("nombre"));
  if (!nombre) return { error: "La lista necesita un nombre." };

  let crudo: unknown;
  try {
    crudo = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los ítems de la lista." };
  }

  const supabase = await createClient();

  // Costos incompletos actuales de los productos del envío. Se lee la vista
  // entera (es la misma que precarga el editor) para no armar un filtro con
  // cientos de ids en la URL. Un producto que ya no está en la vista
  // (inactivo) también exige un precio mayor a 0: su sugerido no es actual.
  const ids = productosEnviados(crudo);
  const costosIncompletos = new Set<string>();
  if (ids.length > 0) {
    const { data: base, error: errorBase } = await supabase
      .from("v_lista_precio_base")
      .select("producto_id, costos_incompletos");
    if (errorBase) return { error: `No se pudieron verificar los costos de los productos: ${errorBase.message}` };
    const estado = new Map<string, boolean>();
    for (const fila of (base ?? []) as { producto_id: string; costos_incompletos: boolean }[]) {
      estado.set(fila.producto_id, (estado.get(fila.producto_id) ?? false) || fila.costos_incompletos);
    }
    for (const id of ids) {
      if (estado.get(id) ?? true) costosIncompletos.add(id);
    }
  }

  const validacion = validarItems(crudo, costosIncompletos);
  if ("errores" in validacion) return { error: validacion.errores.join(" ") };

  const { data, error } = await supabase.rpc("crear_lista_precio", {
    p_nombre: nombre,
    p_titulo: aTexto(formData.get("titulo")),
    p_notas: aTexto(formData.get("notas")),
    p_items: validacion.items,
  });
  if (error) {
    // 23503: un producto del envío se borró mientras se editaba la lista.
    if (error.code === "23503") return { error: "Algún producto de la lista ya no existe; recargá la página." };
    return { error: `No se pudo guardar la lista: ${error.message}` };
  }

  revalidatePath("/listas-precios");
  redirect(`/listas-precios/${data as string}`);
}

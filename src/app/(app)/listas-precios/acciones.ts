"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";

export type EstadoFormularioLista = { error?: string } | undefined;

/** Ítem tal como lo manda el editor, en el orden de la pantalla. */
export type ItemListaEnviado = {
  es_repuesto: boolean;
  producto_id: string | null;
  codigo: string;
  descripcion: string;
  presentacion: string;
  alicuota_iva: string;
  precio_sugerido: number | null;
  precio_final: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** Valida los ítems y arma el arreglo para crear_lista_precio, con orden 1..n explícito. */
function armarItems(crudo: unknown): { items?: Record<string, unknown>[]; error?: string } {
  if (!Array.isArray(crudo) || crudo.length === 0) {
    return { error: "La lista necesita al menos un ítem." };
  }

  const items: Record<string, unknown>[] = [];
  for (const [i, valor] of crudo.entries()) {
    const posicion = i + 1;
    if (typeof valor !== "object" || valor === null) {
      return { error: `El ítem ${posicion} no es válido.` };
    }
    const item = valor as Partial<Record<keyof ItemListaEnviado, unknown>>;

    const descripcion = aTexto(texto(item.descripcion));
    if (!descripcion) return { error: `El ítem ${posicion} necesita una descripción.` };

    const precioFinal = aNumero(texto(item.precio_final));
    if (precioFinal === null || precioFinal < 0) {
      return { error: `El ítem ${posicion} (${descripcion}) necesita un precio final mayor o igual a 0.` };
    }

    const iva = aNumero(texto(item.alicuota_iva), 21);
    if (iva === null || iva < 0 || iva > 100) {
      return { error: `El IVA del ítem ${posicion} (${descripcion}) tiene que estar entre 0 y 100.` };
    }

    const productoId = typeof item.producto_id === "string" && UUID.test(item.producto_id) ? item.producto_id : null;
    const precioSugerido =
      typeof item.precio_sugerido === "number" && Number.isFinite(item.precio_sugerido)
        ? item.precio_sugerido
        : null;

    items.push({
      orden: posicion,
      es_repuesto: item.es_repuesto === true,
      producto_id: productoId,
      codigo: aTexto(texto(item.codigo)),
      descripcion,
      presentacion: aTexto(texto(item.presentacion)),
      alicuota_iva: iva,
      precio_sugerido: productoId ? precioSugerido : null,
      precio_final: precioFinal,
    });
  }
  return { items };
}

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

  const { items, error: errorItems } = armarItems(crudo);
  if (errorItems || !items) return { error: errorItems };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crear_lista_precio", {
    p_nombre: nombre,
    p_titulo: aTexto(formData.get("titulo")),
    p_notas: aTexto(formData.get("notas")),
    p_items: items,
  });
  if (error) return { error: `No se pudo guardar la lista: ${error.message}` };

  revalidatePath("/listas-precios");
  redirect(`/listas-precios/${data as string}`);
}

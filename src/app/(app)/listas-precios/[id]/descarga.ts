import { createClient } from "@/lib/supabase/server";
import type { DatosListaDescarga } from "@/lib/listas-precios/tipos";
import { dispositionAdjunto } from "@/lib/listas-precios/nombre-archivo";
import type { ListaPrecio, ListaPrecioItem, ParametroCosteo } from "@/lib/tipos";

type Resultado =
  | { ok: true; nombre: string; datos: DatosListaDescarga }
  | { ok: false; respuesta: Response };

function error(mensaje: string, status: number): Resultado {
  return {
    ok: false,
    respuesta: new Response(mensaje, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

/** Logo de public/. Si no se puede traer, la lista sale sin logo. */
async function cargarLogo(request: Request): Promise<Uint8Array | null> {
  try {
    const respuesta = await fetch(new URL("/logo-silfe.png", request.url));
    if (!respuesta.ok) return null;
    return new Uint8Array(await respuesta.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Carga la lista, sus ítems en orden y el pie configurado. Corre con la
 * sesión del usuario (el middleware ya exige sesión en las rutas de la app).
 */
export async function cargarDatosDescarga(
  id: string,
  request: Request,
  conLogo: boolean,
): Promise<Resultado> {
  const supabase = await createClient();

  const [lista, items, parametros, logo] = await Promise.all([
    supabase.from("lista_precio").select("*").eq("id", id).maybeSingle(),
    supabase.from("lista_precio_item").select("*").eq("lista_id", id).order("orden"),
    supabase.from("parametro_costeo").select("*").maybeSingle(),
    conLogo ? cargarLogo(request) : Promise.resolve(null),
  ]);

  if (lista.error) return error(`Error al cargar la lista: ${lista.error.message}`, 500);
  if (!lista.data) return error("La lista de precios no existe.", 404);
  if (items.error) return error(`Error al cargar los ítems de la lista: ${items.error.message}`, 500);
  if (parametros.error) return error(`Error al cargar los parámetros: ${parametros.error.message}`, 500);

  const datosLista = lista.data as ListaPrecio;
  const p = parametros.data as ParametroCosteo | null;

  return {
    ok: true,
    nombre: datosLista.nombre,
    datos: {
      titulo: datosLista.titulo ?? datosLista.nombre,
      items: (items.data ?? []) as ListaPrecioItem[],
      textoDestacado: p?.lista_texto_destacado ?? null,
      contacto: p?.lista_contacto ?? null,
      logo,
    },
  };
}

/** Respuesta de descarga del archivo generado. */
export function respuestaArchivo(
  bytes: Uint8Array,
  nombre: string,
  extension: "pdf" | "xlsx",
  tipo: string,
): Response {
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: tipo }), {
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": dispositionAdjunto(nombre, extension),
      "Cache-Control": "private, no-store",
    },
  });
}

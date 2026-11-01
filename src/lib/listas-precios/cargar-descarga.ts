import type { SupabaseClient } from "@supabase/supabase-js";
import { leerLogoEmpresa } from "@/lib/empresa/logo";
import type { ListaPrecio, ListaPrecioItem, ParametroCosteo } from "@/lib/tipos";
import { dispositionAdjunto } from "./nombre-archivo";
import type { DatosListaDescarga } from "./tipos";
import { esUuid } from "./uuid";

export type ResultadoDescarga =
  | { ok: true; nombre: string; datos: DatosListaDescarga }
  | { ok: false; respuesta: Response };

export type OpcionesDescarga = {
  id: string;
  /** URL del pedido. Sin uso desde que el logo se lee de la base; se quita junto con su llamador. */
  url?: string;
  conLogo: boolean;
  /** Cliente de Supabase con la sesión del usuario. */
  cliente: SupabaseClient;
};

function respuestaError(mensaje: string, status: number): ResultadoDescarga {
  return {
    ok: false,
    respuesta: new Response(mensaje, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

/**
 * Carga la lista, sus ítems en orden y el pie configurado. Un id que no es
 * un uuid da 404 sin consultar. El logo se lee de `empresa` en paralelo con
 * las consultas; si falla, la lista sale sin logo.
 */
export async function cargarDatosDescarga({
  id,
  conLogo,
  cliente,
}: OpcionesDescarga): Promise<ResultadoDescarga> {
  if (!esUuid(id)) return respuestaError("La lista de precios no existe.", 404);

  const logo = conLogo ? leerLogoEmpresa(cliente).then((l) => l?.bytes ?? null) : Promise.resolve(null);

  const [lista, items, parametros] = await Promise.all([
    cliente.from("lista_precio").select("*").eq("id", id).maybeSingle(),
    cliente.from("lista_precio_item").select("*").eq("lista_id", id).order("orden"),
    cliente.from("parametro_costeo").select("*").maybeSingle(),
  ]);

  if (lista.error) return respuestaError(`Error al cargar la lista: ${lista.error.message}`, 500);
  if (!lista.data) return respuestaError("La lista de precios no existe.", 404);
  if (items.error) return respuestaError(`Error al cargar los ítems de la lista: ${items.error.message}`, 500);
  if (parametros.error) return respuestaError(`Error al cargar los parámetros: ${parametros.error.message}`, 500);

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
      logo: await logo,
      creadoEn: datosLista.creado_en,
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

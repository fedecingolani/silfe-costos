import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import type { ListaPrecio, ListaPrecioBase, ListaPrecioItem } from "@/lib/tipos";
import { filasDeDuplicado, type BaseActual } from "@/lib/listas-precios/duplicar";
import { esUuid } from "@/lib/listas-precios/uuid";
import { EditorLista, type DatosIniciales, type FilaEditor } from "./EditorLista";

export const dynamic = "force-dynamic";

/** Título por defecto con el mes y el año actuales: "LISTA DE PRECIOS OCTUBRE 2026". */
function tituloDelMes() {
  const mesAnio = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  return `LISTA DE PRECIOS ${mesAnio.replace(/\s+de\s+/i, " ")}`.toUpperCase();
}

function textoPrecio(valor: number | null) {
  return valor === null ? "" : String(valor);
}

export default async function NuevaListaPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string }>;
}) {
  const { desde } = await searchParams;
  const supabase = await createClient();

  let iniciales: DatosIniciales;
  let origen: ListaPrecio | null = null;

  if (desde) {
    if (!esUuid(desde)) notFound();
    const [
      { data: lista, error: errorLista },
      { data: itemsData, error: errorItems },
      { data: baseData, error: errorBase },
    ] = await Promise.all([
      supabase.from("lista_precio").select("*").eq("id", desde).maybeSingle(),
      supabase.from("lista_precio_item").select("*").eq("lista_id", desde).order("orden"),
      supabase.from("v_lista_precio_base").select("producto_id, precio_sugerido, costos_incompletos"),
    ]);
    // Un error de la consulta se muestra; sólo la ausencia de la fila es un 404.
    if (errorLista) {
      return <p className="text-sm text-red-700">Error al cargar la lista: {errorLista.message}</p>;
    }
    if (!lista) notFound();
    if (errorItems) {
      return <p className="text-sm text-red-700">Error al cargar los ítems de la lista: {errorItems.message}</p>;
    }
    if (errorBase) {
      return <p className="text-sm text-red-700">Error al cargar los precios actuales: {errorBase.message}</p>;
    }
    origen = lista as ListaPrecio;
    iniciales = {
      nombre: `Copia de ${origen.nombre}`,
      titulo: origen.titulo ?? "",
      notas: origen.notas ?? "",
      // Conserva descripción, orden y precio final; el sugerido y los costos
      // incompletos son los actuales de cada producto.
      filas: filasDeDuplicado((itemsData ?? []) as ListaPrecioItem[], (baseData ?? []) as BaseActual[]),
    };
  } else {
    const { data, error } = await supabase.from("v_lista_precio_base").select("*").order("orden");
    if (error) {
      return <p className="text-sm text-red-700">Error al cargar los productos: {error.message}</p>;
    }
    const base = (data ?? []) as ListaPrecioBase[];
    iniciales = {
      nombre: "",
      titulo: tituloDelMes(),
      notas: "",
      filas: base.map(
        (b): FilaEditor => ({
          // Un subgrupo puede repetirse debajo de varios productos: la clave lleva el orden.
          clave: `${b.orden}-${b.producto_id}`,
          es_repuesto: b.es_repuesto,
          producto_id: b.producto_id,
          codigo: b.codigo,
          descripcion: b.descripcion,
          presentacion: b.presentacion ?? "",
          alicuota_iva: String(b.alicuota_iva),
          precio_sugerido: b.precio_sugerido,
          // Con costos incompletos el sugerido no es confiable: se exige un precio manual.
          precio_final: b.costos_incompletos ? "" : textoPrecio(b.precio_redondeado),
          costos_incompletos: b.costos_incompletos,
        }),
      ),
    };
  }

  return (
    <>
      <Migas
        items={[
          { href: "/listas-precios", texto: "Listas de precios" },
          ...(origen ? [{ href: `/listas-precios/${origen.id}`, texto: origen.nombre }] : []),
          { texto: origen ? "Duplicar" : "Nueva lista" },
        ]}
      />
      <Encabezado
        titulo={origen ? `Duplicar: ${origen.nombre}` : "Nueva lista de precios"}
        descripcion={
          origen
            ? "Lista precargada con los ítems y precios finales de la lista original, y el precio sugerido actual de cada producto. Ajustá lo que haga falta y guardala como una lista nueva."
            : "Lista precargada con todos los productos activos y sus repuestos. Ajustá precios, agregá ítems manuales, quitá o reordená lo que haga falta."
        }
      />
      <EditorLista iniciales={iniciales} />
    </>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import type { ListaPrecio } from "@/lib/tipos";

export const dynamic = "force-dynamic";

type ListaConCantidad = ListaPrecio & { lista_precio_item: { count: number }[] };

export default async function ListasPreciosPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lista_precio")
    .select("*, lista_precio_item(count)")
    .order("creado_en", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar las listas de precios: {error.message}</p>;
  }

  const listas = (data ?? []) as ListaConCantidad[];

  return (
    <>
      <Encabezado
        titulo="Listas de precios"
        descripcion="Listas guardadas, de la más nueva a la más vieja. Una lista guardada no se modifica: para corregirla, se duplica."
        acciones={
          <Link href="/listas-precios/nueva" className="boton-primario">
            + Nueva lista
          </Link>
        }
      />

      <Tarjeta titulo={`${listas.length} listas`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Creada</th>
                <th>Nombre</th>
                <th>Título</th>
                <th className="num">Ítems</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listas.length === 0 && <Vacio mensaje="Todavía no guardaste listas de precios." colSpan={5} />}
              {listas.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-stone-600">{fechaHora(l.creado_en)}</td>
                  <td>
                    <Link
                      href={`/listas-precios/${l.id}`}
                      className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                    >
                      {l.nombre}
                    </Link>
                  </td>
                  <td className="text-stone-600">{l.titulo ?? "—"}</td>
                  <td className="num">{l.lista_precio_item[0]?.count ?? 0}</td>
                  <td className="whitespace-nowrap text-right">
                    <div className="inline-flex gap-1">
                      <a href={`/listas-precios/${l.id}/pdf`} className="boton-secundario px-2 py-1 text-xs">
                        PDF
                      </a>
                      <a href={`/listas-precios/${l.id}/excel`} className="boton-secundario px-2 py-1 text-xs">
                        Excel
                      </a>
                      <Link href={`/listas-precios/${l.id}`} className="boton-secundario px-2 py-1 text-xs">
                        Ver
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas } from "@/components/ui";
import { fechaHora, numero, pesos, porcentaje } from "@/lib/formato";
import type { ListaPrecio, ListaPrecioItem } from "@/lib/tipos";

export const dynamic = "force-dynamic";

function diferencia(item: ListaPrecioItem): number | null {
  if (item.precio_sugerido === null || item.precio_sugerido <= 0) return null;
  return ((item.precio_final - item.precio_sugerido) / item.precio_sugerido) * 100;
}

export default async function ListaPrecioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: lista }, { data: itemsData, error }] = await Promise.all([
    supabase.from("lista_precio").select("*").eq("id", id).maybeSingle(),
    supabase.from("lista_precio_item").select("*").eq("lista_id", id).order("orden"),
  ]);

  if (!lista) notFound();
  if (error) {
    return <p className="text-sm text-red-700">Error al cargar los ítems de la lista: {error.message}</p>;
  }

  const datos = lista as ListaPrecio;
  const items = (itemsData ?? []) as ListaPrecioItem[];

  return (
    <>
      <Migas items={[{ href: "/listas-precios", texto: "Listas de precios" }, { texto: datos.nombre }]} />
      <Encabezado
        titulo={datos.nombre}
        descripcion={`${datos.titulo ?? "Sin título"} · Creada el ${fechaHora(datos.creado_en)}`}
        acciones={
          <Link href={`/listas-precios/nueva?desde=${datos.id}`} className="boton-primario">
            Duplicar
          </Link>
        }
      />

      <div className="space-y-4">
        {datos.notas && (
          <Tarjeta titulo="Notas">
            <p className="whitespace-pre-line px-4 py-3 text-sm text-stone-700">{datos.notas}</p>
          </Tarjeta>
        )}

        <Tarjeta
          titulo={`${items.length} ítems`}
          descripcion="Precios sin IVA. La lista es de solo lectura: para corregirla, duplicala."
        >
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Presentación</th>
                  <th className="num">IVA %</th>
                  <th className="num">Precio sugerido</th>
                  <th className="num">Precio final</th>
                  <th className="num">Dif. %</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <Vacio mensaje="La lista no tiene ítems." colSpan={8} />}
                {items.map((it, i) => {
                  const dif = diferencia(it);
                  return (
                    <tr key={it.id}>
                      <td className="text-xs text-stone-400">{i + 1}</td>
                      <td className="whitespace-nowrap text-xs text-stone-500">{it.codigo ?? "—"}</td>
                      <td>
                        <div className={`flex items-center gap-2 ${it.es_repuesto ? "pl-6" : ""}`}>
                          {it.es_repuesto && <span className="text-stone-300">↳</span>}
                          <span className={it.es_repuesto ? "text-stone-700" : "font-medium text-stone-900"}>
                            {it.descripcion}
                          </span>
                          {it.producto_id === null && <Pastilla>Manual</Pastilla>}
                        </div>
                      </td>
                      <td className="text-stone-600">{it.presentacion ?? "—"}</td>
                      <td className="num text-stone-600">{numero(it.alicuota_iva)}</td>
                      <td className="num text-stone-500">{pesos(it.precio_sugerido)}</td>
                      <td className="num font-semibold text-stone-900">{pesos(it.precio_final)}</td>
                      <td
                        className={`num ${
                          dif === null ? "text-stone-400" : dif < 0 ? "text-red-700" : "text-marca-800"
                        }`}
                      >
                        {dif === null ? "—" : `${dif > 0 ? "+" : ""}${porcentaje(dif)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}

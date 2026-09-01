import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla } from "@/components/ui";
import { pesos, minutosAHoras } from "@/lib/formato";
import type { ProductoCosto, UnidadMedida } from "@/lib/tipos";
import { crearProducto } from "./acciones";

export const dynamic = "force-dynamic";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { tipo } = await searchParams;
  const supabase = await createClient();

  const [{ data, error }, { data: unidades }] = await Promise.all([
    supabase.from("v_producto_costo").select("*").order("tipo").order("codigo"),
    supabase.from("unidad_medida").select("*").order("codigo"),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar productos: {error.message}</p>;
  }

  const todos = (data ?? []) as ProductoCosto[];
  const listaUnidades = (unidades ?? []) as UnidadMedida[];
  const filtrados = tipo ? todos.filter((p) => p.tipo === tipo) : todos;
  const terminados = todos.filter((p) => p.tipo === "TERMINADO").length;
  const subgrupos = todos.filter((p) => p.tipo === "SUBGRUPO").length;

  const filtros = [
    { valor: "", texto: `Todos (${todos.length})` },
    { valor: "TERMINADO", texto: `Terminados (${terminados})` },
    { valor: "SUBGRUPO", texto: `Subgrupos (${subgrupos})` },
  ];

  return (
    <>
      <Encabezado
        titulo="Productos"
        descripcion="Productos terminados y subgrupos reutilizables, con su costo calculado a partir de la estructura y los procesos."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem] xl:items-start">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {filtros.map((f) => (
              <Link
                key={f.valor}
                href={f.valor ? `/productos?tipo=${f.valor}` : "/productos"}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  (tipo ?? "") === f.valor
                    ? "bg-marca-600 text-white"
                    : "border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                }`}
              >
                {f.texto}
              </Link>
            ))}
          </div>

          <Tarjeta>
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th className="num">Materiales</th>
                    <th className="num">Mano de obra</th>
                    <th className="num">Tiempo</th>
                    <th className="num">Costo total</th>
                    <th className="num">Precio sugerido</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.length === 0 && <Vacio mensaje="No hay productos cargados." colSpan={7} />}
                  {filtrados.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link
                          href={`/productos/${p.id}`}
                          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                        >
                          {p.nombre}
                        </Link>
                        <div className="text-xs text-stone-400">{p.codigo}</div>
                        {!p.activo && (
                          <div className="mt-1">
                            <Pastilla>Inactivo</Pastilla>
                          </div>
                        )}
                      </td>
                      <td>
                        {p.tipo === "TERMINADO" ? (
                          <Pastilla tono="verde">Terminado</Pastilla>
                        ) : (
                          <Pastilla tono="azul">Subgrupo</Pastilla>
                        )}
                      </td>
                      <td className="num">{pesos(p.costo_materiales)}</td>
                      <td className="num">{pesos(p.costo_mano_obra)}</td>
                      <td className="num text-stone-500">{minutosAHoras(p.minutos_totales)}</td>
                      <td className="num font-semibold text-stone-900">{pesos(p.costo_total)}</td>
                      <td className="num text-marca-800">{pesos(p.precio_sugerido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        </div>

        <Tarjeta titulo="Nuevo producto">
          <form action={crearProducto} className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="etiqueta">Código *</label>
                <input name="codigo" required placeholder="PT-003" className="campo" />
              </div>
              <div className="col-span-2">
                <label className="etiqueta">Nombre *</label>
                <input name="nombre" required placeholder="Bolso recolector" className="campo" />
              </div>
            </div>
            <div>
              <label className="etiqueta">Tipo *</label>
              <select name="tipo" className="campo" defaultValue="TERMINADO">
                <option value="TERMINADO">Producto terminado (se vende)</option>
                <option value="SUBGRUPO">Subgrupo (conjunto reutilizable)</option>
              </select>
              <p className="mt-1 text-xs text-stone-500">
                Un terminado puede llevar subgrupos y materias primas sueltas. Un subgrupo lleva sólo materias
                primas.
              </p>
            </div>
            <div>
              <label className="etiqueta">Unidad</label>
              <select name="unidad_id" className="campo" defaultValue="">
                <option value="">—</option>
                {listaUnidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo} · {u.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta">Descripción</label>
              <textarea name="descripcion" rows={2} className="campo" />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <input type="checkbox" name="activo" defaultChecked className="rounded" />
              Activo
            </label>
            <button className="boton-primario w-full">Crear producto</button>
          </form>
        </Tarjeta>
      </div>
    </>
  );
}

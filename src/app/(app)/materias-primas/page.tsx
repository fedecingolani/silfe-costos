import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla } from "@/components/ui";
import { pesos, numero, porcentaje } from "@/lib/formato";
import type { MateriaPrimaCosto, Proveedor, UnidadMedida } from "@/lib/tipos";
import { crearMateriaPrima } from "./acciones";

export const dynamic = "force-dynamic";

export default async function MateriasPrimasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  const [{ data: materias, error }, { data: unidades }, { data: proveedores }] = await Promise.all([
    supabase.from("v_materia_prima_costo").select("*").order("codigo"),
    supabase.from("unidad_medida").select("*").order("codigo"),
    supabase.from("proveedor").select("*").eq("activo", true).order("nombre"),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar materias primas: {error.message}</p>;
  }

  const filtro = (q ?? "").toLowerCase().trim();
  const lista = ((materias ?? []) as MateriaPrimaCosto[]).filter(
    (m) =>
      !filtro ||
      m.nombre.toLowerCase().includes(filtro) ||
      m.codigo.toLowerCase().includes(filtro) ||
      (m.categoria ?? "").toLowerCase().includes(filtro),
  );
  const listaUnidades = (unidades ?? []) as UnidadMedida[];
  const listaProveedores = (proveedores ?? []) as Proveedor[];
  const sinPrecio = lista.filter((m) => m.precio_compra === null).length;

  return (
    <>
      <Encabezado
        titulo="Materias primas"
        descripcion="Cada material se compra en una unidad y se consume en otra. El factor de conversión traduce una en la otra."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem] xl:items-start">
        <div className="space-y-4">
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Buscar por nombre, código o categoría…"
              className="campo mt-0 max-w-sm"
            />
            <button className="boton-secundario">Buscar</button>
            {filtro && (
              <Link href="/materias-primas" className="boton-secundario">
                Limpiar
              </Link>
            )}
          </form>

          {sinPrecio > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {sinPrecio} materia{sinPrecio === 1 ? "" : "s"} prima{sinPrecio === 1 ? "" : "s"} sin precio
              cargado: los productos que las usen quedan subvaluados.
            </div>
          )}

          <Tarjeta titulo={`${lista.length} materias primas`}>
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Material</th>
                    <th>Compra</th>
                    <th className="num">Precio compra</th>
                    <th>Conversión</th>
                    <th className="num">Merma</th>
                    <th className="num">Costo por unidad de uso</th>
                    <th>Proveedor</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.length === 0 && <Vacio mensaje="No hay materias primas para mostrar." colSpan={8} />}
                  {lista.map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono text-xs text-stone-500">{m.codigo}</td>
                      <td>
                        <Link
                          href={`/materias-primas/${m.id}`}
                          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                        >
                          {m.nombre}
                        </Link>
                        {m.categoria && <div className="text-xs text-stone-400">{m.categoria}</div>}
                        {!m.activo && (
                          <div className="mt-1">
                            <Pastilla>Inactiva</Pastilla>
                          </div>
                        )}
                      </td>
                      <td className="text-stone-500">por {m.unidad_compra}</td>
                      <td className="num">
                        {m.precio_compra === null ? (
                          <Pastilla tono="ambar">Sin precio</Pastilla>
                        ) : (
                          <>
                            {pesos(m.precio_compra)}
                            <div className="text-xs text-stone-400">/{m.unidad_compra}</div>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-mono text-xs text-stone-600">
                        1 {m.unidad_compra} = {numero(m.factor_conversion, 4)} {m.unidad_uso}
                      </td>
                      <td className="num text-stone-500">{porcentaje(m.merma_pct)}</td>
                      <td className="num font-medium text-marca-800">
                        {pesos(m.costo_unitario_uso_con_merma, true)}
                        <div className="text-xs font-normal text-stone-400">/{m.unidad_uso} con merma</div>
                      </td>
                      <td className="text-stone-500">{m.proveedor ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        </div>

        <Tarjeta titulo="Nueva materia prima">
          <form action={crearMateriaPrima} className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="etiqueta">Código *</label>
                <input name="codigo" required placeholder="MP-013" className="campo" />
              </div>
              <div className="col-span-2">
                <label className="etiqueta">Nombre *</label>
                <input name="nombre" required placeholder="Soga polipropileno 8mm" className="campo" />
              </div>
            </div>
            <div>
              <label className="etiqueta">Categoría</label>
              <input name="categoria" placeholder="Textil / Ferretería / Metal" className="campo" />
            </div>

            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Conversión de unidades</p>
              <div className="mt-2 grid grid-cols-3 items-end gap-2">
                <div>
                  <label className="etiqueta">Compro por</label>
                  <select name="unidad_compra_id" required className="campo">
                    {listaUnidades.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.codigo}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="etiqueta">rinde</label>
                  <input name="factor_conversion" required defaultValue="1" className="campo" />
                </div>
                <div>
                  <label className="etiqueta">y uso por</label>
                  <select name="unidad_uso_id" required className="campo">
                    {listaUnidades.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.codigo}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Ejemplo: compro soga por <strong>kg</strong>, rinde <strong>20</strong>, uso por{" "}
                <strong>m</strong>.
              </p>
            </div>

            <div>
              <label className="etiqueta">Merma del material %</label>
              <input name="merma_pct" defaultValue="0" className="campo" />
              <p className="mt-1 text-xs text-stone-500">Recortes y desperdicio propios del material.</p>
            </div>

            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Precio inicial (opcional)</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="etiqueta">Precio por unidad de compra</label>
                  <input name="precio" className="campo" />
                </div>
                <div>
                  <label className="etiqueta">Proveedor</label>
                  <select name="proveedor_id" className="campo" defaultValue="">
                    <option value="">—</option>
                    {listaProveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="etiqueta">Notas</label>
              <textarea name="notas" rows={2} className="campo" />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <input type="checkbox" name="activo" defaultChecked className="rounded" />
              Activa
            </label>
            <button className="boton-primario w-full">Agregar materia prima</button>
          </form>
        </Tarjeta>
      </div>
    </>
  );
}

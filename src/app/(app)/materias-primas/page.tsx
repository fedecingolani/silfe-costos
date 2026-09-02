import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { pesos, numero, porcentaje } from "@/lib/formato";
import type { MateriaPrimaCosto, Proveedor, UnidadMedida } from "@/lib/tipos";
import { FormNuevaMateriaPrima } from "./FormNuevaMateriaPrima";

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
        acciones={
          <Modal boton="+ Agregar materia prima" titulo="Nueva materia prima">
            <FormNuevaMateriaPrima listaUnidades={listaUnidades} listaProveedores={listaProveedores} />
          </Modal>
        }
      />

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
                      1 {m.unidad_compra} = {numero(m.factor_conversion)} {m.unidad_uso}
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
    </>
  );
}

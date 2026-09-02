import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, BotonEliminar } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { pesos, porcentaje } from "@/lib/formato";
import type { CategoriaManoObra } from "@/lib/tipos";
import { crearCategoria, actualizarCategoria, eliminarCategoria } from "./acciones";

export const dynamic = "force-dynamic";

function Formulario({
  accion,
  categoria,
}: {
  accion: (formData: FormData) => Promise<void>;
  categoria?: CategoriaManoObra;
}) {
  return (
    <form action={accion} className="space-y-3 p-4">
      {categoria && <input type="hidden" name="id" value={categoria.id} />}
      <div>
        <label className="etiqueta">Categoría *</label>
        <input name="nombre" required defaultValue={categoria?.nombre ?? ""} placeholder="Costurera" className="campo" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Costo por hora *</label>
          <input name="costo_hora" required defaultValue={categoria?.costo_hora ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Cargas sociales %</label>
          <input
            name="cargas_sociales_pct"
            defaultValue={categoria?.cargas_sociales_pct ?? 45}
            className="campo"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="activo" defaultChecked={categoria?.activo ?? true} className="rounded" />
        Activa
      </label>
      <div className="flex gap-2">
        <button className="boton-primario">{categoria ? "Guardar cambios" : "Agregar categoría"}</button>
        {categoria && (
          <Link href="/mano-obra" className="boton-secundario">
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}

export default async function ManoObraPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>;
}) {
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("categoria_mano_obra").select("*").order("nombre");
  const categorias = (data ?? []) as CategoriaManoObra[];
  const enEdicion = categorias.find((c) => c.id === editar);

  return (
    <>
      <Encabezado
        titulo="Mano de obra"
        descripcion="Costo horario de cada categoría de operario. El costo cargado incluye las cargas sociales y es el que se usa en el costeo."
        acciones={
          <Modal boton="+ Agregar categoría" titulo="Nueva categoría">
            <Formulario accion={crearCategoria} />
          </Modal>
        }
      />

      <Tarjeta titulo={`${categorias.length} categorías`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Costo/hora</th>
                <th className="num">Cargas</th>
                <th className="num">Costo/hora cargado</th>
                <th className="num">Costo/minuto</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categorias.length === 0 && <Vacio mensaje="Sin categorías cargadas." colSpan={7} />}
              {categorias.map((c) => {
                const cargado = c.costo_hora * (1 + c.cargas_sociales_pct / 100);
                return (
                  <tr key={c.id}>
                    <td className="font-medium text-stone-900">{c.nombre}</td>
                    <td className="num">{pesos(c.costo_hora)}</td>
                    <td className="num text-stone-500">{porcentaje(c.cargas_sociales_pct)}</td>
                    <td className="num font-medium text-marca-800">{pesos(cargado)}</td>
                    <td className="num text-stone-500">{pesos(cargado / 60, true)}</td>
                    <td>{c.activo ? <Pastilla tono="verde">Activa</Pastilla> : <Pastilla>Inactiva</Pastilla>}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link
                        href={`/mano-obra?editar=${c.id}`}
                        className="mr-2 text-xs text-marca-700 hover:underline"
                      >
                        Editar
                      </Link>
                      <form action={eliminarCategoria} className="inline">
                        <input type="hidden" name="id" value={c.id} />
                        <BotonEliminar />
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {enEdicion && (
        <Modal titulo={`Editar: ${enEdicion.nombre}`} abierto hrefAlCerrar="/mano-obra">
          <Formulario key={enEdicion.id} accion={actualizarCategoria} categoria={enEdicion} />
        </Modal>
      )}
    </>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, BotonEliminar } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Proceso } from "@/lib/tipos";
import { crearProceso, actualizarProceso, eliminarProceso } from "./acciones";

export const dynamic = "force-dynamic";

function Formulario({
  accion,
  proceso,
}: {
  accion: (formData: FormData) => Promise<void>;
  proceso?: Proceso;
}) {
  return (
    <form action={accion} className="space-y-3 p-4">
      {proceso && <input type="hidden" name="id" value={proceso.id} />}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="etiqueta">Código *</label>
          <input name="codigo" required defaultValue={proceso?.codigo ?? ""} placeholder="PR-01" className="campo" />
        </div>
        <div className="col-span-2">
          <label className="etiqueta">Nombre *</label>
          <input name="nombre" required defaultValue={proceso?.nombre ?? ""} placeholder="Costura" className="campo" />
        </div>
      </div>
      <div>
        <label className="etiqueta">Descripción</label>
        <input name="descripcion" defaultValue={proceso?.descripcion ?? ""} className="campo" />
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="activo" defaultChecked={proceso?.activo ?? true} className="rounded" />
        Activo
      </label>
      <div className="flex gap-2">
        <button className="boton-primario">{proceso ? "Guardar cambios" : "Agregar proceso"}</button>
        {proceso && (
          <Link href="/procesos" className="boton-secundario">
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}

export default async function ProcesosPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>;
}) {
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("proceso").select("*").order("codigo");
  const procesos = (data ?? []) as Proceso[];
  const enEdicion = procesos.find((p) => p.id === editar);

  return (
    <>
      <Encabezado
        titulo="Procesos"
        descripcion="Catálogo de operaciones productivas. Después se asignan a cada producto o subgrupo con su tiempo o costo."
        acciones={
          <Modal boton="+ Agregar proceso" titulo="Nuevo proceso">
            <Formulario accion={crearProceso} />
          </Modal>
        }
      />

      <Tarjeta titulo={`${procesos.length} procesos`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {procesos.length === 0 && <Vacio mensaje="Sin procesos cargados." colSpan={5} />}
              {procesos.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-stone-500">{p.codigo}</td>
                  <td className="font-medium text-stone-900">{p.nombre}</td>
                  <td className="text-stone-500">{p.descripcion ?? "—"}</td>
                  <td>{p.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}</td>
                  <td className="whitespace-nowrap text-right">
                    <Link href={`/procesos?editar=${p.id}`} className="mr-2 text-xs text-marca-700 hover:underline">
                      Editar
                    </Link>
                    <form action={eliminarProceso} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <BotonEliminar />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {enEdicion && (
        <Modal titulo={`Editar: ${enEdicion.nombre}`} abierto hrefAlCerrar="/procesos">
          <Formulario key={enEdicion.id} accion={actualizarProceso} proceso={enEdicion} />
        </Modal>
      )}
    </>
  );
}

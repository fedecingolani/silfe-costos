import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, BotonEliminar } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Transporte } from "@/lib/tipos";
import { crearTransporte, actualizarTransporte, eliminarTransporte } from "./acciones";

export const dynamic = "force-dynamic";

/** Avisos que llegan por ?aviso= desde las acciones de transportes. */
const AVISOS: Record<string, string> = {
  "en-uso": "El transporte está asignado a clientes o sucursales: desactivalo en lugar de borrarlo.",
};

function Formulario({
  accion,
  transporte,
}: {
  accion: (formData: FormData) => Promise<void>;
  transporte?: Transporte;
}) {
  return (
    <form action={accion} className="space-y-3 p-4">
      {transporte && <input type="hidden" name="id" value={transporte.id} />}
      <div>
        <label className="etiqueta">Nombre *</label>
        <input
          name="nombre"
          required
          defaultValue={transporte?.nombre ?? ""}
          placeholder="Expreso del Valle"
          className="campo"
        />
      </div>
      <div>
        <label className="etiqueta">Teléfono</label>
        <input name="telefono" defaultValue={transporte?.telefono ?? ""} className="campo" />
      </div>
      <div>
        <label className="etiqueta">Observaciones</label>
        <textarea
          name="observaciones"
          rows={3}
          defaultValue={transporte?.observaciones ?? ""}
          className="campo"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="activo" defaultChecked={transporte?.activo ?? true} className="rounded" />
        Activo
      </label>
      <div className="flex gap-2">
        <button className="boton-primario">{transporte ? "Guardar cambios" : "Agregar transporte"}</button>
        {transporte && (
          <Link href="/transportes" className="boton-secundario">
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}

export default async function TransportesPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; aviso?: string }>;
}) {
  const { editar, aviso } = await searchParams;
  const mensajeAviso = aviso && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.from("transporte").select("*").order("nombre");

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar transportes: {error.message}</p>;
  }

  const transportes = (data ?? []) as Transporte[];
  const enEdicion = transportes.find((t) => t.id === editar);

  return (
    <>
      <Encabezado
        titulo="Transportes"
        descripcion="Expresos y fletes con los que se despacha. Se asignan como transporte habitual del cliente o de una sucursal."
        acciones={
          <Modal boton="+ Agregar transporte" titulo="Nuevo transporte">
            <Formulario accion={crearTransporte} />
          </Modal>
        }
      />

      {mensajeAviso && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          No se pudo eliminar. {mensajeAviso}
        </div>
      )}

      <Tarjeta titulo={`${transportes.length} transportes`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Observaciones</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {transportes.length === 0 && <Vacio mensaje="Sin transportes cargados." colSpan={5} />}
              {transportes.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium text-stone-900">{t.nombre}</td>
                  <td className="text-stone-500">{t.telefono ?? "—"}</td>
                  <td className="text-stone-500">{t.observaciones ?? "—"}</td>
                  <td>{t.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}</td>
                  <td className="whitespace-nowrap text-right">
                    <Link href={`/transportes?editar=${t.id}`} className="mr-2 text-xs text-marca-700 hover:underline">
                      Editar
                    </Link>
                    <form action={eliminarTransporte} className="inline">
                      <input type="hidden" name="id" value={t.id} />
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
        <Modal titulo={`Editar: ${enEdicion.nombre}`} abierto hrefAlCerrar="/transportes">
          <Formulario key={enEdicion.id} accion={actualizarTransporte} transporte={enEdicion} />
        </Modal>
      )}
    </>
  );
}

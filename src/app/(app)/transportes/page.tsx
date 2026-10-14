import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, BotonEliminar } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Transporte } from "@/lib/tipos";
import { MENSAJE_TRANSPORTE_EN_USO } from "@/lib/transportes/errores";
import { crearTransporte, actualizarTransporte, eliminarTransporte } from "./acciones";
import { FormularioTransporte } from "./FormularioTransporte";

export const dynamic = "force-dynamic";

/** Avisos que llegan por ?aviso= desde las acciones de transportes. */
const AVISOS: Record<string, string> = {
  "en-uso": MENSAJE_TRANSPORTE_EN_USO,
  "no-eliminado": "Volvé a intentarlo.",
};

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
            <FormularioTransporte accion={crearTransporte} />
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
          <FormularioTransporte key={enEdicion.id} accion={actualizarTransporte} transporte={enEdicion} />
        </Modal>
      )}
    </>
  );
}

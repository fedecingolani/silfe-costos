import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Banco } from "@/lib/tipos";
import { claveBanco } from "@/lib/bancos/validacion";
import { actualizarBanco, cambiarEstadoBanco, crearBanco } from "./acciones";
import { FormularioBanco } from "./FormularioBanco";

export const dynamic = "force-dynamic";

const RUTA = "/configuracion/bancos";

/** Avisos que llegan por ?aviso= desde las acciones de bancos. */
const AVISOS: Record<string, string> = {
  duplicado: "Ya hay un banco activo con ese nombre (sin contar mayúsculas, tildes ni espacios).",
  "no-guardado": "Volvé a intentarlo.",
};

export default async function BancosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; editar?: string; aviso?: string }>;
}) {
  const { q, editar, aviso } = await searchParams;
  const mensajeAviso = aviso && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.from("banco").select("*").order("nombre");

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar bancos: {error.message}</p>;
  }

  const bancos = (data ?? []) as Banco[];
  const filtro = claveBanco(q ?? "");
  const lista = bancos.filter((b) => !filtro || claveBanco(b.nombre).includes(filtro));
  const enEdicion = bancos.find((b) => b.id === editar);

  return (
    <>
      <Encabezado
        titulo="Bancos"
        descripcion="Lista de bancos que se eligen en las cuentas de fondos y en los cheques de terceros. Los inactivos no aparecen para elegir, pero se siguen viendo donde ya se usaron."
        acciones={
          <Modal boton="+ Agregar banco" titulo="Nuevo banco">
            <FormularioBanco accion={crearBanco} />
          </Modal>
        }
      />

      <div className="space-y-4">
        <form className="flex gap-2">
          <input name="q" defaultValue={q ?? ""} placeholder="Buscar banco…" className="campo mt-0 max-w-sm" />
          <button className="boton-secundario">Buscar</button>
          {filtro && (
            <Link href={RUTA} className="boton-secundario">
              Limpiar
            </Link>
          )}
        </form>

        {mensajeAviso && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            No se pudo activar. {mensajeAviso}
          </div>
        )}

        <Tarjeta titulo={`${lista.length} bancos`}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.length === 0 && (
                  <Vacio mensaje={filtro ? "Ningún banco coincide con la búsqueda." : "Sin bancos cargados."} colSpan={3} />
                )}
                {lista.map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium text-stone-900">{b.nombre}</td>
                    <td>{b.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link
                        href={`${RUTA}?editar=${b.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                        className="mr-2 text-xs text-marca-700 hover:underline"
                      >
                        Editar
                      </Link>
                      <form action={cambiarEstadoBanco} className="inline">
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="activo" value={b.activo ? "false" : "true"} />
                        <button className="text-xs text-stone-500 hover:text-stone-800 hover:underline">
                          {b.activo ? "Desactivar" : "Activar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      </div>

      {enEdicion && (
        <Modal titulo={`Editar: ${enEdicion.nombre}`} abierto hrefAlCerrar={RUTA}>
          <FormularioBanco key={enEdicion.id} accion={actualizarBanco} banco={enEdicion} />
        </Modal>
      )}
    </>
  );
}

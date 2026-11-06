"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ModalError } from "@/components/ModalError";
import { Pastilla, Vacio } from "@/components/ui";
import type { FilaClave } from "@/lib/api/integraciones";
import { enviarSinReiniciar } from "@/lib/formularios";
import type { EstadoAccionClave, EstadoNuevaClave } from "./acciones";

type AccionCrear = (estado: EstadoNuevaClave, formData: FormData) => Promise<EstadoNuevaClave>;

/** Muestra la clave recién creada una sola vez, con botón para copiarla. */
function ClaveNueva({ estado }: { estado: EstadoNuevaClave }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Se guarda qué clave se copió, así una clave nueva arranca sin copiar.
  const [copiada, setCopiada] = useState<string | null>(null);

  useEffect(() => {
    if (estado?.clave) ref.current?.showModal();
  }, [estado]);

  async function copiar() {
    if (!estado?.clave) return;
    try {
      await navigator.clipboard.writeText(estado.clave);
      setCopiada(estado.clave);
    } catch {
      setCopiada(null);
    }
  }

  return (
    <dialog ref={ref} className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40">
      <div className="w-[min(32rem,90vw)] space-y-3 p-5">
        <h2 className="text-sm font-semibold text-stone-900">Clave creada: {estado?.nombre}</h2>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Copiala ahora y guardala en la integración. Por seguridad no se vuelve a mostrar: si la perdés, revocala y
          creá otra.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs text-stone-800">
            {estado?.clave}
          </code>
          <button type="button" onClick={copiar} className="boton-secundario shrink-0">
            {copiada && copiada === estado?.clave ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-stone-500">
          Se envía en cada pedido con el encabezado <code className="font-mono">Authorization: Bearer &lt;clave&gt;</code>.
        </p>
        <button type="button" onClick={() => ref.current?.close()} className="boton-primario w-full">
          Ya la copié
        </button>
      </div>
    </dialog>
  );
}

/** Listado de claves de API con alta y revocación. Las revocadas siguen listadas. */
export function ClavesApi({
  claves,
  crear,
  revocar,
}: {
  claves: FilaClave[];
  crear: AccionCrear;
  revocar: (id: string) => Promise<EstadoAccionClave>;
}) {
  const [nombre, setNombre] = useState("");
  // Al crear la clave se vacía el nombre; ante un error queda lo cargado.
  const [estado, accionCrear, creando] = useActionState<EstadoNuevaClave, FormData>(async (previo, datos) => {
    const resultado = await crear(previo, datos);
    if (resultado?.clave) setNombre("");
    return resultado;
  }, undefined);
  const [estadoFila, setEstadoFila] = useState<EstadoAccionClave>(undefined);
  const [ocupado, iniciar] = useTransition();

  return (
    <>
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Prefijo</th>
              <th>Creada</th>
              <th>Último uso</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {claves.length === 0 && <Vacio mensaje="Todavía no hay claves de API." colSpan={6} />}
            {claves.map((c) => {
              const activa = c.estado === "activa";
              return (
                <tr key={c.id}>
                  <td>{c.nombre}</td>
                  <td className="font-mono text-xs">{c.prefijo}…</td>
                  <td className="whitespace-nowrap">{c.creada}</td>
                  <td className="whitespace-nowrap">{c.ultimoUso}</td>
                  <td>
                    {activa ? (
                      <Pastilla tono="verde">Activa</Pastilla>
                    ) : (
                      <span title={`Revocada el ${c.revocada}`}>
                        <Pastilla tono="rojo">Revocada</Pastilla>
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {activa && (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          if (
                            confirm(
                              `¿Revocar la clave "${c.nombre}"? Las integraciones que la usen dejan de poder conectarse. No se puede deshacer.`,
                            )
                          ) {
                            iniciar(async () => setEstadoFila(await revocar(c.id)));
                          }
                        }}
                        className="boton-peligro px-2 py-1 text-xs"
                      >
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={enviarSinReiniciar(accionCrear)}
        className="grid gap-3 border-t border-stone-200 p-4 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <div>
          <label className="etiqueta" htmlFor="clave-nombre">
            Nombre de la integración *
          </label>
          <input
            id="clave-nombre"
            name="nombre"
            required
            maxLength={100}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Factura Digital"
            className="campo"
          />
        </div>
        <button disabled={creando} className="boton-primario">
          Crear clave
        </button>
        <p className="text-xs text-stone-500 sm:col-span-2">
          Conviene una clave por integración: así se puede revocar una sin cortar las demás.
        </p>
        {estadoFila?.ok && <p className="text-xs text-marca-700 sm:col-span-2">{estadoFila.ok}</p>}
      </form>

      <ClaveNueva estado={estado} />
      <ModalError estado={estado} titulo="No se pudo crear la clave" />
      <ModalError estado={estadoFila} titulo="No se pudo revocar la clave" />
    </>
  );
}

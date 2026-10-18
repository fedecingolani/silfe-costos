"use client";

import { useActionState, useState, useTransition } from "react";
import { ModalError } from "@/components/ModalError";
import { Pastilla, Vacio } from "@/components/ui";
import { enviarSinReiniciar } from "@/lib/formularios";
import type { PuntoVenta } from "@/lib/tipos";
import type { EstadoFormularioArca } from "./acciones";

type AccionFormulario = (estado: EstadoFormularioArca, formData: FormData) => Promise<EstadoFormularioArca>;
type AccionFila = (numero: number) => Promise<EstadoFormularioArca>;

/** Listado de puntos de venta con alta, activar/desactivar y borrado (sólo si no tiene comprobantes). */
export function PuntosVenta({
  puntos,
  agregar,
  cambiarActivo,
  borrar,
}: {
  puntos: Pick<PuntoVenta, "numero" | "nombre" | "electronico" | "activo">[];
  agregar: AccionFormulario;
  cambiarActivo: (numero: number, activo: boolean) => Promise<EstadoFormularioArca>;
  borrar: AccionFila;
}) {
  const [estado, accionAgregar, agregando] = useActionState(agregar, undefined);
  const [estadoFila, setEstadoFila] = useState<EstadoFormularioArca>(undefined);
  const [ocupado, iniciar] = useTransition();
  const [valores, setValores] = useState({ numero: "", nombre: "", electronico: true });

  const ejecutar = (accion: () => Promise<EstadoFormularioArca>) =>
    iniciar(async () => {
      setEstadoFila(await accion());
    });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Número</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {puntos.length === 0 && <Vacio mensaje="Todavía no hay puntos de venta." colSpan={5} />}
            {puntos.map((p) => (
              <tr key={p.numero}>
                <td className="tabular-nums">{String(p.numero).padStart(5, "0")}</td>
                <td>{p.nombre ?? "—"}</td>
                <td>{p.electronico ? <Pastilla tono="azul">Electrónico</Pastilla> : <Pastilla>No electrónico</Pastilla>}</td>
                <td>{p.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}</td>
                <td className="whitespace-nowrap text-right">
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => ejecutar(() => cambiarActivo(p.numero, !p.activo))}
                    className="boton-secundario px-2 py-1 text-xs"
                  >
                    {p.activo ? "Desactivar" : "Activar"}
                  </button>{" "}
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      if (confirm(`¿Borrar el punto de venta ${p.numero}? Sólo se puede si no tiene comprobantes.`)) {
                        ejecutar(() => borrar(p.numero));
                      }
                    }}
                    className="boton-peligro px-2 py-1 text-xs"
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={enviarSinReiniciar(accionAgregar)}
        className="grid gap-3 border-t border-stone-200 p-4 sm:grid-cols-[6rem_1fr_auto_auto] sm:items-end"
      >
        <div>
          <label className="etiqueta" htmlFor="pv-numero">
            Número *
          </label>
          <input
            id="pv-numero"
            name="numero"
            required
            inputMode="numeric"
            value={valores.numero}
            onChange={(e) => setValores((v) => ({ ...v, numero: e.target.value }))}
            className="campo"
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="pv-nombre">
            Nombre
          </label>
          <input
            id="pv-nombre"
            name="nombre"
            value={valores.nombre}
            onChange={(e) => setValores((v) => ({ ...v, nombre: e.target.value }))}
            placeholder="Factura electrónica"
            className="campo"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
          <input
            type="checkbox"
            name="electronico"
            checked={valores.electronico}
            onChange={(e) => setValores((v) => ({ ...v, electronico: e.target.checked }))}
          />
          Electrónico
        </label>
        <button disabled={agregando} className="boton-primario">
          Agregar
        </button>
        <p className="text-xs text-stone-500 sm:col-span-4">
          Electrónico: el número lo da ARCA y se pide CAE (tiene que estar habilitado en ARCA para Web Services). Un
          punto de venta con comprobantes no se borra: se desactiva.
        </p>
        {estado?.ok && <p className="text-xs text-marca-700 sm:col-span-4">{estado.ok}</p>}
        {estadoFila?.ok && <p className="text-xs text-marca-700 sm:col-span-4">{estadoFila.ok}</p>}
      </form>
      <ModalError estado={estado} />
      <ModalError estado={estadoFila} />
    </>
  );
}

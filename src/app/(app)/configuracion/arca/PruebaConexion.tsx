"use client";

import { useActionState } from "react";
import { Pastilla } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import { NOMBRES_AMBIENTE_ARCA } from "@/lib/tipos";
import type { EstadoPruebaConexion } from "./acciones";

type Accion = (estado: EstadoPruebaConexion) => Promise<EstadoPruebaConexion>;

const NOMBRES_COMPROBANTE: Record<number, string> = { 1: "Factura A", 11: "Factura C" };

function Estado({ valor }: { valor: string }) {
  return <Pastilla tono={valor === "OK" ? "verde" : "rojo"}>{valor}</Pastilla>;
}

/** Botón "Probar conexión" y el resultado de cada paso: servidores, login y último comprobante. */
export function PruebaConexion({ accion, deshabilitado }: { accion: Accion; deshabilitado: boolean }) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  const r = estado?.resultado;
  return (
    <form action={accionFormulario} className="space-y-3 p-4 text-sm">
      <button disabled={pendiente || deshabilitado} className="boton-primario">
        {pendiente ? "Probando…" : "Probar conexión"}
      </button>

      {r && (
        <dl className="space-y-2 text-stone-700">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-28 text-stone-500">Ambiente</dt>
            <dd>{NOMBRES_AMBIENTE_ARCA[r.ambiente]}</dd>
          </div>
          {r.servidores && (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="w-28 text-stone-500">Servidores</dt>
              <dd className="flex flex-wrap gap-1.5">
                App <Estado valor={r.servidores.app} /> Base <Estado valor={r.servidores.db} /> Auth{" "}
                <Estado valor={r.servidores.auth} />
              </dd>
            </div>
          )}
          {r.ticket && (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="w-28 text-stone-500">Login (WSAA)</dt>
              <dd>
                <Pastilla tono="verde">OK</Pastilla>{" "}
                {r.ticket.origen === "nuevo" ? "ticket nuevo" : "ticket reutilizado"}, vence{" "}
                {fechaHora(r.ticket.expira)}
              </dd>
            </div>
          )}
          {r.ultimo && (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="w-28 text-stone-500">Último comprobante</dt>
              <dd>
                {NOMBRES_COMPROBANTE[r.ultimo.tipoComprobante] ?? `Tipo ${r.ultimo.tipoComprobante}`}, punto de venta{" "}
                {r.ultimo.puntoVenta}: <span className="font-medium tabular-nums">{r.ultimo.numero}</span>
              </dd>
            </div>
          )}
        </dl>
      )}

      {estado?.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {estado.error}
        </div>
      )}
    </form>
  );
}

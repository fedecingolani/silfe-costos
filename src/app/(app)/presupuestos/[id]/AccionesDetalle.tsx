"use client";

import { useState, useTransition } from "react";
import { duplicarPresupuesto, type ResultadoPresupuesto } from "../acciones";

/**
 * Botones del detalle de un presupuesto convertido: "Duplicar" crea uno
 * abierto nuevo y lo abre; "PDF" lo imprime.
 */
export function AccionesDetalle({ id }: { id: string }) {
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoPresupuesto | null>(null);

  const duplicar = () =>
    iniciar(async () => {
      const r = await duplicarPresupuesto(id);
      if (r?.error) setResultado(r);
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pendiente} onClick={duplicar} className="boton-secundario">
          Duplicar
        </button>
        <a href={`/presupuestos/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="boton-secundario">
          PDF
        </a>
      </div>
      {resultado?.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {resultado.error}
        </div>
      )}
    </div>
  );
}

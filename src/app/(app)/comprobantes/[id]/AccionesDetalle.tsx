"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { autorizarComprobante, duplicarComprobante, type EstadoAccionComprobante } from "../acciones";

/**
 * Botones del detalle: "Verificar con ARCA" (sólo en verificación, corre la
 * reconciliación de autorizarComprobante), "Duplicar", "PDF" (sólo con
 * `pdf`: autorizado en un punto de venta electrónico) y el lugar de la nota
 * de crédito (T6), todavía sin funcionar.
 */
export function AccionesDetalle({ id, verificando, pdf }: { id: string; verificando: boolean; pdf: boolean }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<EstadoAccionComprobante | null>(null);

  const verificar = () =>
    iniciar(async () => {
      setResultado(await autorizarComprobante(id));
      router.refresh();
    });

  const duplicar = () =>
    iniciar(async () => {
      const r = await duplicarComprobante(id);
      if (r?.error) setResultado(r);
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {verificando && (
          <button type="button" disabled={pendiente} onClick={verificar} className="boton-primario">
            {pendiente ? "Verificando…" : "Verificar con ARCA"}
          </button>
        )}
        <button type="button" disabled={pendiente} onClick={duplicar} className="boton-secundario">
          Duplicar
        </button>
        {pdf ? (
          <a href={`/comprobantes/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="boton-secundario">
            PDF
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="El PDF está disponible cuando el comprobante está autorizado en un punto de venta electrónico."
            className="boton-secundario opacity-50"
          >
            PDF
          </button>
        )}
        {/* Lugar reservado: la nota de crédito llega en T6. */}
        <button type="button" disabled title="Próximamente (T6)" className="boton-secundario opacity-50">
          Generar nota de crédito (próximamente)
        </button>
      </div>
      {resultado?.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {resultado.error}
        </div>
      )}
      {resultado?.ok && (
        <div className="rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          {resultado.ok}
        </div>
      )}
    </div>
  );
}

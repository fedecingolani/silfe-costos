"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NOMBRES_CLASE_COMPROBANTE, type ClaseComprobante } from "@/lib/tipos";
import { autorizarComprobante, duplicarComprobante, generarNota, type EstadoAccionComprobante } from "../acciones";

/**
 * Botones del detalle: "Verificar con ARCA" (sólo en verificación, corre la
 * reconciliación de autorizarComprobante), "Duplicar", "PDF" (según
 * puedeImprimir, la misma regla que la ruta del PDF; si no se puede, el
 * motivo queda en el título del botón deshabilitado) y "Generar nota de
 * crédito / débito" (las de `notas`: notasPermitidas), que crea el borrador
 * de la nota y abre el editor.
 */
export function AccionesDetalle({
  id,
  verificando,
  pdf,
  notas,
}: {
  id: string;
  verificando: boolean;
  pdf: { ok: true } | { ok: false; motivo: string };
  notas: ClaseComprobante[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<EstadoAccionComprobante | null>(null);

  const verificar = () =>
    iniciar(async () => {
      setResultado(await autorizarComprobante(id));
      router.refresh();
    });

  const generar = (clase: ClaseComprobante) =>
    iniciar(async () => {
      const r = await generarNota(id, clase);
      if (r?.error) setResultado(r);
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
        {pdf.ok ? (
          <a href={`/comprobantes/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="boton-secundario">
            PDF
          </a>
        ) : (
          <button
            type="button"
            disabled
            title={pdf.motivo}
            className="boton-secundario opacity-50"
          >
            PDF
          </button>
        )}
        {notas.map((clase) => (
          <button key={clase} type="button" disabled={pendiente} onClick={() => generar(clase)} className="boton-secundario">
            Generar {NOMBRES_CLASE_COMPROBANTE[clase].toLowerCase()}
          </button>
        ))}
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

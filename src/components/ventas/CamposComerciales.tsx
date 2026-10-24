"use client";

import { useState, type ReactNode } from "react";
import { vencimientoPara } from "@/lib/comprobantes/borrador";
import { CONDICIONES_PAGO, NOMBRES_CONDICION_PAGO, type CondicionPago } from "@/lib/tipos";

/** Datos comerciales de la cabecera de un documento de venta. */
export type DatosComerciales = {
  /** yyyy-mm-dd */
  fecha: string;
  /** Vencimiento del cobro, yyyy-mm-dd. */
  vencimiento: string;
  condicion: CondicionPago;
  listaId: string | null;
  observaciones: string;
};

/**
 * Campos comerciales de la cabecera: fecha, condición de pago, vencimiento
 * del cobro, lista de precios y observaciones (detrás de "Más opciones").
 * Son celdas de la grilla de la cabecera (sm:grid-cols-6), así que van
 * dentro de ella. Controlado: al cambiar la fecha o la condición también
 * ajusta el vencimiento.
 */
export function CamposComerciales({
  valores,
  onCambiar,
  listas,
  despuesDeFecha,
}: {
  valores: DatosComerciales;
  /** Recibe sólo lo que cambió. Cambiar la lista de precios es el aviso para cargar sus precios. */
  onCambiar: (cambios: Partial<DatosComerciales>) => void;
  listas: { id: string; nombre: string }[];
  /** Celdas que van después de la fecha (p. ej. "Válido hasta" de un presupuesto). */
  despuesDeFecha?: ReactNode;
}) {
  const { fecha, vencimiento, condicion, listaId, observaciones } = valores;
  const [masOpciones, setMasOpciones] = useState(Boolean(observaciones));

  return (
    <>
      <div>
        <label className="etiqueta" htmlFor="fecha">
          Fecha *
        </label>
        <input
          id="fecha"
          type="date"
          value={fecha}
          onChange={(e) =>
            onCambiar({ fecha: e.target.value, vencimiento: vencimientoPara(condicion, e.target.value, vencimiento) })
          }
          className="campo"
        />
      </div>
      {despuesDeFecha}
      <div>
        <label className="etiqueta" htmlFor="condicion">
          Condición de pago
        </label>
        <select
          id="condicion"
          value={condicion}
          onChange={(e) => {
            const valor = e.target.value as CondicionPago;
            onCambiar({ condicion: valor, vencimiento: vencimientoPara(valor, fecha, vencimiento) });
          }}
          className="campo"
        >
          {CONDICIONES_PAGO.map((c) => (
            <option key={c} value={c}>
              {NOMBRES_CONDICION_PAGO[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor="vencimiento">
          Vencimiento del cobro
        </label>
        <input
          id="vencimiento"
          type="date"
          value={vencimiento}
          min={fecha}
          disabled={condicion === "contado"}
          onChange={(e) => onCambiar({ vencimiento: e.target.value })}
          className="campo"
        />
      </div>
      <div>
        <label className="etiqueta" htmlFor="lista">
          Lista de precios
        </label>
        <select
          id="lista"
          value={listaId ?? ""}
          onChange={(e) => onCambiar({ listaId: e.target.value || null })}
          className="campo"
        >
          <option value="">Sin lista</option>
          {listas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-6">
        <button
          type="button"
          onClick={() => setMasOpciones((v) => !v)}
          className="text-xs font-medium text-marca-700 hover:underline"
        >
          {masOpciones ? "− Menos opciones" : "+ Más opciones"}
        </button>
        {masOpciones && (
          <div className="mt-2">
            <label className="etiqueta" htmlFor="observaciones">
              Observaciones
            </label>
            <textarea
              id="observaciones"
              rows={2}
              value={observaciones}
              onChange={(e) => onCambiar({ observaciones: e.target.value })}
              className="campo"
            />
          </div>
        )}
      </div>
    </>
  );
}

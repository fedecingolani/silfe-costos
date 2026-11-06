"use client";

import { useEffect, useRef, useState } from "react";
import { alternarPrecio, diferenciaPrecio, seleccionInicialPrecios, textoDiferencia } from "@/lib/compras/comprobantes/precios";
import { pesos } from "@/lib/formato";
import type { PrecioComprobanteCompra } from "@/lib/tipos";

/**
 * Diálogo de confirmación de un comprobante de compra ya guardado. Con
 * renglones con materia prima, muestra el precio de la factura (por unidad
 * de compra, sin IVA) junto al vigente del proveedor y deja elegir cuáles
 * se actualizan; vienen marcados los que cambiaron. Sin esos renglones, es
 * la confirmación de siempre. Se monta abierto: para cerrarlo, el padre lo
 * desmonta.
 */
export function ActualizarPrecios({
  lineas,
  onCancelar,
  onConfirmar,
}: {
  lineas: PrecioComprobanteCompra[];
  onCancelar: () => void;
  onConfirmar: (actualizarPrecios: string[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [seleccion, setSeleccion] = useState(() => seleccionInicialPrecios(lineas));

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  const conPrecios = lineas.length > 0;

  return (
    <dialog
      ref={ref}
      onClose={onCancelar}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
    >
      <div className={conPrecios ? "max-w-3xl p-5" : "max-w-sm p-5"}>
        <p className="text-sm font-semibold text-stone-900">
          {conPrecios ? "Actualizar precios" : "¿Confirmar el comprobante?"}
        </p>
        <p className="mt-2 text-sm text-stone-600">
          {conPrecios
            ? "Elegí qué precios de materias primas se actualizan con los de la factura (por unidad de compra y sin IVA). Vienen marcados los que cambiaron. Después el comprobante no se puede modificar ni borrar: sólo anular."
            : "Se confirma el comprobante guardado. Después no se puede modificar ni borrar: sólo anular."}
        </p>

        {conPrecios && (
          <div className="mt-3 max-h-[50vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="py-1 pr-2 font-medium">Actualizar</th>
                  <th className="py-1 pr-2 font-medium">Renglón</th>
                  <th className="py-1 pr-2 font-medium">Materia prima</th>
                  <th className="py-1 pr-2 text-right font-medium">Precio vigente</th>
                  <th className="py-1 pr-2 text-right font-medium">Precio de la factura</th>
                  <th className="py-1 text-right font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const id = l.comprobante_compra_item_id;
                  return (
                    <tr key={id} className="border-t border-stone-100">
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={seleccion.has(id)}
                          onChange={() => setSeleccion((actual) => alternarPrecio(lineas, actual, id))}
                          aria-label={`Actualizar el precio de ${l.materia_prima_nombre}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-stone-600">{l.descripcion}</td>
                      <td className="py-1.5 pr-2">
                        <span className="font-mono text-xs text-stone-500">{l.materia_prima_codigo}</span>{" "}
                        {l.materia_prima_nombre}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-stone-600">
                        {l.precio_vigente === null ? "—" : pesos(l.precio_vigente, true)}
                        {l.incluye_iva && <span className="block text-xs text-stone-400">con IVA</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {pesos(l.precio_factura, true)}
                        <span className="block text-xs text-stone-400">por {l.unidad_compra}</span>
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${l.cambio ? "font-medium text-stone-900" : "text-stone-400"}`}>
                        {textoDiferencia(diferenciaPrecio(l))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => ref.current?.close()} className="boton-secundario flex-1">
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirmar([...seleccion])} className="boton-primario flex-1">
            Confirmar
          </button>
        </div>
      </div>
    </dialog>
  );
}

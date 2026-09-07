"use client";

import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import type { Proveedor, UnidadMedida } from "@/lib/tipos";
import { crearMateriaPrima } from "./acciones";

export function FormNuevaMateriaPrima({
  listaUnidades,
  listaProveedores,
  codigoSugerido,
}: {
  listaUnidades: UnidadMedida[];
  listaProveedores: Proveedor[];
  codigoSugerido: string;
}) {
  const [estado, accion, pendiente] = useActionState(crearMateriaPrima, undefined);

  return (
    <>
      <form action={accion} className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="etiqueta">Código *</label>
            <input name="codigo" required defaultValue={codigoSugerido} className="campo" />
          </div>
          <div className="col-span-2">
            <label className="etiqueta">Nombre *</label>
            <input name="nombre" required placeholder="Soga polipropileno 8mm" className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Categoría</label>
          <input name="categoria" placeholder="Textil / Ferretería / Metal" className="campo" />
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Conversión de unidades</p>
          <div className="mt-2 grid grid-cols-3 items-end gap-2">
            <div>
              <label className="etiqueta">Compro por</label>
              <select name="unidad_compra_id" required className="campo">
                {listaUnidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta">rinde</label>
              <input name="factor_conversion" required defaultValue="1" className="campo" />
            </div>
            <div>
              <label className="etiqueta">y uso por</label>
              <select name="unidad_uso_id" required className="campo">
                {listaUnidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Ejemplo: compro soga por <strong>kg</strong>, rinde <strong>20</strong>, uso por{" "}
            <strong>m</strong>.
          </p>
        </div>

        <div>
          <label className="etiqueta">Merma del material %</label>
          <input name="merma_pct" defaultValue="0" className="campo" />
          <p className="mt-1 text-xs text-stone-500">Recortes y desperdicio propios del material.</p>
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Precio inicial (opcional)</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta">Precio por unidad de compra</label>
              <input name="precio" className="campo" />
            </div>
            <div>
              <label className="etiqueta">Proveedor</label>
              <select name="proveedor_id" className="campo" defaultValue="">
                <option value="">—</option>
                {listaProveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="etiqueta">Notas</label>
          <textarea name="notas" rows={2} className="campo" />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activo" defaultChecked className="rounded" />
          Activa
        </label>
        <button disabled={pendiente} className="boton-primario w-full">
          {pendiente ? "Agregando…" : "Agregar materia prima"}
        </button>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

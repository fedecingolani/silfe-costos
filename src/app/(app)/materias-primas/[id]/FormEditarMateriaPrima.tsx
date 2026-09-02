"use client";

import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import type { MateriaPrima, UnidadMedida } from "@/lib/tipos";
import { actualizarMateriaPrima } from "../acciones";

export function FormEditarMateriaPrima({
  materia,
  listaUnidades,
}: {
  materia: MateriaPrima;
  listaUnidades: UnidadMedida[];
}) {
  const [estado, accion, pendiente] = useActionState(actualizarMateriaPrima, undefined);

  return (
    <>
      <form action={accion} className="space-y-3 p-4">
        <input type="hidden" name="id" value={materia.id} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="etiqueta">Código *</label>
            <input name="codigo" required defaultValue={materia.codigo} className="campo" />
          </div>
          <div className="col-span-2">
            <label className="etiqueta">Nombre *</label>
            <input name="nombre" required defaultValue={materia.nombre} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Categoría</label>
          <input name="categoria" defaultValue={materia.categoria ?? ""} className="campo" />
        </div>
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Conversión de unidades</p>
          <div className="mt-2 grid grid-cols-3 items-end gap-2">
            <div>
              <label className="etiqueta">Compro por</label>
              <select name="unidad_compra_id" defaultValue={materia.unidad_compra_id} className="campo">
                {listaUnidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta">rinde</label>
              <input name="factor_conversion" defaultValue={materia.factor_conversion} className="campo" />
            </div>
            <div>
              <label className="etiqueta">y uso por</label>
              <select name="unidad_uso_id" defaultValue={materia.unidad_uso_id} className="campo">
                {listaUnidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div>
          <label className="etiqueta">Merma del material %</label>
          <input name="merma_pct" defaultValue={materia.merma_pct} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Notas</label>
          <textarea name="notas" rows={3} defaultValue={materia.notas ?? ""} className="campo" />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activo" defaultChecked={materia.activo} className="rounded" />
          Activa
        </label>
        <button disabled={pendiente} className="boton-primario w-full">
          {pendiente ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

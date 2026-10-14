"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import type { Transporte } from "@/lib/tipos";
import type { EstadoFormularioTransporte } from "./acciones";

/** Acción de servidor que devuelve el error en lugar de lanzarlo (Next lo enmascara en producción). */
type Accion = (estado: EstadoFormularioTransporte, formData: FormData) => Promise<EstadoFormularioTransporte>;

export function FormularioTransporte({ accion, transporte }: { accion: Accion; transporte?: Transporte }) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  return (
    <>
      <form action={accionFormulario} className="space-y-3 p-4">
        {transporte && <input type="hidden" name="id" value={transporte.id} />}
        <div>
          <label className="etiqueta">Nombre *</label>
          <input
            name="nombre"
            required
            defaultValue={transporte?.nombre ?? ""}
            placeholder="Expreso del Valle"
            className="campo"
          />
        </div>
        <div>
          <label className="etiqueta">Teléfono</label>
          <input name="telefono" defaultValue={transporte?.telefono ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Observaciones</label>
          <textarea
            name="observaciones"
            rows={3}
            defaultValue={transporte?.observaciones ?? ""}
            className="campo"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activo" defaultChecked={transporte?.activo ?? true} className="rounded" />
          Activo
        </label>
        <div className="flex gap-2">
          <button disabled={pendiente} className="boton-primario">
            {transporte ? "Guardar cambios" : "Agregar transporte"}
          </button>
          {transporte && (
            <Link href="/transportes" className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

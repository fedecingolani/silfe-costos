"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import { CONDICIONES_IVA, type Proveedor } from "@/lib/tipos";
import { enviarSinReiniciar } from "@/lib/formularios";
import type { EstadoFormularioProveedor } from "./acciones";

/** Acción de servidor que devuelve el error en lugar de lanzarlo (Next lo enmascara en producción). */
type Accion = (estado: EstadoFormularioProveedor, formData: FormData) => Promise<EstadoFormularioProveedor>;

export function FormularioProveedor({
  accion,
  proveedor,
  cancelarHref,
}: {
  accion: Accion;
  proveedor?: Proveedor;
  cancelarHref?: string;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  return (
    <>
      <form onSubmit={enviarSinReiniciar(accionFormulario)} className="space-y-3 p-4">
        {proveedor && <input type="hidden" name="id" value={proveedor.id} />}
        <div>
          <label className="etiqueta">Nombre *</label>
          <input name="nombre" required defaultValue={proveedor?.nombre ?? ""} className="campo" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">CUIT</label>
            <input name="cuit" defaultValue={proveedor?.cuit ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Condición frente al IVA</label>
            <select name="condicion_iva" defaultValue={proveedor?.condicion_iva ?? ""} className="campo">
              <option value="">Sin indicar</option>
              {CONDICIONES_IVA.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="etiqueta">Domicilio</label>
          <input name="domicilio" defaultValue={proveedor?.domicilio ?? ""} className="campo" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">CBU</label>
            <input
              name="cbu"
              inputMode="numeric"
              defaultValue={proveedor?.cbu ?? ""}
              placeholder="22 dígitos"
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta">Alias</label>
            <input name="alias" defaultValue={proveedor?.alias ?? ""} className="campo" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Contacto</label>
            <input name="contacto" defaultValue={proveedor?.contacto ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Teléfono</label>
            <input name="telefono" defaultValue={proveedor?.telefono ?? ""} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Email</label>
          <input name="email" type="email" defaultValue={proveedor?.email ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Notas</label>
          <textarea name="notas" rows={2} defaultValue={proveedor?.notas ?? ""} className="campo" />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activo" defaultChecked={proveedor?.activo ?? true} className="rounded" />
          Activo
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={pendiente} className="boton-primario">
            {proveedor ? "Guardar cambios" : "Agregar proveedor"}
          </button>
          {cancelarHref && (
            <Link href={cancelarHref} className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

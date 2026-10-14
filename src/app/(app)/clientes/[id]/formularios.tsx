"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import type { ClienteContacto, ClienteSucursal, Transporte } from "@/lib/tipos";
import type { EstadoFormularioCliente } from "../acciones";

/** Acción de servidor que devuelve el error en lugar de lanzarlo (Next lo enmascara en producción). */
type Accion = (estado: EstadoFormularioCliente, formData: FormData) => Promise<EstadoFormularioCliente>;

export function FormularioSucursal({
  clienteId,
  accion,
  sucursal,
  transportes,
  transporteHabitual,
}: {
  clienteId: string;
  accion: Accion;
  sucursal?: ClienteSucursal;
  transportes: Transporte[];
  /** Nombre del transporte habitual del cliente, para la opción por defecto. */
  transporteHabitual: string | null;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  const opciones = transportes.filter((t) => t.activo || t.id === sucursal?.transporte_id);
  return (
    <>
      <form action={accionFormulario} className="space-y-3 p-4">
        <input type="hidden" name="cliente_id" value={clienteId} />
        {sucursal && <input type="hidden" name="id" value={sucursal.id} />}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="etiqueta">Nombre *</label>
            <input
              name="nombre"
              required
              defaultValue={sucursal?.nombre ?? ""}
              placeholder="Casa central, Depósito Cipolletti…"
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta">Orden</label>
            <input name="orden" defaultValue={sucursal?.orden ?? 0} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Dirección</label>
          <input name="direccion" defaultValue={sucursal?.direccion ?? ""} className="campo" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Localidad</label>
            <input name="localidad" defaultValue={sucursal?.localidad ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Provincia</label>
            <input name="provincia" defaultValue={sucursal?.provincia ?? ""} className="campo" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Código postal</label>
            <input name="codigo_postal" defaultValue={sucursal?.codigo_postal ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Teléfono</label>
            <input name="telefono" defaultValue={sucursal?.telefono ?? ""} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Transporte</label>
          <select name="transporte_id" defaultValue={sucursal?.transporte_id ?? ""} className="campo">
            <option value="">
              {transporteHabitual ? `El habitual del cliente (${transporteHabitual})` : "El habitual del cliente"}
            </option>
            {opciones.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.activo ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Observaciones</label>
          <textarea name="observaciones" rows={2} defaultValue={sucursal?.observaciones ?? ""} className="campo" />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              name="recibe_entregas"
              defaultChecked={sucursal?.recibe_entregas ?? true}
              className="rounded"
            />
            Recibe entregas
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="principal" defaultChecked={sucursal?.principal ?? false} className="rounded" />
            Dirección de entrega principal
          </label>
        </div>
        <div className="flex gap-2">
          <button disabled={pendiente} className="boton-primario">
            {sucursal ? "Guardar cambios" : "Agregar sucursal"}
          </button>
          {sucursal && (
            <Link href={`/clientes/${clienteId}`} className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

export function FormularioContacto({
  clienteId,
  accion,
  contacto,
  sucursales,
}: {
  clienteId: string;
  accion: Accion;
  contacto?: ClienteContacto;
  sucursales: ClienteSucursal[];
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  return (
    <>
      <form action={accionFormulario} className="space-y-3 p-4">
        <input type="hidden" name="cliente_id" value={clienteId} />
        {contacto && <input type="hidden" name="id" value={contacto.id} />}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="etiqueta">Nombre *</label>
            <input name="nombre" required defaultValue={contacto?.nombre ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Orden</label>
            <input name="orden" defaultValue={contacto?.orden ?? 0} className="campo" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Cargo</label>
            <input name="cargo" defaultValue={contacto?.cargo ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Sucursal</label>
            <select name="sucursal_id" defaultValue={contacto?.sucursal_id ?? ""} className="campo">
              <option value="">—</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Teléfono</label>
            <input name="telefono" type="tel" defaultValue={contacto?.telefono ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta">WhatsApp</label>
            <input name="whatsapp" type="tel" defaultValue={contacto?.whatsapp ?? ""} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Email</label>
          <input name="email" type="email" defaultValue={contacto?.email ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Observaciones</label>
          <textarea name="observaciones" rows={2} defaultValue={contacto?.observaciones ?? ""} className="campo" />
        </div>
        <div className="flex gap-2">
          <button disabled={pendiente} className="boton-primario">
            {contacto ? "Guardar cambios" : "Agregar contacto"}
          </button>
          {contacto && (
            <Link href={`/clientes/${clienteId}`} className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

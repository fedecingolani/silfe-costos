"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import { enviarSinReiniciar } from "@/lib/formularios";
import type { CuentaFondos, TipoCuentaFondos } from "@/lib/tipos";
import type { EstadoFormularioCuenta } from "./acciones";

/** Acción de servidor que devuelve el error en lugar de lanzarlo (Next lo enmascara en producción). */
type Accion = (estado: EstadoFormularioCuenta, formData: FormData) => Promise<EstadoFormularioCuenta>;

/** Alta y edición de una cuenta de fondos. Los datos bancarios sólo para las cuentas de banco. */
export function FormularioCuenta({
  accion,
  tipo,
  cuenta,
  cancelarHref,
}: {
  accion: Accion;
  tipo: TipoCuentaFondos;
  cuenta?: CuentaFondos;
  cancelarHref?: string;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  return (
    <>
      <form onSubmit={enviarSinReiniciar(accionFormulario)} className="space-y-3 p-4">
        <input type="hidden" name="tipo" value={tipo} />
        {cuenta && <input type="hidden" name="id" value={cuenta.id} />}
        <div>
          <label className="etiqueta" htmlFor="cuenta-nombre">
            Nombre *
          </label>
          <input
            id="cuenta-nombre"
            name="nombre"
            required
            defaultValue={cuenta?.nombre ?? ""}
            placeholder={tipo === "banco" ? "Por ejemplo: Galicia cuenta corriente" : "Por ejemplo: Caja de oficina"}
            className="campo"
          />
        </div>
        {tipo === "banco" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="etiqueta" htmlFor="cuenta-banco">
                  Banco
                </label>
                <input id="cuenta-banco" name="banco" defaultValue={cuenta?.banco ?? ""} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="cuenta-numero">
                  Número de cuenta
                </label>
                <input id="cuenta-numero" name="numero_cuenta" defaultValue={cuenta?.numero_cuenta ?? ""} className="campo" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="etiqueta" htmlFor="cuenta-cbu">
                  CBU
                </label>
                <input
                  id="cuenta-cbu"
                  name="cbu"
                  inputMode="numeric"
                  defaultValue={cuenta?.cbu ?? ""}
                  placeholder="22 dígitos"
                  className="campo"
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="cuenta-alias">
                  Alias
                </label>
                <input id="cuenta-alias" name="alias" defaultValue={cuenta?.alias ?? ""} className="campo" />
              </div>
            </div>
          </>
        )}
        <div>
          <label className="etiqueta" htmlFor="cuenta-observacion">
            Observación
          </label>
          <textarea
            id="cuenta-observacion"
            name="observacion"
            rows={2}
            defaultValue={cuenta?.observacion ?? ""}
            className="campo"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activa" defaultChecked={cuenta?.activa ?? true} className="rounded" />
          Activa (una cuenta inactiva no admite ajustes nuevos)
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={pendiente} className="boton-primario">
            {cuenta ? "Guardar cambios" : tipo === "banco" ? "Agregar cuenta" : "Agregar caja"}
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

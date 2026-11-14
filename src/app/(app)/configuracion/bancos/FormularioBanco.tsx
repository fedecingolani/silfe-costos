"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import type { Banco } from "@/lib/tipos";
import { enviarSinReiniciar } from "@/lib/formularios";
import { LARGO_MAXIMO_NOMBRE_BANCO } from "@/lib/bancos/validacion";
import type { EstadoFormularioBanco } from "./acciones";

/** Acción de servidor que devuelve el error en lugar de lanzarlo (Next lo enmascara en producción). */
type Accion = (estado: EstadoFormularioBanco, formData: FormData) => Promise<EstadoFormularioBanco>;

export function FormularioBanco({ accion, banco }: { accion: Accion; banco?: Banco }) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  return (
    <>
      <form onSubmit={enviarSinReiniciar(accionFormulario)} className="space-y-3 p-4">
        {banco && <input type="hidden" name="id" value={banco.id} />}
        <div>
          <label className="etiqueta" htmlFor="banco-nombre">
            Nombre *
          </label>
          <input
            id="banco-nombre"
            name="nombre"
            required
            maxLength={LARGO_MAXIMO_NOMBRE_BANCO}
            defaultValue={banco?.nombre ?? ""}
            placeholder="Banco de la Nación Argentina"
            className="campo"
          />
          {banco && (
            <p className="mt-1 text-xs text-stone-500">
              El nombre nuevo se ve en las cuentas de fondos. Si el banco está en cheques cargados, no se
              puede renombrar: desactivalo y creá otro.
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activo" defaultChecked={banco?.activo ?? true} className="rounded" />
          Activo (aparece para elegir en cuentas y cheques)
        </label>
        <div className="flex gap-2">
          <button disabled={pendiente} className="boton-primario">
            {banco ? "Guardar cambios" : "Agregar banco"}
          </button>
          {banco && (
            <Link href="/configuracion/bancos" className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

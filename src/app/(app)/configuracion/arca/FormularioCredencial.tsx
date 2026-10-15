"use client";

import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
import type { EstadoFormularioArca } from "./acciones";

type Accion = (estado: EstadoFormularioArca, formData: FormData) => Promise<EstadoFormularioArca>;

/** Sube el certificado y la clave privada de un ambiente. La clave se cifra en el servidor. */
export function FormularioCredencial({ accion, reemplaza }: { accion: Accion; reemplaza: boolean }) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  return (
    <>
      <form action={accionFormulario} className="space-y-3 border-t border-stone-200 p-4">
        <div>
          <label className="etiqueta">Certificado (.crt o .pem)</label>
          <input
            type="file"
            name="certificado"
            required
            accept=".crt,.pem,.cer"
            className="block w-full text-sm text-stone-600"
          />
        </div>
        <div>
          <label className="etiqueta">Clave privada (.key)</label>
          <input
            type="file"
            name="clave"
            required
            accept=".key,.pem"
            className="block w-full text-sm text-stone-600"
          />
          <p className="mt-1 text-xs text-stone-500">
            La que generaste para pedir el certificado. Se guarda cifrada y no se vuelve a mostrar.
          </p>
        </div>
        <button disabled={pendiente} className="boton-primario">
          {reemplaza ? "Reemplazar credenciales" : "Guardar credenciales"}
        </button>
        {estado?.ok && <p className="text-xs text-marca-700">{estado.ok}</p>}
      </form>
      <ModalError estado={estado} />
    </>
  );
}

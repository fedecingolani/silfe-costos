"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import {
  LARGO_MAXIMO_MOTIVO,
  efectosAnulacionOrdenPago,
  textoChequesNoDevolvibles,
  validarMotivoAnulacion,
  type ChequeDeLaOrden,
} from "@/lib/compras/pagos/anulacion";
import { anularOrdenPago } from "../acciones";

/**
 * "Anular orden": pide el motivo, explica qué pasa al anularla y llama a
 * anular_orden_pago. Si algún cheque ya no puede volver a la cartera, lo
 * dice antes y no deja confirmar (la base lo controla igual: OP010). Los
 * errores de la base, en un diálogo.
 */
export function AnularOrdenPago({ id, numero, cheques }: { id: string; numero: string; cheques: ChequeDeLaOrden[] }) {
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [falla, setFalla] = useState<{ error?: string } | undefined>(undefined);
  const bloqueo = textoChequesNoDevolvibles(cheques);
  const efectos = efectosAnulacionOrdenPago({ numero, chequesTerceros: cheques.length });

  function abrir() {
    setErrorMotivo(null);
    dialogo.current?.showModal();
  }

  function cerrar() {
    if (pendiente) return;
    dialogo.current?.close();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const error = validarMotivoAnulacion(motivo);
    if (error) {
      setErrorMotivo(error);
      return;
    }
    setErrorMotivo(null);
    iniciar(async () => {
      const resultado = await anularOrdenPago(id, motivo);
      dialogo.current?.close();
      if (resultado.error) {
        setFalla({ error: resultado.error });
        return;
      }
      router.replace(`/compras/pagos/${id}?aviso=anulado`);
    });
  }

  return (
    <>
      <button type="button" onClick={abrir} className="boton-peligro">
        Anular orden
      </button>
      <dialog
        ref={dialogo}
        onCancel={(e) => {
          if (pendiente) e.preventDefault();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <form onSubmit={onSubmit} noValidate className="w-[min(32rem,90vw)] space-y-3 p-5">
          <h2 className="text-sm font-semibold text-stone-900">Anular la orden de pago {numero}</h2>
          <div className="text-sm text-stone-600">
            <p>Al anularla:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {efectos.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <p className="mt-2">No se puede deshacer.</p>
          </div>
          {bloqueo && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {bloqueo}
            </p>
          )}
          <label className="block">
            <span className="etiqueta">Motivo *</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={LARGO_MAXIMO_MOTIVO}
              required
              className="campo"
              placeholder="Por ejemplo: cargada al proveedor equivocado"
            />
          </label>
          {errorMotivo && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMotivo}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={cerrar} disabled={pendiente} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={pendiente || Boolean(bloqueo)} className="boton-peligro flex-1">
              {pendiente ? "Anulando…" : "Anular orden"}
            </button>
          </div>
        </form>
      </dialog>
      <ModalError estado={falla} titulo="No se pudo anular" />
    </>
  );
}

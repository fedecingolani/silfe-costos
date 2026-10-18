"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  LARGO_MAXIMO_MOTIVO,
  efectosAnulacion,
  textoChequesFueraDeCartera,
  validarMotivoAnulacion,
  type ChequeDelRecibo,
} from "@/lib/cobranzas/anulacion";
import { anularRecibo } from "../acciones";

/**
 * "Anular recibo": pide el motivo, explica qué pasa al anularlo y llama a
 * anular_recibo. Si algún cheque ya salió de la cartera, lo dice antes y no
 * deja confirmar (la base lo controla igual: CB010).
 */
export function AnularRecibo({
  id,
  numero,
  contado,
  cheques,
}: {
  id: string;
  numero: string;
  contado: boolean;
  cheques: ChequeDelRecibo[];
}) {
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bloqueo = textoChequesFueraDeCartera(cheques);
  const efectos = efectosAnulacion({ numero, contado, cheques: cheques.length });

  function abrir() {
    setError(null);
    dialogo.current?.showModal();
  }

  function cerrar() {
    if (pendiente) return;
    dialogo.current?.close();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errorMotivo = validarMotivoAnulacion(motivo);
    if (errorMotivo) {
      setError(errorMotivo);
      return;
    }
    setError(null);
    iniciar(async () => {
      const resultado = await anularRecibo(id, motivo);
      if (resultado.error) {
        setError(resultado.error);
        return;
      }
      dialogo.current?.close();
      router.replace(`/cobranzas/${id}?aviso=anulado`);
    });
  }

  return (
    <>
      <button type="button" onClick={abrir} className="boton-peligro">
        Anular recibo
      </button>
      <dialog
        ref={dialogo}
        onCancel={(e) => {
          if (pendiente) e.preventDefault();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <form onSubmit={onSubmit} noValidate className="w-[min(32rem,90vw)] space-y-3 p-5">
          <h2 className="text-sm font-semibold text-stone-900">Anular el recibo {numero}</h2>
          <div className="text-sm text-stone-600">
            <p>Al anularlo:</p>
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
              placeholder="Por ejemplo: cargado al cliente equivocado"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={cerrar} disabled={pendiente} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={pendiente || Boolean(bloqueo)} className="boton-peligro flex-1">
              {pendiente ? "Anulando…" : "Anular recibo"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

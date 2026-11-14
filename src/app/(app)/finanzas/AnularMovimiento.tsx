"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LARGO_MAXIMO_MOTIVO, validarMotivoAnulacion } from "@/lib/cobranzas/anulacion";
import type { TipoCuentaFondos } from "@/lib/tipos";
import { anularAjuste, anularTransferencia } from "./acciones";

/**
 * "Anular" un ajuste o una transferencia vigente: pide el motivo. Deja de
 * contar en el saldo (una transferencia, en las dos cuentas) y no se puede
 * deshacer. Una transferencia se anula desde cualquiera de sus cuentas.
 */
export function AnularMovimiento({
  origenId,
  cuentaId,
  tipoCuenta,
  descripcion,
  transferencia = false,
}: {
  /** Id del ajuste o de la transferencia (origen_id del movimiento). */
  origenId: string;
  cuentaId: string;
  tipoCuenta: TipoCuentaFondos;
  descripcion: string;
  transferencia?: boolean;
}) {
  const sujeto = transferencia ? "la transferencia" : "el ajuste";
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  function abrir() {
    setError(null);
    setMotivo("");
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
    iniciar(async () => {
      const resultado = transferencia
        ? await anularTransferencia(origenId, cuentaId, motivo)
        : await anularAjuste(origenId, cuentaId, tipoCuenta, motivo);
      if (resultado.error) {
        setError(resultado.error);
        return;
      }
      dialogo.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={abrir} className="text-xs text-red-700 hover:underline">
        Anular
      </button>
      <dialog
        ref={dialogo}
        onCancel={(e) => {
          if (pendiente) e.preventDefault();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <form onSubmit={onSubmit} noValidate className="w-[min(32rem,90vw)] space-y-3 whitespace-normal p-5 text-left">
          <h2 className="text-sm font-semibold text-stone-900">
            Anular {sujeto} «{descripcion}»
          </h2>
          <p className="text-sm text-stone-600">
            {transferencia
              ? "Deja de contar en el saldo de las dos cuentas."
              : "Deja de contar en el saldo de la cuenta."}{" "}
            Queda registrado con el motivo y no se puede deshacer.
          </p>
          <label className="block">
            <span className="etiqueta">Motivo *</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={LARGO_MAXIMO_MOTIVO}
              required
              className="campo"
              placeholder="Por ejemplo: importe mal cargado"
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
            <button type="submit" disabled={pendiente} className="boton-peligro flex-1">
              {pendiente ? "Anulando…" : transferencia ? "Anular transferencia" : "Anular ajuste"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

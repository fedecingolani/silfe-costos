"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TipoCuentaFondos } from "@/lib/tipos";
import { registrarAjuste } from "./acciones";

/**
 * "Registrar ajuste": un ingreso o un egreso manual de la cuenta, con
 * fecha, importe, concepto y observación. También es la forma de cargar el
 * saldo inicial. No se edita después: se anula.
 */
export function RegistrarAjuste({
  cuentaId,
  tipoCuenta,
  hoy,
}: {
  cuentaId: string;
  tipoCuenta: TipoCuentaFondos;
  hoy: string;
}) {
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function abrir() {
    setError(null);
    formulario.current?.reset();
    dialogo.current?.showModal();
  }

  function cerrar() {
    if (pendiente) return;
    dialogo.current?.close();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    iniciar(async () => {
      const resultado = await registrarAjuste(cuentaId, tipoCuenta, datos);
      if (resultado.error) {
        setError(resultado.error);
        return;
      }
      setError(null);
      dialogo.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={abrir} className="boton-primario">
        + Registrar ajuste
      </button>
      <dialog
        ref={dialogo}
        onCancel={(e) => {
          if (pendiente) e.preventDefault();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <form ref={formulario} onSubmit={onSubmit} noValidate className="w-[min(32rem,90vw)] space-y-3 p-5">
          <h2 className="text-sm font-semibold text-stone-900">Registrar ajuste</h2>
          <p className="text-xs text-stone-500">
            El saldo inicial de la cuenta se carga como un ingreso. Un ajuste no se edita: si está mal, se anula y se
            carga otro.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta" htmlFor="ajuste-fecha">
                Fecha *
              </label>
              <input id="ajuste-fecha" name="fecha" type="date" defaultValue={hoy} required className="campo" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="ajuste-tipo">
                Tipo *
              </label>
              <select id="ajuste-tipo" name="tipo" defaultValue="ingreso" className="campo">
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
          </div>
          <div>
            <label className="etiqueta" htmlFor="ajuste-importe">
              Importe *
            </label>
            <input
              id="ajuste-importe"
              name="importe"
              inputMode="decimal"
              required
              placeholder="0,00"
              className="campo text-right"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ajuste-concepto">
              Concepto *
            </label>
            <input
              id="ajuste-concepto"
              name="concepto"
              required
              placeholder="Por ejemplo: Saldo inicial"
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ajuste-observacion">
              Observación
            </label>
            <textarea id="ajuste-observacion" name="observacion" rows={2} className="campo" />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={cerrar} disabled={pendiente} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={pendiente} className="boton-primario flex-1">
              {pendiente ? "Guardando…" : "Registrar ajuste"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CuentaElegible } from "@/lib/finanzas/medios";
import { gruposCuentasDestino } from "@/lib/finanzas/transferencias";
import { registrarTransferencia } from "./acciones";

/**
 * "Transferir": pasa plata de esta cuenta a otra de la empresa (depositar
 * efectivo en un banco, extraer de un banco, pasar entre bancos o entre
 * cajas). Egreso aquí e ingreso en el destino. No se edita: se anula.
 */
export function RegistrarTransferencia({
  cuentaId,
  cuentas,
  hoy,
}: {
  cuentaId: string;
  /** Cuentas activas (bancos y cajas); la de esta pantalla se descarta. */
  cuentas: readonly CuentaElegible[];
  hoy: string;
}) {
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const grupos = gruposCuentasDestino(cuentas, cuentaId);

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
      const resultado = await registrarTransferencia(cuentaId, datos);
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
      <button type="button" onClick={abrir} className="boton-secundario">
        Transferir
      </button>
      <dialog
        ref={dialogo}
        onCancel={(e) => {
          if (pendiente) e.preventDefault();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <form
          ref={formulario}
          onSubmit={onSubmit}
          noValidate
          className="w-[min(32rem,90vw)] space-y-3 whitespace-normal p-5 text-left"
        >
          <h2 className="text-sm font-semibold text-stone-900">Transferir a otra cuenta</h2>
          <p className="text-xs text-stone-500">
            Sale de esta cuenta y entra en la de destino, en la misma fecha. Sirve para depositar efectivo, extraer o
            pasar entre bancos o entre cajas. No se edita: si está mal, se anula y se carga otra.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta" htmlFor="transferencia-fecha">
                Fecha *
              </label>
              <input id="transferencia-fecha" name="fecha" type="date" defaultValue={hoy} required className="campo" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="transferencia-importe">
                Importe *
              </label>
              <input
                id="transferencia-importe"
                name="importe"
                inputMode="decimal"
                required
                placeholder="0,00"
                className="campo text-right"
              />
            </div>
          </div>
          <div>
            <label className="etiqueta" htmlFor="transferencia-destino">
              Cuenta destino *
            </label>
            <select id="transferencia-destino" name="cuenta_destino_id" defaultValue="" required className="campo">
              <option value="">Elegí…</option>
              {grupos.map((g) => (
                <optgroup key={g.etiqueta} label={g.etiqueta}>
                  {g.cuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {grupos.length === 0 && (
              <span className="mt-1 block text-xs text-amber-700">
                No hay otra cuenta activa: creá una en{" "}
                <Link href="/bancos" className="text-marca-700 hover:underline">
                  Bancos
                </Link>{" "}
                o en{" "}
                <Link href="/caja" className="text-marca-700 hover:underline">
                  Caja
                </Link>
                .
              </span>
            )}
          </div>
          <div>
            <label className="etiqueta" htmlFor="transferencia-concepto">
              Concepto
            </label>
            <input
              id="transferencia-concepto"
              name="concepto"
              placeholder="Por ejemplo: Depósito de efectivo"
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="transferencia-observacion">
              Observación
            </label>
            <textarea id="transferencia-observacion" name="observacion" rows={2} className="campo" />
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
              {pendiente ? "Guardando…" : "Transferir"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

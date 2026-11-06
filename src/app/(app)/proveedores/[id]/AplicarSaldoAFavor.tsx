"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { resumenAplicacion } from "@/lib/compras/cuenta-corriente/cuenta-corriente";
import { aplicarSaldoAFavor } from "./acciones-cuenta-corriente";

/**
 * "Aplicar saldo a favor" de un débito pendiente: confirma cuánto se aplica
 * y cuánto queda, y llama a aplicar_saldo_a_favor_compra. Las imputaciones
 * no se deshacen desde acá: se anula la nota de crédito o la orden de pago.
 * Los errores de la base, en un diálogo.
 */
export function AplicarSaldoAFavor({
  proveedorId,
  comprobanteId,
  numeroTexto,
  saldo,
  aFavor,
}: {
  proveedorId: string;
  comprobanteId: string;
  numeroTexto: string;
  saldo: number;
  aFavor: number;
}) {
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [falla, setFalla] = useState<{ error?: string } | undefined>(undefined);

  function cerrar() {
    if (pendiente) return;
    dialogo.current?.close();
  }

  function aplicar() {
    iniciar(async () => {
      const resultado = await aplicarSaldoAFavor(proveedorId, comprobanteId);
      dialogo.current?.close();
      if (resultado.error) {
        setFalla({ error: resultado.error });
        return;
      }
      router.refresh();
    });
  }

  // Va dentro de una celda de tabla (nowrap, alineada a la derecha): los diálogos no heredan eso.
  return (
    <span className="whitespace-normal text-left">
      <button
        type="button"
        onClick={() => dialogo.current?.showModal()}
        className="whitespace-nowrap text-xs text-marca-700 hover:underline"
      >
        Aplicar saldo a favor
      </button>
      <dialog
        ref={dialogo}
        onCancel={(e) => {
          if (pendiente) e.preventDefault();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <div className="w-[min(28rem,90vw)] space-y-3 p-5">
          <h2 className="text-sm font-semibold text-stone-900">Aplicar saldo a favor a {numeroTexto}</h2>
          <p className="text-sm text-stone-600">{resumenAplicacion(numeroTexto, saldo, aFavor)}</p>
          <p className="text-sm text-stone-600">
            Se usan primero los créditos más viejos (órdenes de pago y notas de crédito). Para deshacerlo, hay que anular
            la nota de crédito o la orden de pago.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={cerrar} disabled={pendiente} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="button" onClick={aplicar} disabled={pendiente} className="boton-primario flex-1">
              {pendiente ? "Aplicando…" : "Aplicar"}
            </button>
          </div>
        </div>
      </dialog>
      <ModalError estado={falla} titulo="No se pudo aplicar el saldo a favor" />
    </span>
  );
}

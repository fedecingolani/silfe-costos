"use client";

import { useEffect, useRef } from "react";

export function ModalError({
  estado,
  titulo = "No se pudo guardar",
}: {
  estado?: { error?: string };
  /** Qué falló, para acciones que no son guardar (anular, emitir…). */
  titulo?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (estado?.error) ref.current?.showModal();
  }, [estado]);

  return (
    <dialog
      ref={ref}
      className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
    >
      <div className="max-w-sm p-5">
        <p className="text-sm font-semibold text-red-700">{titulo}</p>
        <p className="mt-2 text-sm text-stone-600">{estado?.error}</p>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="boton-secundario mt-4 w-full"
        >
          Entendido
        </button>
      </div>
    </dialog>
  );
}

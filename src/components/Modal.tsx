"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function Modal({
  boton,
  titulo,
  children,
  abierto = false,
  hrefAlCerrar,
}: {
  boton?: string;
  titulo: string;
  children: ReactNode;
  abierto?: boolean;
  hrefAlCerrar?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (abierto) ref.current?.showModal();
  }, [abierto]);

  function cerrar() {
    ref.current?.close();
    if (hrefAlCerrar) router.push(hrefAlCerrar);
  }

  return (
    <>
      {boton && (
        <button type="button" onClick={() => ref.current?.showModal()} className="boton-primario">
          {boton}
        </button>
      )}
      <dialog
        ref={ref}
        onClose={() => {
          if (hrefAlCerrar) router.push(hrefAlCerrar);
        }}
        onClick={(e) => {
          if (e.target === ref.current) cerrar();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <div className="max-h-[85vh] w-[min(32rem,90vw)] overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900">{titulo}</h2>
            <button type="button" onClick={cerrar} className="text-stone-400 hover:text-stone-600" aria-label="Cerrar">
              ✕
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}

"use client";

import { useRef } from "react";

/**
 * Botón que pide confirmación en un diálogo antes de hacer algo que no se
 * deshace (emitir, anular, borrar).
 */
export function Confirmacion({
  boton,
  clase,
  titulo,
  mensaje,
  confirmar,
  claseConfirmar = "boton-primario",
  deshabilitado = false,
  ayuda,
  onConfirmar,
}: {
  boton: string;
  /** Clase del botón que abre el diálogo. */
  clase: string;
  titulo: string;
  mensaje: string;
  /** Texto del botón que confirma. */
  confirmar: string;
  claseConfirmar?: string;
  deshabilitado?: boolean;
  /** Ayuda del botón (p. ej. por qué está deshabilitado). */
  ayuda?: string;
  onConfirmar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        disabled={deshabilitado}
        title={ayuda}
        onClick={() => ref.current?.showModal()}
        className={clase}
      >
        {boton}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <div className="max-w-sm p-5">
          <p className="text-sm font-semibold text-stone-900">{titulo}</p>
          <p className="mt-2 text-sm text-stone-600">{mensaje}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                ref.current?.close();
                onConfirmar();
              }}
              className={`${claseConfirmar} flex-1`}
            >
              {confirmar}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

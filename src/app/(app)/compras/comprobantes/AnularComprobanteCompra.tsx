"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { Confirmacion } from "../../remitos/Confirmacion";
import { anularComprobanteCompra, type ResultadoComprobanteCompra } from "./acciones";

/** Botón «Anular» de un comprobante confirmado, con confirmación; los errores de la base en un diálogo. */
export function AnularComprobanteCompra({ id }: { id: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoComprobanteCompra | undefined>(undefined);

  return (
    <>
      <Confirmacion
        boton="Anular"
        clase="boton-peligro"
        titulo="¿Anular el comprobante?"
        mensaje="Conserva sus datos, pero deja de contar. El número queda libre para volver a cargarlo."
        confirmar="Anular"
        claseConfirmar="boton-peligro"
        deshabilitado={pendiente}
        onConfirmar={() =>
          iniciar(async () => {
            const r = await anularComprobanteCompra(id);
            if (r.error) {
              setResultado({ error: r.error });
              return;
            }
            router.refresh();
          })
        }
      />
      <ModalError estado={resultado} titulo="No se pudo anular" />
    </>
  );
}

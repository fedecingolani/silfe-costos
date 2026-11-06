"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { permisosRemito } from "@/lib/remitos/editor";
import type { EstadoRemito } from "@/lib/tipos";
import { anularRemito, borrarRemito, emitirRemito, type ResultadoRemito } from "./acciones";
import { Confirmacion } from "./Confirmacion";

const AVISO_SIN_GUARDAR = "Guardá los cambios antes de emitir o facturar.";
const AVISO_PDF_SIN_GUARDAR = "Guardá los cambios antes de imprimir: el PDF sale de lo guardado.";

/**
 * Acciones de un remito según su estado (permisosRemito): emitir, facturar,
 * imprimir (PDF), anular y borrar. Emitir, anular y borrar piden confirmación; los errores
 * de la base se muestran en un diálogo. Con cambios sin guardar en el
 * editor no se emite, ni se factura, ni se imprime (se haría sobre lo guardado).
 */
export function AccionesRemito({
  id,
  clienteId,
  estado,
  sinCambios = true,
}: {
  id: string;
  clienteId: string;
  estado: EstadoRemito;
  sinCambios?: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoRemito | undefined>(undefined);
  const permisos = permisosRemito(estado);

  function ejecutar(accion: (id: string) => Promise<ResultadoRemito>) {
    iniciar(async () => {
      const r = await accion(id);
      if (r?.error) {
        // Objeto nuevo en cada error: el diálogo se vuelve a abrir aunque el mensaje se repita.
        setResultado({ error: r.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {permisos.puedeEmitir && (
        <Confirmacion
          boton="Emitir"
          clase="boton-secundario"
          titulo="¿Emitir el remito?"
          mensaje="Toma el próximo número del punto de venta. Después no se puede borrar: sólo anular."
          confirmar="Emitir"
          deshabilitado={pendiente || !sinCambios}
          ayuda={sinCambios ? undefined : AVISO_SIN_GUARDAR}
          onConfirmar={() => ejecutar(emitirRemito)}
        />
      )}
      {permisos.puedeFacturar &&
        (sinCambios ? (
          <Link href={`/remitos/facturar?cliente=${clienteId}`} className="boton-secundario">
            Facturar
          </Link>
        ) : (
          <button type="button" disabled title={AVISO_SIN_GUARDAR} className="boton-secundario">
            Facturar
          </button>
        ))}
      {permisos.puedeImprimir &&
        (sinCambios ? (
          <a href={`/remitos/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="boton-secundario">
            PDF
          </a>
        ) : (
          <button type="button" disabled title={AVISO_PDF_SIN_GUARDAR} className="boton-secundario">
            PDF
          </button>
        ))}
      {permisos.puedeAnular && (
        <Confirmacion
          boton="Anular"
          clase="boton-peligro"
          titulo="¿Anular el remito?"
          mensaje="Conserva el número, pero ya no se puede editar ni facturar."
          confirmar="Anular"
          claseConfirmar="boton-peligro"
          deshabilitado={pendiente}
          onConfirmar={() => ejecutar(anularRemito)}
        />
      )}
      {permisos.puedeBorrar && (
        <Confirmacion
          boton="Borrar"
          clase="boton-peligro"
          titulo="¿Borrar el remito?"
          mensaje="Se borra el borrador con sus ítems. No se puede deshacer."
          confirmar="Borrar"
          claseConfirmar="boton-peligro"
          deshabilitado={pendiente}
          onConfirmar={() => ejecutar(borrarRemito)}
        />
      )}
      <ModalError estado={resultado} titulo="No se pudo completar la acción" />
    </>
  );
}

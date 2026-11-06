"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { permisosRemitoCompra, type EstadoVisibleRemitoCompra } from "@/lib/compras/remitos/listado";
import { Confirmacion } from "../../remitos/Confirmacion";
import {
  anularRemitoCompra,
  borrarRemitoCompra,
  recibirRemitoCompra,
  type ResultadoRemitoCompra,
} from "./acciones";

const AVISO_SIN_GUARDAR = "Guardá los cambios antes de recibir el remito.";

/**
 * Acciones de un remito de compra según su estado (permisosRemitoCompra):
 * recibir, facturar, anular y borrar. Recibir, anular y borrar piden
 * confirmación; facturar abre la pantalla de facturación con los renglones
 * del remito elegidos (ahí se confirma). Los errores de la base se muestran
 * en un diálogo. Con cambios sin guardar en el editor no se recibe (se
 * haría sobre lo guardado).
 */
export function AccionesRemitoCompra({
  id,
  proveedorId,
  estado,
  sinCambios = true,
}: {
  id: string;
  proveedorId: string;
  estado: EstadoVisibleRemitoCompra;
  sinCambios?: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoRemitoCompra | undefined>(undefined);
  const [titulo, setTitulo] = useState("No se pudo completar la acción");
  const permisos = permisosRemitoCompra(estado);

  function ejecutar(accion: (id: string) => Promise<ResultadoRemitoCompra>, tituloError: string) {
    iniciar(async () => {
      const r = await accion(id);
      if (r?.error) {
        setTitulo(tituloError);
        // Objeto nuevo en cada error: el diálogo se vuelve a abrir aunque el mensaje se repita.
        setResultado({ error: r.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {permisos.puedeRecibir && (
        <Confirmacion
          boton="Recibir"
          clase="boton-secundario"
          titulo="¿Registrar el remito como recibido?"
          mensaje="Después no se puede modificar ni borrar: sólo facturar o anular. Todos los artículos tienen que tener materia prima."
          confirmar="Recibir"
          deshabilitado={pendiente || !sinCambios}
          ayuda={sinCambios ? undefined : AVISO_SIN_GUARDAR}
          onConfirmar={() => ejecutar(recibirRemitoCompra, "No se pudo recibir el remito")}
        />
      )}
      {permisos.puedeFacturar && (
        <Link href={`/compras/remitos/facturar?proveedor=${proveedorId}&remito=${id}`} className="boton-secundario">
          Facturar
        </Link>
      )}
      {permisos.puedeAnular && (
        <Confirmacion
          boton="Anular"
          clase="boton-peligro"
          titulo="¿Anular el remito?"
          mensaje="Conserva sus datos y deja libre el número, pero ya no se puede facturar."
          confirmar="Anular"
          claseConfirmar="boton-peligro"
          deshabilitado={pendiente}
          onConfirmar={() => ejecutar(anularRemitoCompra, "No se pudo anular el remito")}
        />
      )}
      {permisos.puedeBorrar && (
        <Confirmacion
          boton="Borrar"
          clase="boton-peligro"
          titulo="¿Borrar el remito?"
          mensaje="Se borra el borrador con sus renglones. No se puede deshacer."
          confirmar="Borrar"
          claseConfirmar="boton-peligro"
          deshabilitado={pendiente}
          onConfirmar={() => ejecutar(borrarRemitoCompra, "No se pudo borrar el remito")}
        />
      )}
      <ModalError estado={resultado} titulo={titulo} />
    </>
  );
}

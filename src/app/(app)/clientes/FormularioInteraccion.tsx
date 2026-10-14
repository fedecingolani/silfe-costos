"use client";

import Link from "next/link";
import { useActionState, useState, type ChangeEvent } from "react";
import { ModalError } from "@/components/ModalError";
import {
  ETIQUETAS_SENTIDO_INTERACCION,
  ETIQUETAS_TIPO_INTERACCION,
  SENTIDOS_INTERACCION,
  TIPOS_INTERACCION,
  type ClienteContacto,
  type ClienteInteraccion,
} from "@/lib/tipos";
import { fechaLocalArgentina } from "@/lib/clientes/seguimiento";
import type { EstadoFormularioCliente } from "./acciones";

type AccionConEstado = (
  estado: EstadoFormularioCliente,
  formData: FormData,
) => Promise<EstadoFormularioCliente>;

type Valores = {
  tipo: string;
  sentido: string;
  fecha: string;
  contacto_id: string;
  resumen: string;
  notas: string;
  proximo_contacto: string;
  proxima_accion: string;
};

function valoresIniciales(interaccion: ClienteInteraccion | undefined, ahora: string): Valores {
  return {
    tipo: interaccion?.tipo ?? "LLAMADO",
    sentido: interaccion?.sentido ?? "SALIENTE",
    fecha: interaccion ? fechaLocalArgentina(interaccion.fecha) : ahora,
    contacto_id: interaccion?.contacto_id ?? "",
    resumen: interaccion?.resumen ?? "",
    notas: interaccion?.notas ?? "",
    proximo_contacto: interaccion?.proximo_contacto ?? "",
    proxima_accion: interaccion?.proxima_accion ?? "",
  };
}

/**
 * Registro y edición de una interacción con el cliente. Se usa en la ficha
 * del cliente y en la pantalla de seguimiento (`volver` dice a dónde ir al
 * guardar).
 */
export function FormularioInteraccion({
  clienteId,
  accion,
  interaccion,
  contactos,
  ahora,
  volver,
  cancelarHref,
}: {
  clienteId: string;
  accion: AccionConEstado;
  interaccion?: ClienteInteraccion;
  /** Contactos de este cliente. */
  contactos: Pick<ClienteContacto, "id" | "nombre" | "cargo">[];
  /** Fecha y hora por defecto (YYYY-MM-DDTHH:mm, hora argentina) para una interacción nueva. */
  ahora: string;
  volver?: string;
  cancelarHref?: string;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  // Campos controlados: React 19 limpia los no controlados después de cada envío,
  // y un error del servidor no debe borrar lo que se cargó.
  const [valores, setValores] = useState(() => valoresIniciales(interaccion, ahora));
  function cambiar(e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    // Se lee antes del setter: currentTarget se vacía al terminar el evento.
    const campo = e.currentTarget;
    setValores((actuales) => ({ ...actuales, [campo.name]: campo.value }));
  }
  const sufijo = interaccion?.id ?? clienteId;

  return (
    <>
      <form action={accionFormulario} className="space-y-3 p-4">
        <input type="hidden" name="cliente_id" value={clienteId} />
        {interaccion && <input type="hidden" name="id" value={interaccion.id} />}
        {volver && <input type="hidden" name="volver" value={volver} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor={`tipo-${sufijo}`}>
              Tipo *
            </label>
            <select id={`tipo-${sufijo}`} name="tipo" value={valores.tipo} onChange={cambiar} className="campo">
              {TIPOS_INTERACCION.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETAS_TIPO_INTERACCION[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor={`fecha-${sufijo}`}>
              Fecha y hora *
            </label>
            <input
              id={`fecha-${sufijo}`}
              name="fecha"
              type="datetime-local"
              required
              value={valores.fecha}
              onChange={cambiar}
              className="campo"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor={`sentido-${sufijo}`}>
              Sentido
            </label>
            <select
              id={`sentido-${sufijo}`}
              name="sentido"
              value={valores.sentido}
              onChange={cambiar}
              className="campo"
            >
              {SENTIDOS_INTERACCION.map((s) => (
                <option key={s} value={s}>
                  {ETIQUETAS_SENTIDO_INTERACCION[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor={`contacto-${sufijo}`}>
              Contacto
            </label>
            <select
              id={`contacto-${sufijo}`}
              name="contacto_id"
              value={valores.contacto_id}
              onChange={cambiar}
              className="campo"
            >
              <option value="">—</option>
              {contactos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.cargo ? ` (${c.cargo})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor={`resumen-${sufijo}`}>
            Resumen *
          </label>
          <input
            id={`resumen-${sufijo}`}
            name="resumen"
            required
            value={valores.resumen}
            onChange={cambiar}
            placeholder="Qué se habló o se acordó"
            className="campo"
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor={`notas-${sufijo}`}>
            Notas
          </label>
          <textarea
            id={`notas-${sufijo}`}
            name="notas"
            rows={2}
            value={valores.notas}
            onChange={cambiar}
            className="campo"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="etiqueta" htmlFor={`proximo-${sufijo}`}>
              Próximo contacto
            </label>
            <input
              id={`proximo-${sufijo}`}
              name="proximo_contacto"
              type="date"
              value={valores.proximo_contacto}
              onChange={cambiar}
              className="campo"
            />
          </div>
          <div className="col-span-2">
            <label className="etiqueta" htmlFor={`accion-${sufijo}`}>
              Próxima acción
            </label>
            <input
              id={`accion-${sufijo}`}
              name="proxima_accion"
              value={valores.proxima_accion}
              onChange={cambiar}
              placeholder="Mandar presupuesto, volver a llamar…"
              className="campo"
            />
          </div>
        </div>
        <p className="text-xs text-stone-500">
          La agenda del cliente es la de lo último que se carga: sin fecha de próximo contacto, queda sin
          agenda.
        </p>
        <div className="flex gap-2">
          <button disabled={pendiente} className="boton-primario">
            {interaccion ? "Guardar cambios" : "Registrar contacto"}
          </button>
          {cancelarHref && (
            <Link href={cancelarHref} className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}

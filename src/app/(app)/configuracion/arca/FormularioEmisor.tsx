"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { ModalError } from "@/components/ModalError";
import { enviarSinReiniciar } from "@/lib/formularios";
import { AMBIENTES_ARCA, CONDICIONES_IVA_EMISOR, NOMBRES_AMBIENTE_ARCA, type ArcaEmisor } from "@/lib/tipos";
import type { EstadoFormularioArca } from "./acciones";

type Accion = (estado: EstadoFormularioArca, formData: FormData) => Promise<EstadoFormularioArca>;

export function FormularioEmisor({
  accion,
  emisor,
}: {
  accion: Accion;
  emisor: Omit<ArcaEmisor, "id" | "actualizado_en"> | null;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  // Campos controlados y envío por onSubmit (ver enviarSinReiniciar).
  const [valores, setValores] = useState({
    cuit: emisor?.cuit ?? "",
    razon_social: emisor?.razon_social ?? "",
    condicion_iva: emisor?.condicion_iva ?? "",
    ambiente: emisor?.ambiente ?? "homologacion",
    domicilio_comercial: emisor?.domicilio_comercial ?? "",
    ingresos_brutos: emisor?.ingresos_brutos ?? "",
    inicio_actividades: emisor?.inicio_actividades ?? "",
  });
  const cambiar = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValores((v) => ({ ...v, [e.target.name]: e.target.value }));
  return (
    <>
      <form onSubmit={enviarSinReiniciar(accionFormulario)} className="space-y-3 p-4">
        <div>
          <label className="etiqueta">CUIT *</label>
          <input
            name="cuit"
            required
            inputMode="numeric"
            value={valores.cuit}
            onChange={cambiar}
            placeholder="30-12345678-9"
            className="campo"
          />
        </div>
        <div>
          <label className="etiqueta">Razón social *</label>
          <input name="razon_social" required value={valores.razon_social} onChange={cambiar} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Condición frente al IVA *</label>
          <select name="condicion_iva" required value={valores.condicion_iva} onChange={cambiar} className="campo">
            <option value="" disabled>
              Elegí una
            </option>
            {CONDICIONES_IVA_EMISOR.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Define el comprobante por defecto: Factura A para Responsable Inscripto, Factura C para el resto.
          </p>
        </div>
        <div>
          <label className="etiqueta">Domicilio comercial</label>
          <input
            name="domicilio_comercial"
            value={valores.domicilio_comercial}
            onChange={cambiar}
            className="campo"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Ingresos brutos</label>
            <input name="ingresos_brutos" value={valores.ingresos_brutos} onChange={cambiar} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Inicio de actividades</label>
            <input
              name="inicio_actividades"
              type="date"
              value={valores.inicio_actividades}
              onChange={cambiar}
              className="campo"
            />
          </div>
        </div>
        <p className="-mt-1 text-xs text-stone-500">Se imprimen en el encabezado de los comprobantes.</p>
        <div>
          <label className="etiqueta">Ambiente activo</label>
          <select name="ambiente" value={valores.ambiente} onChange={cambiar} className="campo">
            {AMBIENTES_ARCA.map((a) => (
              <option key={a} value={a}>
                {NOMBRES_AMBIENTE_ARCA[a]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Homologación es el ambiente de pruebas de ARCA: los comprobantes no tienen validez fiscal.
          </p>
        </div>
        <button disabled={pendiente} className="boton-primario">
          Guardar emisor
        </button>
        {estado?.ok && <p className="text-xs text-marca-700">{estado.ok}</p>}
      </form>
      <ModalError estado={estado} />
    </>
  );
}

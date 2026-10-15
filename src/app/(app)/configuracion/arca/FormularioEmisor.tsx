"use client";

import { useActionState } from "react";
import { ModalError } from "@/components/ModalError";
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
  return (
    <>
      <form action={accionFormulario} className="space-y-3 p-4">
        <div>
          <label className="etiqueta">CUIT *</label>
          <input
            name="cuit"
            required
            inputMode="numeric"
            defaultValue={emisor?.cuit ?? ""}
            placeholder="30-12345678-9"
            className="campo"
          />
        </div>
        <div>
          <label className="etiqueta">Razón social *</label>
          <input name="razon_social" required defaultValue={emisor?.razon_social ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Condición frente al IVA *</label>
          <select name="condicion_iva" required defaultValue={emisor?.condicion_iva ?? ""} className="campo">
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
          <label className="etiqueta">Punto de venta *</label>
          <input
            name="punto_venta"
            required
            inputMode="numeric"
            defaultValue={emisor?.punto_venta ?? ""}
            className="campo"
          />
          <p className="mt-1 text-xs text-stone-500">
            El que diste de alta en ARCA para &quot;Web Services&quot; (no el de facturación en línea).
          </p>
        </div>
        <div>
          <label className="etiqueta">Ambiente activo</label>
          <select name="ambiente" defaultValue={emisor?.ambiente ?? "homologacion"} className="campo">
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

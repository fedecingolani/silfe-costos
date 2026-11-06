"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ModalError } from "@/components/ModalError";
import type { ProveedorArticulo } from "@/lib/tipos";
import { enviarSinReiniciar } from "@/lib/formularios";
import type { EstadoFormularioProveedor } from "../acciones";

/** Acción de servidor que devuelve el error en lugar de lanzarlo (Next lo enmascara en producción). */
type Accion = (estado: EstadoFormularioProveedor, formData: FormData) => Promise<EstadoFormularioProveedor>;

/** Materia prima ofrecida en el selector, con su unidad de compra. */
export type OpcionMateriaPrima = { id: string; codigo: string; nombre: string; unidad_compra: string };

export function FormularioArticulo({
  accion,
  proveedorId,
  materiasPrimas,
  articulo,
  cancelarHref,
}: {
  accion: Accion;
  proveedorId: string;
  materiasPrimas: OpcionMateriaPrima[];
  articulo?: ProveedorArticulo;
  cancelarHref?: string;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  const [materiaPrimaId, setMateriaPrimaId] = useState(articulo?.materia_prima_id ?? "");
  const [unidad, setUnidad] = useState(articulo?.unidad ?? "");
  const unidadCompra = materiasPrimas.find((m) => m.id === materiaPrimaId)?.unidad_compra;

  return (
    <>
      <form onSubmit={enviarSinReiniciar(accionFormulario)} className="space-y-3 p-4">
        <input type="hidden" name="proveedor_id" value={proveedorId} />
        {articulo && <input type="hidden" name="id" value={articulo.id} />}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="etiqueta">Código</label>
            <input name="codigo" defaultValue={articulo?.codigo ?? ""} className="campo" />
          </div>
          <div className="col-span-2">
            <label className="etiqueta">Descripción *</label>
            <input
              name="descripcion"
              required
              defaultValue={articulo?.descripcion ?? ""}
              placeholder="Como figura en la factura"
              className="campo"
            />
          </div>
        </div>
        <div>
          <label className="etiqueta">Materia prima</label>
          <select
            name="materia_prima_id"
            value={materiaPrimaId}
            onChange={(e) => setMateriaPrimaId(e.target.value)}
            className="campo"
          >
            <option value="">Sin materia prima (flete, servicio)</option>
            {materiasPrimas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.codigo} — {m.nombre} ({m.unidad_compra})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Unidad del proveedor</label>
            <input
              name="unidad"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              placeholder="rollo, caja, kg"
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta">Factor de conversión</label>
            <input
              name="factor_conversion"
              inputMode="decimal"
              defaultValue={articulo ? String(articulo.factor_conversion) : ""}
              placeholder="1"
              className="campo"
            />
          </div>
        </div>
        <p className="text-xs text-stone-500">
          {unidadCompra
            ? `Cuántos ${unidadCompra} de la materia prima equivale 1 ${unidad.trim() || "unidad del proveedor"}.`
            : "Cuántas unidades de compra de la materia prima equivale una unidad del proveedor."}{" "}
          Vacío es 1 a 1.
        </p>
        {articulo && (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="activo" defaultChecked={articulo.activo} className="rounded" />
            Activo
          </label>
        )}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={pendiente} className="boton-primario">
            {articulo ? "Guardar cambios" : "Agregar artículo"}
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

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { NOMBRES_ACCION_CHEQUE, type AccionCheque, type DatosCambioCheque } from "@/lib/cobranzas/cartera";
import { cambiarEstadoCheque, type ResultadoCheque } from "../acciones";

/**
 * Cambios de estado del cheque: las acciones que admite su estado actual.
 * Depositar (fecha y observación), entregar (a quién, fecha y observación) y
 * rechazar (fecha, observación y gastos bancarios opcionales). El rechazo
 * crea la nota de débito y abre su editor.
 */
export function AccionesCheque({
  id,
  acciones,
  hoy,
  previaRechazo,
}: {
  id: string;
  acciones: AccionCheque[];
  hoy: string;
  /** Qué nota de débito se va a crear, o por qué no se puede. */
  previaRechazo: { texto: string } | { error: string } | null;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [accion, setAccion] = useState<AccionCheque | null>(null);
  const [resultado, setResultado] = useState<ResultadoCheque | null>(null);

  if (acciones.length === 0) return null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accion) return;
    const form = new FormData(e.currentTarget);
    const valor = (nombre: string) => String(form.get(nombre) ?? "");
    const gastos = valor("gastosImporte").trim();
    const datos: DatosCambioCheque = {
      accion,
      fecha: valor("fecha"),
      observacion: valor("observacion"),
      entregadoA: accion === "entregar" ? valor("entregadoA") : null,
      gastosImporte: accion === "rechazar" && gastos !== "" ? Number(gastos.replace(",", ".")) : null,
      gastosDescripcion: accion === "rechazar" ? valor("gastosDescripcion") : null,
    };
    if (accion === "rechazar" && !confirm("¿Rechazar el cheque? Se crea la nota de débito al cliente y no se puede deshacer.")) {
      return;
    }
    iniciar(async () => {
      const r = await cambiarEstadoCheque(id, JSON.stringify(datos));
      if (r?.error) {
        setResultado(r);
        return;
      }
      setResultado(r ?? null);
      setAccion(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {acciones.map((a) => (
          <button
            key={a}
            type="button"
            disabled={pendiente}
            onClick={() => {
              setAccion(accion === a ? null : a);
              setResultado(null);
            }}
            aria-pressed={accion === a}
            className={a === "rechazar" ? "boton-secundario text-red-700" : "boton-secundario"}
          >
            {NOMBRES_ACCION_CHEQUE[a]}
          </button>
        ))}
      </div>

      {resultado?.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {resultado.error}
        </div>
      )}
      {resultado?.ok && (
        <div role="status" className="rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          {resultado.ok}
        </div>
      )}

      {accion && (
        <form key={accion} onSubmit={onSubmit} noValidate className="tarjeta grid gap-3 p-4 sm:grid-cols-6">
          <h2 className="text-sm font-semibold text-stone-900 sm:col-span-6">{NOMBRES_ACCION_CHEQUE[accion]} el cheque</h2>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="cambio-fecha">
              Fecha
            </label>
            <input id="cambio-fecha" name="fecha" type="date" defaultValue={hoy} required className="campo" />
          </div>
          {accion === "entregar" && (
            <div className="sm:col-span-4">
              <label className="etiqueta" htmlFor="cambio-entregado">
                Entregado a
              </label>
              <input
                id="cambio-entregado"
                name="entregadoA"
                type="text"
                required
                placeholder="Proveedor u otro destinatario"
                className="campo"
              />
            </div>
          )}
          <div className="sm:col-span-6">
            <label className="etiqueta" htmlFor="cambio-observacion">
              Observación
            </label>
            <input id="cambio-observacion" name="observacion" type="text" className="campo" />
          </div>
          {accion === "rechazar" && (
            <>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="cambio-gastos">
                  Gastos bancarios (sin IVA)
                </label>
                <input
                  id="cambio-gastos"
                  name="gastosImporte"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="campo text-right"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="etiqueta" htmlFor="cambio-gastos-descripcion">
                  Descripción de los gastos
                </label>
                <input
                  id="cambio-gastos-descripcion"
                  name="gastosDescripcion"
                  type="text"
                  defaultValue="Gastos bancarios por cheque rechazado"
                  className="campo"
                />
              </div>
              {previaRechazo && (
                <p
                  className={`text-sm sm:col-span-6 ${"error" in previaRechazo ? "text-red-700" : "text-stone-600"}`}
                  role={"error" in previaRechazo ? "alert" : undefined}
                >
                  {"error" in previaRechazo ? previaRechazo.error : previaRechazo.texto}
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-6">
            <button type="submit" disabled={pendiente} className="boton-primario">
              {pendiente ? "Guardando…" : accion === "rechazar" ? "Rechazar y crear la nota de débito" : NOMBRES_ACCION_CHEQUE[accion]}
            </button>
            <button type="button" disabled={pendiente} onClick={() => setAccion(null)} className="boton-secundario">
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

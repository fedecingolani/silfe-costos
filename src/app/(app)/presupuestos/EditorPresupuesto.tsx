"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tarjeta } from "@/components/ui";
import { CamposComerciales, type DatosComerciales } from "@/components/ventas/CamposComerciales";
import { TablaItems } from "@/components/ventas/TablaItems";
import { mapaPrecios } from "@/lib/comprobantes/borrador";
import { validezPorDefecto, type PresupuestoEnviado } from "@/lib/presupuestos/borrador";
import { validezAlCambiarFecha } from "@/lib/presupuestos/editor";
import { filaEnviada, filasIniciales, type FilaItem, type ItemEditable } from "@/lib/ventas/filas";
import type { CondicionPago } from "@/lib/tipos";
import { preciosDeLista, type ClienteEncontrado } from "../comprobantes/acciones";
import { BuscadorCliente } from "../comprobantes/BuscadorCliente";
import type { ContextoEditor } from "../comprobantes/datos";
import { borrarPresupuesto, duplicarPresupuesto, guardarPresupuesto } from "./acciones";

export type PresupuestoEditable = {
  id: string;
  fecha: string;
  valido_hasta: string;
  fecha_vencimiento_pago: string;
  condicion_pago: CondicionPago;
  lista_precio_id: string | null;
  observaciones: string | null;
  cliente: ClienteEncontrado;
  items: ItemEditable[];
};

/**
 * Editor de un presupuesto abierto (o uno nuevo): cliente, campos
 * comerciales con «válido hasta» e ítems. Sin nada fiscal: ni letra, ni
 * punto de venta, ni ARCA.
 */
export function EditorPresupuesto({
  presupuesto,
  contexto,
  precios: preciosIniciales,
  hoy,
}: {
  presupuesto: PresupuestoEditable | null;
  contexto: Pick<ContextoEditor, "listas" | "productos">;
  precios: { producto_id: string | null; precio_final: number }[];
  hoy: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const id = presupuesto?.id ?? null;
  const [mensaje, setMensaje] = useState<{ error?: string; ok?: string } | null>(null);

  const [cliente, setCliente] = useState<ClienteEncontrado | null>(presupuesto?.cliente ?? null);
  const [comerciales, setComerciales] = useState<DatosComerciales>(() => ({
    fecha: presupuesto?.fecha ?? hoy,
    vencimiento: presupuesto?.fecha_vencimiento_pago ?? hoy,
    condicion: presupuesto?.condicion_pago ?? "cuenta_corriente",
    listaId: presupuesto ? presupuesto.lista_precio_id : (contexto.listas[0]?.id ?? null),
    observaciones: presupuesto?.observaciones ?? "",
  }));
  const [validoHasta, setValidoHasta] = useState(presupuesto?.valido_hasta ?? validezPorDefecto(hoy));
  const [precios, setPrecios] = useState(() => mapaPrecios(preciosIniciales));
  const [filas, setFilas] = useState<FilaItem[]>(() => filasIniciales(presupuesto?.items, contexto.productos));

  // ----- Cambios ------------------------------------------------------------

  async function cambiarComerciales(cambios: Partial<DatosComerciales>) {
    if (cambios.fecha !== undefined) {
      setValidoHasta(validezAlCambiarFecha(comerciales.fecha, cambios.fecha, validoHasta));
    }
    setComerciales((actuales) => ({ ...actuales, ...cambios }));
    if ("listaId" in cambios) {
      const nueva = cambios.listaId ?? null;
      setPrecios(mapaPrecios(nueva ? await preciosDeLista(nueva) : []));
    }
  }

  // ----- Acciones -----------------------------------------------------------

  function datos(): string {
    const enviado: PresupuestoEnviado = {
      clienteId: cliente?.id ?? "",
      fecha: comerciales.fecha,
      validoHasta,
      fechaVencimientoPago: comerciales.vencimiento,
      condicionPago: comerciales.condicion,
      listaPrecioId: comerciales.listaId,
      observaciones: comerciales.observaciones,
      items: filas.map(filaEnviada),
    };
    return JSON.stringify(enviado);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMensaje(null);
    iniciar(async () => {
      // Uno nuevo redirige a su dirección; uno editado devuelve "ok".
      const resultado = await guardarPresupuesto(id, datos());
      if (resultado?.error) {
        setMensaje({ error: resultado.error });
        return;
      }
      if (!resultado?.ok) return;
      setMensaje({ ok: resultado.ok });
      router.refresh();
    });
  }

  function borrar() {
    if (!id || !confirm("¿Borrar este presupuesto? No se puede deshacer.")) return;
    iniciar(async () => {
      const resultado = await borrarPresupuesto(id);
      if (resultado?.error) setMensaje({ error: resultado.error });
    });
  }

  function duplicar() {
    if (!id) return;
    iniciar(async () => {
      const resultado = await duplicarPresupuesto(id);
      if (resultado?.error) setMensaje({ error: resultado.error });
    });
  }

  // ----- Pantalla -----------------------------------------------------------

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {mensaje?.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {mensaje.error}
        </div>
      )}
      {mensaje?.ok && (
        <div className="rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          {mensaje.ok}
        </div>
      )}

      <Tarjeta titulo="Cabecera">
        <div className="grid gap-3 p-4 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label className="etiqueta">Cliente *</label>
            <BuscadorCliente cliente={cliente} onCambiar={setCliente} />
            {cliente && (
              <Link href={`/clientes/${cliente.id}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
                Ver ficha del cliente
              </Link>
            )}
          </div>
          <div className="hidden sm:col-span-3 sm:block" />
          <CamposComerciales
            valores={comerciales}
            onCambiar={cambiarComerciales}
            listas={contexto.listas}
            despuesDeFecha={
              <div>
                <label className="etiqueta" htmlFor="valido-hasta">
                  Válido hasta *
                </label>
                <input
                  id="valido-hasta"
                  type="date"
                  value={validoHasta}
                  min={comerciales.fecha}
                  onChange={(e) => setValidoHasta(e.target.value)}
                  className="campo"
                />
              </div>
            }
          />
        </div>
      </Tarjeta>

      <TablaItems filas={filas} onCambiar={setFilas} productos={contexto.productos} precios={precios} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pendiente} className="boton-primario">
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        {id && (
          <>
            <button type="button" disabled={pendiente} onClick={duplicar} className="boton-secundario">
              Duplicar
            </button>
            {/* T5: "Convertir en factura". T6: "PDF". */}
            <button type="button" disabled={pendiente} onClick={borrar} className="boton-peligro ml-auto">
              Borrar
            </button>
          </>
        )}
      </div>
    </form>
  );
}

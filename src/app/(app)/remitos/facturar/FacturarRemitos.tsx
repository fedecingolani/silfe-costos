"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Tarjeta } from "@/components/ui";
import { fecha, numero, pesos } from "@/lib/formato";
import {
  agruparPorRemito,
  armarFacturacion,
  subtotalFacturacion,
  type ItemAFacturar,
  type SeleccionEnviada,
} from "@/lib/remitos/facturacion";
import type { CondicionIva } from "@/lib/tipos";
import { facturarRemitos } from "../acciones";

type PuntoVentaActivo = { numero: number; electronico: boolean };

/**
 * Pantalla de facturación de un cliente: sus ítems pendientes agrupados por
 * remito, con casilla y cantidad a facturar por renglón (por defecto, todo
 * lo pendiente), el punto de venta de la factura y el subtotal en vivo. Los
 * errores de armarFacturacion se muestran mientras se edita; el servidor
 * vuelve a validar todo antes de crear el borrador.
 */
export function FacturarRemitos({
  clienteId,
  condicionIva,
  items: itemsIniciales,
  cantidades,
  puntosVenta,
}: {
  clienteId: string;
  condicionIva: CondicionIva | null;
  items: ItemAFacturar[];
  /** Cantidad del remito y lo ya facturado de cada ítem (no vienen en ItemAFacturar). */
  cantidades: Record<string, { cantidad: number; facturado: number }>;
  puntosVenta: PuntoVentaActivo[];
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState(itemsIniciales);
  // Como en una factura nueva, un punto electrónico si hay; si no, el primero (X).
  const [puntoVenta, setPuntoVenta] = useState<number | null>(
    () => (puntosVenta.find((p) => p.electronico) ?? puntosVenta[0])?.numero ?? null,
  );

  const punto = puntosVenta.find((p) => p.numero === puntoVenta) ?? null;
  const sinIva = punto ? !punto.electronico : false;
  const totales = subtotalFacturacion(items, { sinIva });
  const armado = armarFacturacion(items, {
    puntoVenta: punto ? { ...punto, activo: true } : null,
    condicionIvaCliente: condicionIva,
  });
  const errores = "errores" in armado ? armado.errores : [];
  const grupos = agruparPorRemito(items);

  const cambiar = (ids: ReadonlySet<string>, cambios: Partial<ItemAFacturar>) =>
    setItems((actuales) => actuales.map((i) => (ids.has(i.remitoItemId) ? { ...i, ...cambios } : i)));

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (errores.length > 0 || puntoVenta === null) return;
    const enviados: SeleccionEnviada[] = items.map((i) => ({
      remitoItemId: i.remitoItemId,
      elegido: i.elegido,
      cantidad: i.cantidad,
    }));
    iniciar(async () => {
      const resultado = await facturarRemitos(clienteId, puntoVenta, JSON.stringify(enviados));
      if (resultado?.error) setError(resultado.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {grupos.map((grupo) => {
        const ids = new Set(grupo.items.map((i) => i.remitoItemId));
        const todos = grupo.items.every((i) => i.elegido);
        const alguno = grupo.items.some((i) => i.elegido);
        return (
          <Tarjeta
            key={grupo.remitoId}
            titulo={`Remito ${grupo.numeroRemito}`}
            descripcion={`Del ${fecha(grupo.fechaRemito)}`}
            acciones={
              <Link href={`/remitos/${grupo.remitoId}`} className="text-xs text-marca-700 hover:underline">
                Ver remito
              </Link>
            }
          >
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={todos}
                        ref={(el) => {
                          if (el) el.indeterminate = alguno && !todos;
                        }}
                        onChange={(e) => cambiar(ids, { elegido: e.target.checked })}
                        aria-label={`Elegir todo el remito ${grupo.numeroRemito}`}
                      />
                    </th>
                    <th className="min-w-60">Descripción</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Facturado</th>
                    <th className="text-right">Pendiente</th>
                    <th className="w-32">A facturar</th>
                  </tr>
                </thead>
                <tbody>
                  {grupo.items.map((i) => {
                    const original = cantidades[i.remitoItemId];
                    return (
                      <tr key={i.remitoItemId} className={i.elegido ? "" : "text-stone-400"}>
                        <td>
                          <input
                            type="checkbox"
                            checked={i.elegido}
                            onChange={(e) => cambiar(new Set([i.remitoItemId]), { elegido: e.target.checked })}
                            aria-label={`Facturar ${i.descripcion}`}
                          />
                        </td>
                        <td>
                          {i.codigo && <span className="font-medium tabular-nums">{i.codigo} </span>}
                          {i.descripcion}
                        </td>
                        <td className="text-right tabular-nums">{original ? numero(original.cantidad, 4) : "—"}</td>
                        <td className="text-right tabular-nums">{original ? numero(original.facturado, 4) : "—"}</td>
                        <td className="text-right tabular-nums">{numero(i.pendiente, 4)}</td>
                        <td>
                          <input
                            inputMode="decimal"
                            value={i.cantidad}
                            disabled={!i.elegido}
                            onChange={(e) => cambiar(new Set([i.remitoItemId]), { cantidad: e.target.value })}
                            className="campo text-right"
                            aria-label={`Cantidad a facturar de ${i.descripcion}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        );
      })}

      <Tarjeta titulo="Factura">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="punto-venta">
              Punto de venta *
            </label>
            <select
              id="punto-venta"
              value={puntoVenta ?? ""}
              onChange={(e) => setPuntoVenta(e.target.value ? Number(e.target.value) : null)}
              className="campo"
            >
              {puntosVenta.length === 0 && <option value="">Sin puntos de venta</option>}
              {puntosVenta.map((p) => (
                <option key={p.numero} value={p.numero}>
                  {String(p.numero).padStart(5, "0")}
                  {p.electronico ? "" : " (X, sin ARCA)"}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">
              {sinIva
                ? "Punto no electrónico: factura X, sin ARCA ni IVA."
                : "La letra (A o B) sale de la condición de IVA del cliente."}
            </p>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-500">Neto gravado</dt>
              <dd className="tabular-nums">{pesos(totales.neto)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">No gravado</dt>
              <dd className="tabular-nums">{pesos(totales.noGravado)}</dd>
            </div>
            {totales.ivaPorAlicuota.map((a) => (
              <div key={a.id} className="flex justify-between">
                <dt className="text-stone-500">IVA {numero(a.alicuota, 1)}%</dt>
                <dd className="tabular-nums">{pesos(a.importe)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{pesos(totales.total)}</dd>
            </div>
          </dl>
        </div>
      </Tarjeta>

      {errores.length > 0 && (
        <ul role="status" className="list-disc space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 py-2 pl-8 pr-3 text-sm text-amber-800">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pendiente || errores.length > 0} className="boton-primario">
          {pendiente ? "Creando la factura…" : "Crear borrador de factura"}
        </button>
        <Link href="/remitos" className="boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

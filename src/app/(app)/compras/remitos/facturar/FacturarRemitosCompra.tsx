"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ModalError } from "@/components/ModalError";
import { Tarjeta } from "@/components/ui";
import {
  agruparPorRemito,
  armarFacturacion,
  type CabeceraFacturaEnviada,
  type RenglonAFacturar,
  type SeleccionEnviada,
} from "@/lib/compras/remitos/facturacion";
import { fecha, numero } from "@/lib/formato";
import { LETRAS_COMPRA, type LetraCompra } from "@/lib/tipos";
import { Confirmacion } from "../../../remitos/Confirmacion";
import { facturarRemitosCompra, type ResultadoRemitoCompra } from "../acciones";

/**
 * Facturación de remitos de un proveedor: sus renglones pendientes
 * agrupados por remito, con casilla y cantidad a facturar (por defecto, todo
 * lo pendiente), y la cabecera de la factura del proveedor (letra, punto de
 * venta, número, fechas). Los errores de armarFacturacion se muestran
 * mientras se edita; al confirmar, el servidor vuelve a validar todo, crea
 * el borrador de factura y abre su editor.
 */
export function FacturarRemitosCompra({
  proveedorId,
  letraInicial,
  renglones: renglonesIniciales,
  hoy,
}: {
  proveedorId: string;
  letraInicial: LetraCompra;
  renglones: RenglonAFacturar[];
  hoy: string;
}) {
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoRemitoCompra | undefined>(undefined);
  const [renglones, setRenglones] = useState(renglonesIniciales);
  const [cabecera, setCabecera] = useState<CabeceraFacturaEnviada>({
    letra: letraInicial,
    puntoVenta: "",
    numero: "",
    fecha: hoy,
    fechaVencimiento: "",
    observaciones: "",
  });

  const armado = armarFacturacion(renglones, cabecera);
  const errores = "errores" in armado ? armado.errores : [];
  const grupos = agruparPorRemito(renglones);
  const elegidos = renglones.filter((r) => r.elegido).length;

  const cambiar = (ids: ReadonlySet<string>, cambios: Partial<RenglonAFacturar>) =>
    setRenglones((actuales) => actuales.map((r) => (ids.has(r.remitoItemId) ? { ...r, ...cambios } : r)));
  const cambiarCabecera = (cambios: Partial<CabeceraFacturaEnviada>) => setCabecera((c) => ({ ...c, ...cambios }));

  function facturar() {
    if (errores.length > 0) return;
    const enviados: SeleccionEnviada[] = renglones.map((r) => ({
      remitoItemId: r.remitoItemId,
      elegido: r.elegido,
      cantidad: r.cantidad,
    }));
    iniciar(async () => {
      // Si sale bien, la acción abre el borrador de factura.
      const r = await facturarRemitosCompra(proveedorId, JSON.stringify(cabecera), JSON.stringify(enviados));
      // Objeto nuevo en cada error: el diálogo se vuelve a abrir aunque el mensaje se repita.
      if (r?.error) setResultado({ error: r.error });
    });
  }

  return (
    <div className="space-y-4">
      {grupos.map((grupo) => {
        const ids = new Set(grupo.items.map((r) => r.remitoItemId));
        const todos = grupo.items.every((r) => r.elegido);
        const alguno = grupo.items.some((r) => r.elegido);
        return (
          <Tarjeta
            key={grupo.remitoId}
            titulo={`Remito ${grupo.numeroRemito}`}
            descripcion={`Del ${fecha(grupo.fechaRemito)}`}
            acciones={
              <Link href={`/compras/remitos/${grupo.remitoId}`} className="text-xs text-marca-700 hover:underline">
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
                  {grupo.items.map((r) => (
                    <tr key={r.remitoItemId} className={r.elegido ? "" : "text-stone-400"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.elegido}
                          onChange={(e) => cambiar(new Set([r.remitoItemId]), { elegido: e.target.checked })}
                          aria-label={`Facturar ${r.descripcion}`}
                        />
                      </td>
                      <td>
                        {r.codigo && <span className="font-medium tabular-nums">{r.codigo} </span>}
                        {r.descripcion}
                      </td>
                      <td className="text-right tabular-nums">
                        {numero(r.cantidadRemito, 4)} {r.unidad ?? ""}
                      </td>
                      <td className="text-right tabular-nums">{numero(r.facturada, 4)}</td>
                      <td className="text-right tabular-nums">{numero(r.pendiente, 4)}</td>
                      <td>
                        <input
                          inputMode="decimal"
                          value={r.cantidad}
                          disabled={!r.elegido}
                          onChange={(e) => cambiar(new Set([r.remitoItemId]), { cantidad: e.target.value })}
                          className="campo text-right"
                          aria-label={`Cantidad a facturar de ${r.descripcion}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        );
      })}

      <Tarjeta titulo="Factura del proveedor" descripcion="Los precios se sugieren con el vigente del proveedor; se ajustan en el borrador.">
        <div className="grid gap-3 p-4 sm:grid-cols-6">
          <div>
            <label className="etiqueta" htmlFor="letra">
              Letra *
            </label>
            <select
              id="letra"
              value={cabecera.letra}
              onChange={(e) => cambiarCabecera({ letra: e.target.value })}
              className="campo"
            >
              {LETRAS_COMPRA.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="punto-venta">
              Punto de venta *
            </label>
            <input
              id="punto-venta"
              inputMode="numeric"
              value={cabecera.puntoVenta}
              onChange={(e) => cambiarCabecera({ puntoVenta: e.target.value })}
              placeholder="00001"
              className="campo text-right"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="numero">
              Número *
            </label>
            <input
              id="numero"
              inputMode="numeric"
              value={cabecera.numero}
              onChange={(e) => cambiarCabecera({ numero: e.target.value })}
              placeholder="00000001"
              className="campo text-right"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">
              Fecha *
            </label>
            <input
              id="fecha"
              type="date"
              value={cabecera.fecha}
              onChange={(e) => cambiarCabecera({ fecha: e.target.value })}
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="vencimiento">
              Vencimiento
            </label>
            <input
              id="vencimiento"
              type="date"
              value={cabecera.fechaVencimiento}
              onChange={(e) => cambiarCabecera({ fechaVencimiento: e.target.value })}
              className="campo"
            />
          </div>
          <div className="sm:col-span-6">
            <label className="etiqueta" htmlFor="observaciones">
              Observaciones
            </label>
            <textarea
              id="observaciones"
              rows={2}
              value={cabecera.observaciones}
              onChange={(e) => cambiarCabecera({ observaciones: e.target.value })}
              className="campo"
            />
          </div>
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
        <Confirmacion
          boton={pendiente ? "Creando la factura…" : "Crear borrador de factura"}
          clase="boton-primario"
          titulo="¿Crear el borrador de factura?"
          mensaje={`Se crea una factura en borrador con ${elegidos} ${elegidos === 1 ? "renglón" : "renglones"}. Lo facturado deja de estar pendiente en los remitos mientras la factura no se borre ni se anule.`}
          confirmar="Crear"
          deshabilitado={pendiente || errores.length > 0}
          onConfirmar={facturar}
        />
        <Link href="/compras/remitos" className="boton-secundario">
          Cancelar
        </Link>
      </div>
      <ModalError estado={resultado} titulo="No se pudo facturar" />
    </div>
  );
}

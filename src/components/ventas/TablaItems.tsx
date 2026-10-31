"use client";

import { useMemo } from "react";
import { Tarjeta, Vacio } from "@/components/ui";
import { numero, pesos } from "@/lib/formato";
import { calcularItem, calcularTotales } from "@/lib/comprobantes/calculo";
import { buscarProductos, itemParaCalcular } from "@/lib/comprobantes/borrador";
import { cambiosAlElegirProducto, filaVacia, type FilaItem, type ProductoVendible } from "@/lib/ventas/filas";
import { ALICUOTAS_IVA, NO_GRAVADO } from "@/lib/tipos";

/**
 * Tarjeta "Ítems" de un editor de ventas: renglones con buscador de
 * productos, precio propuesto por la lista, importes en vivo y totales.
 * Controlada: los renglones viven en el editor. Con `sinIva` (comprobante
 * X) no se muestra ni se suma IVA: total = neto + no gravado. La alícuota
 * se sigue eligiendo porque separa lo gravado de lo no gravado.
 */
export function TablaItems({
  filas,
  onCambiar,
  productos,
  precios,
  soloLectura = false,
  sinIva = false,
}: {
  filas: FilaItem[];
  /** Recibe una función que arma los renglones nuevos a partir de los actuales (vale el setState). */
  onCambiar: (actualizar: (actuales: FilaItem[]) => FilaItem[]) => void;
  /** Productos activos para el buscador. */
  productos: ProductoVendible[];
  /** Precio final (sin IVA) por producto de la lista elegida. */
  precios: ReadonlyMap<string, number>;
  soloLectura?: boolean;
  /** Comprobante X: sin IVA. */
  sinIva?: boolean;
}) {
  const productosPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const calculables = filas.map(itemParaCalcular);
  // Sin IVA no hay IVA por alícuota: el pie muestra neto, no gravado y total.
  const totales = calcularTotales(calculables.filter((c) => c !== null), { sinIva });

  const cambiarFila = (clave: string, cambios: Partial<FilaItem>) =>
    onCambiar((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));

  function elegirProducto(clave: string, producto: ProductoVendible) {
    cambiarFila(clave, cambiosAlElegirProducto(producto, precios));
  }

  return (
    <Tarjeta
      titulo="Ítems"
      descripcion="Precios unitarios sin IVA. Al elegir un producto, el precio sale de la lista elegida."
      acciones={
        <button
          type="button"
          disabled={soloLectura}
          onClick={() => onCambiar((f) => [...f, filaVacia()])}
          className="boton-secundario"
        >
          + Agregar ítem
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-72">Producto / descripción</th>
              <th className="w-24">Cantidad</th>
              <th className="w-32">Precio</th>
              <th className="w-20">% dto</th>
              <th className="w-24">{sinIva ? "Alícuota (no se aplica)" : "IVA %"}</th>
              <th className="text-right">Importe</th>
              {!sinIva && <th className="text-right">IVA</th>}
              {!sinIva && <th className="text-right">Total</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <Vacio mensaje="Agregá al menos un ítem." colSpan={sinIva ? 7 : 9} />}
            {filas.map((f, i) => {
              const calculado = calculables[i] ? calcularItem(calculables[i], { sinIva }) : null;
              const producto = f.productoId ? productosPorId.get(f.productoId) : undefined;
              return (
                <tr key={f.clave} className="align-top">
                  <td>
                    <div className="space-y-1">
                      {f.libre ? (
                        <input
                          value={f.descripcion}
                          disabled={soloLectura}
                          onChange={(e) => cambiarFila(f.clave, { descripcion: e.target.value })}
                          placeholder="Descripción del ítem libre"
                          className="campo"
                          aria-label={`Descripción del ítem ${i + 1}`}
                        />
                      ) : f.productoId ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm">
                            <span className="font-medium tabular-nums">{f.codigo}</span> {f.descripcion}
                            {!producto && <span className="ml-1 text-xs text-stone-400">(inactivo)</span>}
                          </span>
                          {!soloLectura && (
                            <button
                              type="button"
                              onClick={() =>
                                cambiarFila(f.clave, {
                                  productoId: null,
                                  codigo: null,
                                  alicuotaProducto: null,
                                  descripcion: "",
                                  aviso: null,
                                })
                              }
                              className="text-xs text-marca-700 hover:underline"
                            >
                              Cambiar
                            </button>
                          )}
                        </div>
                      ) : (
                        <BuscadorProducto
                          productos={productos}
                          texto={f.busqueda}
                          onTexto={(busqueda) => cambiarFila(f.clave, { busqueda })}
                          onElegir={(p) => elegirProducto(f.clave, p)}
                          etiqueta={`Producto del ítem ${i + 1}`}
                          deshabilitado={soloLectura}
                        />
                      )}
                      <input
                        value={f.observaciones}
                        disabled={soloLectura}
                        onChange={(e) => cambiarFila(f.clave, { observaciones: e.target.value })}
                        placeholder="Observaciones (se imprimen debajo)"
                        className="campo text-xs"
                        aria-label={`Observaciones del ítem ${i + 1}`}
                      />
                      <label className="flex items-center gap-1.5 text-xs text-stone-500">
                        <input
                          type="checkbox"
                          checked={f.libre}
                          disabled={soloLectura}
                          onChange={(e) =>
                            cambiarFila(f.clave, {
                              libre: e.target.checked,
                              productoId: null,
                              codigo: null,
                              alicuotaProducto: null,
                              descripcion: "",
                              alicuotaIva: "21",
                              aviso: null,
                            })
                          }
                        />
                        Ítem libre (sin producto)
                      </label>
                      {f.aviso && <p className="text-xs text-amber-700">⚠ {f.aviso}</p>}
                    </div>
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={f.cantidad}
                      disabled={soloLectura}
                      onChange={(e) => cambiarFila(f.clave, { cantidad: e.target.value })}
                      className="campo text-right"
                      aria-label={`Cantidad del ítem ${i + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={f.precioUnitario}
                      disabled={soloLectura}
                      onChange={(e) => cambiarFila(f.clave, { precioUnitario: e.target.value, aviso: null })}
                      className="campo text-right"
                      aria-label={`Precio del ítem ${i + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={f.descuentoPct}
                      disabled={soloLectura}
                      onChange={(e) => cambiarFila(f.clave, { descuentoPct: e.target.value })}
                      className="campo text-right"
                      aria-label={`Descuento del ítem ${i + 1}`}
                    />
                  </td>
                  <td>
                    {f.libre ? (
                      <select
                        value={f.alicuotaIva}
                        disabled={soloLectura}
                        onChange={(e) => cambiarFila(f.clave, { alicuotaIva: e.target.value })}
                        className="campo"
                        aria-label={`Alícuota del ítem ${i + 1}`}
                      >
                        {ALICUOTAS_IVA.map((a) => (
                          <option key={a} value={String(a)}>
                            {numero(a, 1)}%
                          </option>
                        ))}
                        <option value={NO_GRAVADO}>No gravado</option>
                      </select>
                    ) : f.productoId ? (
                      // Un producto lleva su alícuota; sólo se puede pasar a no gravado.
                      <select
                        value={f.alicuotaIva}
                        disabled={soloLectura}
                        onChange={(e) => cambiarFila(f.clave, { alicuotaIva: e.target.value })}
                        className="campo"
                        aria-label={`Alícuota del ítem ${i + 1}`}
                      >
                        {f.alicuotaProducto !== null && (
                          <option value={f.alicuotaProducto}>{numero(Number(f.alicuotaProducto), 1)}%</option>
                        )}
                        <option value={NO_GRAVADO}>No gravado</option>
                      </select>
                    ) : (
                      <span className="tabular-nums">—</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{calculado ? pesos(calculado.importe) : "—"}</td>
                  {!sinIva && (
                    <>
                      <td className="text-right tabular-nums">{calculado ? pesos(calculado.iva) : "—"}</td>
                      <td className="text-right tabular-nums">
                        {calculado ? pesos(calculado.importe + calculado.iva) : "—"}
                      </td>
                    </>
                  )}
                  <td>
                    {!soloLectura && (
                      <button
                        type="button"
                        onClick={() => onCambiar((actuales) => actuales.filter((x) => x.clave !== f.clave))}
                        className="boton-peligro px-2 py-1 text-xs"
                        aria-label={`Quitar el ítem ${i + 1}`}
                      >
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
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
    </Tarjeta>
  );
}

/** Buscador de productos activos por código o nombre (filtra en el navegador). */
export function BuscadorProducto({
  productos,
  texto,
  onTexto,
  onElegir,
  etiqueta,
  deshabilitado = false,
}: {
  productos: ProductoVendible[];
  texto: string;
  onTexto: (texto: string) => void;
  onElegir: (producto: ProductoVendible) => void;
  etiqueta: string;
  deshabilitado?: boolean;
}) {
  const encontrados = buscarProductos(productos, texto);
  return (
    <div className="relative">
      <input
        type="search"
        value={texto}
        disabled={deshabilitado}
        onChange={(e) => onTexto(e.target.value)}
        placeholder="Buscar producto por código o nombre"
        className="campo"
        aria-label={etiqueta}
      />
      {texto.trim() !== "" && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white text-sm shadow-lg">
          {encontrados.length === 0 && <li className="px-3 py-2 text-stone-400">Ningún producto activo coincide.</li>}
          {encontrados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onElegir(p)}
                className="block w-full px-3 py-1.5 text-left hover:bg-marca-50"
              >
                <span className="font-medium tabular-nums">{p.codigo}</span> {p.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

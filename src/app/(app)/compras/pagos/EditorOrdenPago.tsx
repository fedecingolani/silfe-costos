"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { Tarjeta, Vacio } from "@/components/ui";
import { fecha as textoFecha, pesos } from "@/lib/formato";
import { aDecimal } from "@/lib/comprobantes/borrador";
import { aCentavos, sumarPesos } from "@/lib/cobranzas/dinero";
import { erroresImporteImputado, leerImputacionesEditor } from "@/lib/cobranzas/editor";
import {
  completarEnOrden,
  imputacionesDelBorrador,
  saldoAFavor,
  validarImputacionesPago,
  type ImputacionGuardada,
} from "@/lib/compras/pagos/imputacion";
import {
  buscarCheques,
  chequesElegibles,
  importeMedio,
  textoCheque,
  totalMedios,
  validarMedios,
  type ChequeCartera,
  type MedioBorrador,
} from "@/lib/compras/pagos/medios";
import type { OrdenEnviada } from "@/lib/compras/pagos/guardado";
import { NOMBRES_MEDIO_PAGO_COMPRA, TIPOS_MEDIO_PAGO_COMPRA, type TipoMedioPagoCompra } from "@/lib/tipos";
import { borrarOrdenPago, confirmarOrdenPago, cuentaDelProveedor, guardarOrdenPago } from "./acciones";
import type { CuentaProveedor, ProveedorOfrecido } from "./datos";

/** Orden de pago en borrador ya guardada. */
export type OrdenEditable = {
  id: string;
  proveedorId: string;
  fecha: string;
  observaciones: string | null;
  medios: MedioBorrador[];
  imputaciones: ImputacionGuardada[];
};

type FilaMedio = {
  clave: number;
  tipo: TipoMedioPagoCompra;
  importe: string;
  referencia: string;
  chequeId: string;
  /** Búsqueda en la cartera (sólo pantalla). */
  busqueda: string;
  banco: string;
  numero: string;
  fechaPago: string;
};

let siguienteClave = 1;

function filaVacia(tipo: TipoMedioPagoCompra = "efectivo", importe = ""): FilaMedio {
  return { clave: siguienteClave++, tipo, importe, referencia: "", chequeId: "", busqueda: "", banco: "", numero: "", fechaPago: "" };
}

function filaDeMedio(m: MedioBorrador): FilaMedio {
  return {
    ...filaVacia(m.tipo, m.tipo === "cheque_tercero" ? "" : String(m.importe)),
    referencia: m.referencia ?? "",
    chequeId: m.chequeId ?? "",
    banco: m.banco ?? "",
    numero: m.numero ?? "",
    fechaPago: m.fechaPago ?? "",
  };
}

function medioDeFila(f: FilaMedio): MedioBorrador {
  return {
    tipo: f.tipo,
    importe: f.tipo === "cheque_tercero" ? 0 : (aDecimal(f.importe) ?? Number.NaN),
    referencia: f.tipo === "transferencia" ? f.referencia : null,
    chequeId: f.tipo === "cheque_tercero" ? f.chequeId || null : null,
    banco: f.tipo === "cheque_propio" ? f.banco : null,
    numero: f.tipo === "cheque_propio" ? f.numero : null,
    fechaPago: f.tipo === "cheque_propio" ? f.fechaPago || null : null,
  };
}

/** Campo de texto con su etiqueta. */
function Campo({
  etiqueta,
  valor,
  onCambiar,
  tipo = "text",
  className = "",
}: {
  etiqueta: string;
  valor: string;
  onCambiar: (valor: string) => void;
  tipo?: "text" | "date";
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta">{etiqueta}</span>
      <input type={tipo} value={valor} onChange={(e) => onCambiar(e.target.value)} className="campo" />
    </label>
  );
}

/**
 * Editor de una orden de pago: proveedor, medios (efectivo, transferencia,
 * cheques de terceros de la cartera y cheques propios) e imputación a sus
 * facturas y notas de débito con saldo. Lo que no se imputa queda a favor
 * del proveedor. Guarda el borrador entero en una transacción y confirma
 * con confirmación; los errores de la base, en un diálogo.
 */
export function EditorOrdenPago({
  orden,
  proveedores,
  cartera,
  cuentaInicial,
  proveedorInicial = null,
  aImputarInicial = {},
  importeInicial = null,
  hoy,
  aviso = null,
}: {
  orden: OrdenEditable | null;
  proveedores: ProveedorOfrecido[];
  /** Cheques en cartera (y los que ya eligió el borrador). */
  cartera: ChequeCartera[];
  cuentaInicial: CuentaProveedor | null;
  /** Proveedor ya elegido al abrir una orden nueva (`?proveedor=`). */
  proveedorInicial?: string | null;
  /** Imputación precargada desde «Pagar» de un comprobante. */
  aImputarInicial?: Record<string, string>;
  /** Importe del primer medio (efectivo) al llegar desde «Pagar». */
  importeInicial?: number | null;
  hoy: string;
  /** Mensaje que llega por la URL (`?aviso=guardado`). */
  aviso?: string | null;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [id, setId] = useState<string | null>(orden?.id ?? null);
  const [ok, setOk] = useState<string | null>(aviso);
  const [falla, setFalla] = useState<{ error?: string; titulo: string } | undefined>(undefined);
  const [resumen, setResumen] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);
  const confirmacion = useRef<HTMLDialogElement>(null);

  const [proveedorId, setProveedorId] = useState(orden?.proveedorId ?? proveedorInicial ?? "");
  const [fecha, setFecha] = useState(orden?.fecha ?? hoy);
  const [observaciones, setObservaciones] = useState(orden?.observaciones ?? "");
  const [filas, setFilas] = useState<FilaMedio[]>(() =>
    orden && orden.medios.length > 0
      ? orden.medios.map(filaDeMedio)
      : [filaVacia("efectivo", importeInicial ? String(importeInicial) : "")],
  );
  const [cuenta, setCuenta] = useState<CuentaProveedor | null>(cuentaInicial);
  const [cargandoCuenta, setCargandoCuenta] = useState(false);
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null);
  // Cada elección de proveedor tiene su número: sólo la respuesta del último pedido cambia la pantalla.
  const pedidoCuenta = useRef(0);
  // Al reabrir un borrador se quitan (y se avisan) las imputaciones a comprobantes que ya no tienen saldo.
  const [borrador] = useState(() =>
    orden ? imputacionesDelBorrador(orden.imputaciones, cuentaInicial?.debitos ?? null) : null,
  );
  const [aImputar, setAImputar] = useState<Record<string, string>>(() => borrador?.aImputar ?? aImputarInicial);
  const [imputacionesQuitadas, setImputacionesQuitadas] = useState<string[]>(borrador?.avisos ?? []);

  const proveedoresOfrecidos = proveedores.filter((p) => p.activo || p.id === proveedorId);
  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;
  const cheques = useMemo(() => new Map(cartera.map((c) => [c.id, c])), [cartera]);
  const medios = useMemo(() => filas.map(medioDeFila), [filas]);
  const total = useMemo(() => totalMedios(medios, cheques), [medios, cheques]);
  const debitos = useMemo(() => cuenta?.debitos ?? [], [cuenta]);
  const elegidas = useMemo(() => leerImputacionesEditor(aImputar), [aImputar]);
  // Los importes ilegibles bloquean el guardado (ver errores); los totales en vivo usan sólo los legibles.
  const legibles = useMemo(() => elegidas.filter((e) => Number.isFinite(e.importe)), [elegidas]);
  const imputado = sumarPesos(legibles.map((e) => Math.max(e.importe, 0)));
  const aFavor = saldoAFavor(total, legibles);
  const chequesElegidos = filas.map((f) => (f.tipo === "cheque_tercero" ? f.chequeId || null : null));

  const errores = useMemo(() => {
    const lista: string[] = [];
    if (!proveedorId) lista.push("Elegí el proveedor.");
    if (!fecha) lista.push("Indicá una fecha válida.");
    lista.push(...validarMedios(medios, cheques));
    const nombres = new Map(debitos.map((d) => [d.comprobanteId, d.numeroTexto]));
    lista.push(...erroresImporteImputado(elegidas, nombres));
    lista.push(...validarImputacionesPago(debitos, legibles, total));
    return lista;
  }, [proveedorId, fecha, medios, cheques, debitos, elegidas, legibles, total]);

  function cambiarFila(clave: number, cambios: Partial<FilaMedio>) {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));
  }

  async function elegirProveedor(nuevo: string) {
    const pedido = ++pedidoCuenta.current;
    setProveedorId(nuevo);
    setAImputar({});
    setImputacionesQuitadas([]);
    setCuenta(null);
    setErrorCuenta(null);
    if (!nuevo) {
      setCargandoCuenta(false);
      return;
    }
    setCargandoCuenta(true);
    try {
      const r = await cuentaDelProveedor(nuevo);
      if (pedido !== pedidoCuenta.current) return;
      if ("error" in r) setErrorCuenta(r.error);
      else setCuenta(r);
    } catch {
      if (pedido === pedidoCuenta.current) {
        setErrorCuenta("No se pudieron cargar los comprobantes pendientes del proveedor. Volvé a elegirlo.");
      }
    } finally {
      if (pedido === pedidoCuenta.current) setCargandoCuenta(false);
    }
  }

  function completar() {
    const llenas = completarEnOrden(debitos, total);
    setAImputar(Object.fromEntries(llenas.map((i) => [i.comprobanteId, String(i.importe)])));
  }

  function datos(): string {
    const enviada: OrdenEnviada = { proveedorId: proveedorId || null, fecha, observaciones, medios, imputaciones: elegidas };
    return JSON.stringify(enviada);
  }

  /** Guarda y, si se pide, abre la confirmación. */
  function guardar(paraConfirmar: boolean) {
    setOk(null);
    setIntentado(true);
    if (errores.length > 0) return;
    iniciar(async () => {
      const resultado = await guardarOrdenPago(id, datos());
      if (resultado.error || !resultado.id) {
        setFalla({ error: resultado.error ?? "No se pudo guardar el borrador.", titulo: "No se pudo guardar" });
        return;
      }
      const esNuevo = id === null;
      setId(resultado.id);
      if (paraConfirmar) {
        setResumen(resultado.resumen ?? null);
        confirmacion.current?.showModal();
        return;
      }
      // Un borrador nuevo pasa a su página: el aviso viaja en la URL porque el editor se vuelve a montar.
      if (esNuevo) {
        router.replace(`/compras/pagos/${resultado.id}?aviso=guardado`);
        return;
      }
      setOk(resultado.ok ?? null);
      router.refresh();
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    guardar(false);
  }

  function cerrarConfirmacion() {
    confirmacion.current?.close();
    if (id && !orden) router.replace(`/compras/pagos/${id}?aviso=guardado`);
    else router.refresh();
  }

  function confirmar() {
    if (!id) return;
    confirmacion.current?.close();
    iniciar(async () => {
      const resultado = await confirmarOrdenPago(id);
      if (resultado.error) {
        // Se queda en la pantalla (con el id ya guardado) para que el error no se pierda al navegar.
        setFalla({ error: resultado.error, titulo: "No se pudo confirmar" });
        return;
      }
      router.replace(`/compras/pagos/${id}?aviso=confirmado`);
    });
  }

  function borrar() {
    if (!id || !confirm("¿Borrar este borrador? No se puede deshacer.")) return;
    iniciar(async () => {
      const resultado = await borrarOrdenPago(id);
      if (resultado?.error) setFalla({ error: resultado.error, titulo: "No se pudo borrar" });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {ok && (
        <div role="status" className="rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          {ok}
        </div>
      )}

      <Tarjeta titulo="Cabecera">
        <div className="grid gap-3 p-4 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label className="etiqueta" htmlFor="proveedor">
              Proveedor *
            </label>
            <select id="proveedor" value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)} className="campo">
              <option value="">Elegí el proveedor</option>
              {proveedoresOfrecidos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.activo ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
            {proveedor && (
              <Link href={`/proveedores/${proveedor.id}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
                Ver ficha del proveedor
              </Link>
            )}
          </div>
          <Campo etiqueta="Fecha *" tipo="date" valor={fecha} onCambiar={setFecha} className="sm:col-span-1" />
          <div className="sm:col-span-2">
            {cuenta && cuenta.saldoAFavor > 0 && (
              <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
                El proveedor ya tiene <span className="font-semibold tabular-nums">{pesos(cuenta.saldoAFavor)}</span> a
                favor: se aplica solo a su próxima factura o nota de débito.
              </p>
            )}
          </div>
          <label className="block sm:col-span-6">
            <span className="etiqueta">Observaciones</span>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className="campo" />
          </label>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Medios de pago"
        descripcion="Un cheque de terceros sale de la cartera por su importe al confirmar la orden."
        acciones={
          <button type="button" onClick={() => setFilas((f) => [...f, filaVacia()])} className="boton-secundario px-2 py-1 text-xs">
            + Agregar medio
          </button>
        }
      >
        <ul className="divide-y divide-stone-100">
          {filas.length === 0 && <li className="p-4 text-sm text-stone-400">Cargá al menos un medio de pago.</li>}
          {filas.map((f, indice) => {
            const medio = medios[indice];
            const elegido = f.chequeId ? cheques.get(f.chequeId) : undefined;
            const disponibles = chequesElegibles(
              cartera.filter((c) => c.estado === "en_cartera" || c.id === f.chequeId),
              chequesElegidos,
              f.chequeId || null,
            );
            const encontrados = buscarCheques(disponibles, f.busqueda);
            const opciones = elegido && !encontrados.includes(elegido) ? [elegido, ...encontrados] : encontrados;
            return (
              <li key={f.clave} className="grid gap-3 p-4 sm:grid-cols-12">
                <label className="block sm:col-span-3">
                  <span className="etiqueta">Medio {indice + 1}</span>
                  <select
                    value={f.tipo}
                    onChange={(e) => cambiarFila(f.clave, { tipo: e.target.value as TipoMedioPagoCompra })}
                    className="campo"
                  >
                    {TIPOS_MEDIO_PAGO_COMPRA.map((t) => (
                      <option key={t} value={t}>
                        {NOMBRES_MEDIO_PAGO_COMPRA[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="etiqueta">Importe *</span>
                  {f.tipo === "cheque_tercero" ? (
                    <input
                      readOnly
                      value={elegido ? pesos(importeMedio(medio, cheques)) : ""}
                      placeholder="El del cheque"
                      title="Un cheque de terceros va por su importe."
                      className="campo bg-stone-50 text-right tabular-nums"
                    />
                  ) : (
                    <input
                      inputMode="decimal"
                      value={f.importe}
                      onChange={(e) => cambiarFila(f.clave, { importe: e.target.value })}
                      className="campo text-right tabular-nums"
                    />
                  )}
                </label>

                {f.tipo === "transferencia" && (
                  <Campo
                    etiqueta="Referencia"
                    valor={f.referencia}
                    onCambiar={(v) => cambiarFila(f.clave, { referencia: v })}
                    className="sm:col-span-4"
                  />
                )}

                {f.tipo === "cheque_tercero" && (
                  <>
                    <label className="block sm:col-span-2">
                      <span className="etiqueta">Buscar en la cartera</span>
                      <input
                        type="search"
                        value={f.busqueda}
                        onChange={(e) => cambiarFila(f.clave, { busqueda: e.target.value })}
                        placeholder="Banco, número, cliente…"
                        className="campo"
                      />
                    </label>
                    <label className="block sm:col-span-4">
                      <span className="etiqueta">Cheque *</span>
                      <select
                        value={f.chequeId}
                        onChange={(e) => cambiarFila(f.clave, { chequeId: e.target.value })}
                        className="campo"
                      >
                        <option value="">
                          {opciones.length === 0 ? "No hay cheques en cartera que coincidan" : "Elegí un cheque…"}
                        </option>
                        {opciones.map((c) => (
                          <option key={c.id} value={c.id}>
                            {textoCheque(c)}
                            {c.cliente ? ` · de ${c.cliente}` : ""}
                            {c.estado === "en_cartera" ? "" : " (ya no está en cartera)"}
                          </option>
                        ))}
                      </select>
                      {elegido && (
                        <Link href={`/cheques/${elegido.id}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
                          Ver cheque{elegido.librador ? ` (librador: ${elegido.librador})` : ""}
                        </Link>
                      )}
                    </label>
                  </>
                )}

                {f.tipo === "cheque_propio" && (
                  <>
                    <Campo
                      etiqueta="Banco *"
                      valor={f.banco}
                      onCambiar={(v) => cambiarFila(f.clave, { banco: v })}
                      className="sm:col-span-2"
                    />
                    <Campo
                      etiqueta="Número *"
                      valor={f.numero}
                      onCambiar={(v) => cambiarFila(f.clave, { numero: v })}
                      className="sm:col-span-2"
                    />
                    <Campo
                      etiqueta="Fecha de pago *"
                      tipo="date"
                      valor={f.fechaPago}
                      onCambiar={(v) => cambiarFila(f.clave, { fechaPago: v })}
                      className="sm:col-span-2"
                    />
                  </>
                )}

                <div className="flex items-end sm:col-span-1 sm:col-start-12">
                  <button
                    type="button"
                    onClick={() => setFilas((actuales) => actuales.filter((x) => x.clave !== f.clave))}
                    className="boton-peligro px-2 py-1 text-xs"
                    aria-label={`Quitar medio ${indice + 1}`}
                  >
                    Quitar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end border-t border-stone-200 px-4 py-3 text-sm font-semibold">
          Total de medios: <span className="ml-2 tabular-nums">{pesos(total)}</span>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Imputación"
        descripcion="Facturas y notas de débito confirmadas con saldo, de la más vieja a la más nueva. Lo que no se imputa queda a favor del proveedor."
        acciones={
          <button
            type="button"
            onClick={completar}
            disabled={debitos.length === 0 || aCentavos(total) <= 0}
            className="boton-secundario px-2 py-1 text-xs"
          >
            Completar en orden
          </button>
        }
      >
        {imputacionesQuitadas.length > 0 && (
          <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {imputacionesQuitadas.map((aviso) => (
              <p key={aviso}>{aviso}</p>
            ))}
            <p>Guardá el borrador para que el cambio quede registrado.</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th>Vencimiento</th>
                <th className="text-right">Total</th>
                <th className="text-right">Saldo pendiente</th>
                <th className="text-right">A imputar</th>
              </tr>
            </thead>
            <tbody>
              {!proveedorId && <Vacio mensaje="Elegí el proveedor para ver sus comprobantes pendientes." colSpan={6} />}
              {proveedorId && cargandoCuenta && <Vacio mensaje="Cargando comprobantes pendientes…" colSpan={6} />}
              {proveedorId && !cargandoCuenta && errorCuenta && (
                <tr>
                  <td colSpan={6} role="alert" className="px-4 py-3 text-sm text-red-700">
                    {errorCuenta}
                  </td>
                </tr>
              )}
              {proveedorId && !cargandoCuenta && !errorCuenta && cuenta && debitos.length === 0 && (
                <Vacio mensaje="El proveedor no tiene comprobantes pendientes: todo queda a favor." colSpan={6} />
              )}
              {debitos.map((d) => (
                <tr key={d.comprobanteId}>
                  <td className="whitespace-nowrap">{textoFecha(d.fecha)}</td>
                  <td>
                    <Link href={`/compras/comprobantes/${d.comprobanteId}`} className="text-marca-700 hover:underline">
                      {d.numeroTexto}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{textoFecha(d.fechaVencimiento)}</td>
                  <td className="text-right tabular-nums">{pesos(d.total)}</td>
                  <td className="text-right tabular-nums">{pesos(d.saldo)}</td>
                  <td className="text-right">
                    <input
                      inputMode="decimal"
                      value={aImputar[d.comprobanteId] ?? ""}
                      onChange={(e) => setAImputar((a) => ({ ...a, [d.comprobanteId]: e.target.value }))}
                      className="campo ml-auto w-32 text-right tabular-nums"
                      aria-label={`A imputar a ${d.numeroTexto}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Total de medios</dt>
            <dd className="tabular-nums">{pesos(total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Imputado</dt>
            <dd className="tabular-nums">{pesos(imputado)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
            <dt>Queda a favor</dt>
            <dd className="tabular-nums">{pesos(aFavor)}</dd>
          </div>
        </dl>
      </Tarjeta>

      {intentado && errores.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">Revisá:</p>
          <ul className="mt-1 list-disc pl-5">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pendiente} className="boton-secundario">
          {pendiente ? "Guardando…" : "Guardar borrador"}
        </button>
        <button type="button" disabled={pendiente} onClick={() => guardar(true)} className="boton-primario">
          Confirmar orden
        </button>
        {id && (
          <button type="button" disabled={pendiente} onClick={borrar} className="boton-peligro ml-auto">
            Borrar borrador
          </button>
        )}
      </div>

      <dialog
        ref={confirmacion}
        onCancel={(e) => {
          e.preventDefault();
          cerrarConfirmacion();
        }}
        className="m-auto rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40"
      >
        <div className="max-w-md p-5">
          <p className="text-sm font-semibold text-stone-900">Confirmar orden de pago</p>
          <p className="mt-2 text-sm text-stone-600">{resumen}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={cerrarConfirmacion} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="button" onClick={confirmar} className="boton-primario flex-1">
              Confirmar
            </button>
          </div>
        </div>
      </dialog>

      <ModalError estado={falla} titulo={falla?.titulo} />
    </form>
  );
}

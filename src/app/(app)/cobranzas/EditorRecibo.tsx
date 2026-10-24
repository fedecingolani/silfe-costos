"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta, Vacio } from "@/components/ui";
import { fecha as textoFecha, pesos } from "@/lib/formato";
import { aDecimal } from "@/lib/comprobantes/borrador";
import { nombreComprobante } from "@/lib/comprobantes/listado";
import { aCentavos, sumarPesos } from "@/lib/cobranzas/dinero";
import { completarEnOrden, pagoContado, saldoAFavor, validarImputaciones } from "@/lib/cobranzas/imputacion";
import { totalRecibo, validarRecibo, type MedioBorrador } from "@/lib/cobranzas/recibo";
import { erroresImporteImputado, leerImputacionesEditor } from "@/lib/cobranzas/editor";
import type { ReciboEnviado } from "@/lib/cobranzas/guardado";
import {
  NOMBRES_MEDIO_PAGO,
  NOMBRES_RETENCION,
  TIPOS_MEDIO_PAGO,
  TIPOS_RETENCION,
  type TipoMedioPago,
  type TipoRetencion,
} from "@/lib/tipos";
import type { ClienteEncontrado } from "../comprobantes/acciones";
import { BuscadorCliente } from "../comprobantes/BuscadorCliente";
import { borrarRecibo, cuentaDelCliente, emitirRecibo, guardarRecibo } from "./acciones";
import type { CuentaCliente } from "./datos";

/** Recibo en borrador ya guardado. */
export type ReciboEditable = {
  id: string;
  cliente: ClienteEncontrado;
  fecha: string;
  observaciones: string | null;
  medios: MedioBorrador[];
  imputaciones: { comprobanteId: string; importe: number }[];
};

/** Factura o ND de contado que se paga con este recibo (cliente fijo, una imputación por el total). */
export type ContadoAPagar = {
  id: string;
  texto: string;
  total: number;
  cliente: ClienteEncontrado;
};

type FilaMedio = {
  clave: number;
  tipo: TipoMedioPago;
  importe: string;
  banco: string;
  referencia: string;
  chequeBanco: string;
  chequeNumero: string;
  fechaEmision: string;
  fechaPago: string;
  librador: string;
  libradorCuit: string;
  retencionTipo: TipoRetencion | "";
  jurisdiccion: string;
  certificado: string;
  fechaRetencion: string;
};

let siguienteClave = 1;

function filaVacia(tipo: TipoMedioPago = "efectivo", importe = ""): FilaMedio {
  return {
    clave: siguienteClave++,
    tipo,
    importe,
    banco: "",
    referencia: "",
    chequeBanco: "",
    chequeNumero: "",
    fechaEmision: "",
    fechaPago: "",
    librador: "",
    libradorCuit: "",
    retencionTipo: "",
    jurisdiccion: "",
    certificado: "",
    fechaRetencion: "",
  };
}

function filaDeMedio(m: MedioBorrador): FilaMedio {
  return {
    ...filaVacia(m.tipo, String(m.importe)),
    banco: m.banco ?? "",
    referencia: m.referencia ?? "",
    chequeBanco: m.cheque?.banco ?? "",
    chequeNumero: m.cheque?.numero ?? "",
    fechaEmision: m.cheque?.fechaEmision ?? "",
    fechaPago: m.cheque?.fechaPago ?? "",
    librador: m.cheque?.librador ?? "",
    libradorCuit: m.cheque?.libradorCuit ?? "",
    retencionTipo: m.retencion?.tipo ?? "",
    jurisdiccion: m.retencion?.jurisdiccion ?? "",
    certificado: m.retencion?.certificado ?? "",
    fechaRetencion: m.retencion?.fecha ?? "",
  };
}

function medioDeFila(f: FilaMedio): MedioBorrador {
  const esCheque = f.tipo === "cheque" || f.tipo === "echeq";
  return {
    tipo: f.tipo,
    importe: aDecimal(f.importe) ?? Number.NaN,
    banco: f.tipo === "transferencia" ? f.banco : null,
    referencia: f.tipo === "transferencia" ? f.referencia : null,
    cheque: esCheque
      ? {
          banco: f.chequeBanco,
          numero: f.chequeNumero,
          fechaEmision: f.fechaEmision || null,
          fechaPago: f.fechaPago,
          librador: f.librador || null,
          libradorCuit: f.libradorCuit || null,
        }
      : null,
    retencion:
      f.tipo === "retencion"
        ? {
            tipo: f.retencionTipo || null,
            jurisdiccion: f.jurisdiccion || null,
            certificado: f.certificado,
            fecha: f.fechaRetencion,
          }
        : null,
  };
}

/** Campo de texto con su etiqueta. */
function Campo({
  etiqueta,
  valor,
  onCambiar,
  tipo = "text",
  className = "",
  placeholder,
}: {
  etiqueta: string;
  valor: string;
  onCambiar: (valor: string) => void;
  tipo?: "text" | "date";
  className?: string;
  placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta">{etiqueta}</span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        placeholder={placeholder}
        className="campo"
      />
    </label>
  );
}

/**
 * Editor de una cobranza (cuenta corriente) o del pago de una factura de
 * contado (`contado`): cliente fijo, sin tabla de imputación y los medios
 * tienen que sumar el total exacto. Guarda el borrador entero en una
 * transacción y emite con confirmación.
 */
export function EditorRecibo({
  recibo,
  contado,
  cuentaInicial,
  clienteInicial = null,
  hoy,
  aviso = null,
}: {
  recibo: ReciboEditable | null;
  contado: ContadoAPagar | null;
  cuentaInicial: CuentaCliente | null;
  /** Cliente ya elegido al abrir una cobranza nueva (`?cliente=` desde su cuenta corriente). */
  clienteInicial?: ClienteEncontrado | null;
  hoy: string;
  /** Mensaje que llega por la URL después de crear el borrador (`?aviso=guardado`). */
  aviso?: string | null;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [id, setId] = useState<string | null>(recibo?.id ?? null);
  const [mensaje, setMensaje] = useState<{ error?: string; ok?: string } | null>(aviso ? { ok: aviso } : null);
  const [resumen, setResumen] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);
  const confirmacion = useRef<HTMLDialogElement>(null);

  const [cliente, setCliente] = useState<ClienteEncontrado | null>(
    contado?.cliente ?? recibo?.cliente ?? clienteInicial,
  );
  const [fecha, setFecha] = useState(recibo?.fecha ?? hoy);
  const [observaciones, setObservaciones] = useState(recibo?.observaciones ?? "");
  const [filas, setFilas] = useState<FilaMedio[]>(() =>
    recibo && recibo.medios.length > 0
      ? recibo.medios.map(filaDeMedio)
      : [filaVacia("efectivo", contado ? String(contado.total) : "")],
  );
  const [cuenta, setCuenta] = useState<CuentaCliente | null>(cuentaInicial);
  const [cargandoCuenta, setCargandoCuenta] = useState(false);
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null);
  // Cada elección de cliente tiene su número: sólo la respuesta del último pedido cambia la pantalla.
  const pedidoCuenta = useRef(0);
  const [aImputar, setAImputar] = useState<Record<string, string>>(() =>
    Object.fromEntries((recibo?.imputaciones ?? []).map((i) => [i.comprobanteId, String(i.importe)])),
  );

  const medios = useMemo(() => filas.map(medioDeFila), [filas]);
  const total = useMemo(
    () => totalRecibo(medios.map((m) => ({ importe: Number.isFinite(m.importe) ? m.importe : 0 }))),
    [medios],
  );
  const debitos = useMemo(() => cuenta?.debitos ?? [], [cuenta]);
  const elegidas = useMemo(() => (contado ? [] : leerImputacionesEditor(aImputar)), [aImputar, contado]);
  // Los importes ilegibles bloquean el guardado (ver errores); los totales en vivo usan sólo los legibles.
  const legibles = elegidas.filter((e) => Number.isFinite(e.importe));
  const imputado = sumarPesos(legibles.map((e) => Math.max(e.importe, 0)));
  const aFavor = saldoAFavor(total, legibles);

  const errores = useMemo(() => {
    const lista = validarRecibo({ clienteId: cliente?.id ?? null, fecha, medios });
    if (contado) {
      const pago = pagoContado({ id: contado.id, total: contado.total, condicionPago: "contado" }, medios);
      if ("error" in pago) lista.push(pago.error);
    } else {
      const nombres = new Map(debitos.map((d) => [d.comprobanteId, `${nombreComprobante(d.clase, null)} ${d.numeroTexto}`]));
      lista.push(...erroresImporteImputado(elegidas, nombres));
      lista.push(...validarImputaciones(debitos, elegidas.filter((e) => Number.isFinite(e.importe)), total));
    }
    return lista;
  }, [cliente, fecha, medios, contado, debitos, elegidas, total]);

  function cambiarFila(clave: number, cambios: Partial<FilaMedio>) {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));
  }

  async function elegirCliente(nuevo: ClienteEncontrado | null) {
    const pedido = ++pedidoCuenta.current;
    setCliente(nuevo);
    setAImputar({});
    setCuenta(null);
    setErrorCuenta(null);
    if (!nuevo) {
      setCargandoCuenta(false);
      return;
    }
    setCargandoCuenta(true);
    try {
      const r = await cuentaDelCliente(nuevo.id);
      if (pedido !== pedidoCuenta.current) return;
      if ("error" in r) setErrorCuenta(r.error);
      else setCuenta(r);
    } catch {
      if (pedido === pedidoCuenta.current) {
        setErrorCuenta("No se pudieron cargar los comprobantes pendientes del cliente. Volvé a elegirlo.");
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
    const enviado: ReciboEnviado = {
      clienteId: cliente?.id ?? null,
      fecha,
      observaciones,
      contadoId: contado?.id ?? null,
      medios,
      imputaciones: elegidas,
    };
    return JSON.stringify(enviado);
  }

  /** Guarda y, si se pide, abre la confirmación para emitir. */
  function guardar(paraEmitir: boolean) {
    setMensaje(null);
    setIntentado(true);
    if (errores.length > 0) {
      setMensaje({ error: errores.join(" ") });
      return;
    }
    iniciar(async () => {
      const resultado = await guardarRecibo(id, datos());
      if (resultado.error || !resultado.id) {
        setMensaje({ error: resultado.error ?? "No se pudo guardar el borrador." });
        return;
      }
      const esNuevo = id === null;
      setId(resultado.id);
      if (paraEmitir) {
        setResumen(resultado.resumen ?? null);
        confirmacion.current?.showModal();
        return;
      }
      // Un borrador nuevo pasa a su página: el aviso viaja en la URL porque el editor se vuelve a montar.
      if (esNuevo) {
        router.replace(`/cobranzas/${resultado.id}?aviso=guardado`);
        return;
      }
      setMensaje({ ok: resultado.ok });
      router.refresh();
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    guardar(false);
  }

  function cerrarConfirmacion() {
    confirmacion.current?.close();
    if (id && !recibo) router.replace(`/cobranzas/${id}?aviso=guardado`);
    else router.refresh();
  }

  function emitir() {
    if (!id) return;
    confirmacion.current?.close();
    iniciar(async () => {
      const resultado = await emitirRecibo(id);
      if (resultado.error) {
        // Se queda en la pantalla (con el id ya guardado) para que el error no se pierda al navegar.
        setMensaje({ error: resultado.error });
        return;
      }
      router.replace(`/cobranzas/${id}?aviso=emitido`);
    });
  }

  function borrar() {
    if (!id || !confirm("¿Borrar este borrador? No se puede deshacer.")) return;
    iniciar(async () => {
      const resultado = await borrarRecibo(id);
      if (resultado?.error) setMensaje({ error: resultado.error });
    });
  }

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
            <span className="etiqueta">Cliente *</span>
            <BuscadorCliente cliente={cliente} onCambiar={elegirCliente} deshabilitado={Boolean(contado)} />
            {cliente && (
              <Link href={`/clientes/${cliente.id}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
                Ver ficha del cliente
              </Link>
            )}
          </div>
          <Campo etiqueta="Fecha *" tipo="date" valor={fecha} onCambiar={setFecha} className="sm:col-span-1" />
          <div className="sm:col-span-2">
            {contado ? (
              <dl className="rounded-lg bg-stone-50 p-3 text-sm">
                <dt className="text-xs text-stone-500">Pago de contado</dt>
                <dd>
                  <Link href={`/comprobantes/${contado.id}`} className="text-marca-700 hover:underline">
                    {contado.texto}
                  </Link>{" "}
                  por <span className="font-semibold tabular-nums">{pesos(contado.total)}</span>
                </dd>
              </dl>
            ) : (
              cuenta &&
              cuenta.saldoAFavor > 0 && (
                <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
                  El cliente tiene <span className="font-semibold tabular-nums">{pesos(cuenta.saldoAFavor)}</span> a
                  favor: se aplica solo a su próxima factura de cuenta corriente.
                </p>
              )
            )}
          </div>
          <label className="block sm:col-span-6">
            <span className="etiqueta">Observaciones</span>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              className="campo"
            />
          </label>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Medios de pago"
        descripcion={contado ? `Tienen que sumar exactamente ${pesos(contado.total)}.` : undefined}
        acciones={
          <button type="button" onClick={() => setFilas((f) => [...f, filaVacia()])} className="boton-secundario px-2 py-1 text-xs">
            + Agregar medio
          </button>
        }
      >
        <ul className="divide-y divide-stone-100">
          {filas.length === 0 && <li className="p-4 text-sm text-stone-400">Cargá al menos un medio de pago.</li>}
          {filas.map((f, indice) => (
            <li key={f.clave} className="grid gap-3 p-4 sm:grid-cols-12">
              <label className="block sm:col-span-3">
                <span className="etiqueta">Medio {indice + 1}</span>
                <select
                  value={f.tipo}
                  onChange={(e) => cambiarFila(f.clave, { tipo: e.target.value as TipoMedioPago })}
                  className="campo"
                >
                  {TIPOS_MEDIO_PAGO.map((t) => (
                    <option key={t} value={t}>
                      {NOMBRES_MEDIO_PAGO[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="etiqueta">Importe *</span>
                <input
                  inputMode="decimal"
                  value={f.importe}
                  onChange={(e) => cambiarFila(f.clave, { importe: e.target.value })}
                  className="campo text-right tabular-nums"
                />
              </label>

              {f.tipo === "transferencia" && (
                <>
                  <Campo
                    etiqueta="Banco o cuenta destino"
                    valor={f.banco}
                    onCambiar={(v) => cambiarFila(f.clave, { banco: v })}
                    className="sm:col-span-3"
                  />
                  <Campo
                    etiqueta="Referencia"
                    valor={f.referencia}
                    onCambiar={(v) => cambiarFila(f.clave, { referencia: v })}
                    className="sm:col-span-3"
                  />
                </>
              )}

              {(f.tipo === "cheque" || f.tipo === "echeq") && (
                <>
                  <Campo
                    etiqueta="Banco *"
                    valor={f.chequeBanco}
                    onCambiar={(v) => cambiarFila(f.clave, { chequeBanco: v })}
                    className="sm:col-span-3"
                  />
                  <Campo
                    etiqueta="Número *"
                    valor={f.chequeNumero}
                    onCambiar={(v) => cambiarFila(f.clave, { chequeNumero: v })}
                    className="sm:col-span-3"
                  />
                  <Campo
                    etiqueta="Fecha de emisión"
                    tipo="date"
                    valor={f.fechaEmision}
                    onCambiar={(v) => cambiarFila(f.clave, { fechaEmision: v })}
                    className="sm:col-span-3"
                  />
                  <Campo
                    etiqueta="Fecha de pago *"
                    tipo="date"
                    valor={f.fechaPago}
                    onCambiar={(v) => cambiarFila(f.clave, { fechaPago: v })}
                    className="sm:col-span-3"
                  />
                  <Campo
                    etiqueta="Librador"
                    valor={f.librador}
                    onCambiar={(v) => cambiarFila(f.clave, { librador: v })}
                    className="sm:col-span-3"
                  />
                  <Campo
                    etiqueta="CUIT del librador"
                    valor={f.libradorCuit}
                    onCambiar={(v) => cambiarFila(f.clave, { libradorCuit: v })}
                    placeholder="11 dígitos"
                    className="sm:col-span-3"
                  />
                </>
              )}

              {f.tipo === "retencion" && (
                <>
                  <label className="block sm:col-span-2">
                    <span className="etiqueta">Tipo *</span>
                    <select
                      value={f.retencionTipo}
                      onChange={(e) => cambiarFila(f.clave, { retencionTipo: e.target.value as TipoRetencion | "" })}
                      className="campo"
                    >
                      <option value="">Elegí…</option>
                      {TIPOS_RETENCION.map((t) => (
                        <option key={t} value={t}>
                          {NOMBRES_RETENCION[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {f.retencionTipo === "iibb" && (
                    <Campo
                      etiqueta="Jurisdicción *"
                      valor={f.jurisdiccion}
                      onCambiar={(v) => cambiarFila(f.clave, { jurisdiccion: v })}
                      className="sm:col-span-2"
                    />
                  )}
                  <Campo
                    etiqueta="Certificado *"
                    valor={f.certificado}
                    onCambiar={(v) => cambiarFila(f.clave, { certificado: v })}
                    className="sm:col-span-2"
                  />
                  <Campo
                    etiqueta="Fecha *"
                    tipo="date"
                    valor={f.fechaRetencion}
                    onCambiar={(v) => cambiarFila(f.clave, { fechaRetencion: v })}
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
          ))}
        </ul>
        <div className="flex justify-end border-t border-stone-200 px-4 py-3 text-sm font-semibold">
          Total del recibo: <span className="ml-2 tabular-nums">{pesos(total)}</span>
        </div>
      </Tarjeta>

      {!contado && (
        <Tarjeta
          titulo="Imputación"
          descripcion="Comprobantes de cuenta corriente con saldo, del más viejo al más nuevo. Lo que no se imputa queda a favor del cliente."
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
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Comprobante</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Saldo pendiente</th>
                  <th className="text-right">A imputar</th>
                </tr>
              </thead>
              <tbody>
                {!cliente && <Vacio mensaje="Elegí el cliente para ver sus comprobantes pendientes." colSpan={5} />}
                {cliente && cargandoCuenta && <Vacio mensaje="Cargando comprobantes pendientes…" colSpan={5} />}
                {cliente && !cargandoCuenta && errorCuenta && (
                  <tr>
                    <td colSpan={5} role="alert" className="px-4 py-3 text-sm text-red-700">
                      {errorCuenta}
                    </td>
                  </tr>
                )}
                {cliente && !cargandoCuenta && !errorCuenta && debitos.length === 0 && (
                  <Vacio mensaje="El cliente no tiene comprobantes pendientes: todo queda a favor." colSpan={5} />
                )}
                {debitos.map((d) => (
                  <tr key={d.comprobanteId}>
                    <td className="whitespace-nowrap">{textoFecha(d.fecha)}</td>
                    <td>
                      <Link href={`/comprobantes/${d.comprobanteId}`} className="text-marca-700 hover:underline">
                        {nombreComprobante(d.clase, null)} {d.numeroTexto}
                      </Link>
                    </td>
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
              <dt className="text-stone-500">Imputado</dt>
              <dd className="tabular-nums">{pesos(imputado)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Total del recibo</dt>
              <dd className="tabular-nums">{pesos(total)}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
              <dt>Queda a favor</dt>
              <dd className="tabular-nums">{pesos(aFavor)}</dd>
            </div>
          </dl>
        </Tarjeta>
      )}

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
          Emitir recibo
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
          <p className="text-sm font-semibold text-stone-900">Emitir recibo</p>
          <p className="mt-2 text-sm text-stone-600">{resumen}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={cerrarConfirmacion} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="button" onClick={emitir} className="boton-primario flex-1">
              Emitir
            </button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

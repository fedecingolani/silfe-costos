"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pastilla, Tarjeta } from "@/components/ui";
import { CamposComerciales, type DatosComerciales } from "@/components/ventas/CamposComerciales";
import { TablaItems } from "@/components/ventas/TablaItems";
import { pesos } from "@/lib/formato";
import { validarCuit } from "@/lib/clientes/validaciones";
import { calcularTotales } from "@/lib/comprobantes/calculo";
import { letraYTipoNota } from "@/lib/comprobantes/letra";
import { validarParaAutorizar } from "@/lib/comprobantes/validacion";
import {
  TIPOS_ASOCIADO_MANUAL,
  letraDeTipoArca,
  nombreTipoArca,
  validarPeriodoAsociado,
  type AsociadoManualEnviado,
  type PeriodoAsociado,
} from "@/lib/comprobantes/asociados";
import { itemParaCalcular, mapaPrecios, type BorradorEnviado } from "@/lib/comprobantes/borrador";
import { filaEnviada, filasIniciales, type FilaItem, type ItemEditable } from "@/lib/ventas/filas";
import {
  NOMBRES_AMBIENTE_ARCA,
  NOMBRES_CLASE_COMPROBANTE,
  type AmbienteArca,
  type ClaseComprobante,
  type CondicionPago,
  type LetraComprobante,
} from "@/lib/tipos";
import {
  autorizarComprobante,
  borrarBorrador,
  duplicarComprobante,
  guardarBorrador,
  preciosDeLista,
  type ClienteEncontrado,
} from "./acciones";
import { BuscadorCliente } from "./BuscadorCliente";
import type { ContextoEditor } from "./datos";

export type ComprobanteEditable = {
  id: string;
  clase: ClaseComprobante;
  fecha: string;
  fecha_vencimiento_pago: string;
  condicion_pago: CondicionPago;
  lista_precio_id: string | null;
  punto_venta: number;
  observaciones: string | null;
  ambiente: AmbienteArca | null;
  cliente: ClienteEncontrado;
  /** Período asociado de una nota sin asociado de la base (PeriodoAsoc). */
  periodo?: PeriodoAsociado | null;
  /** Comprobante asociado de una nota: de la base (lo puso "Generar nota") o cargado a mano. */
  asociado?: {
    interno: {
      id: string;
      /** "Factura A A-00007-00000361 del 10/10/2026" */
      texto: string;
      letra: LetraComprobante;
      /** null: es un X (no tiene código de ARCA). */
      tipoArca: number | null;
      /** Lo que queda para acreditar (sólo notas de crédito). */
      saldo: number | null;
    } | null;
    manual: { tipo_arca: number | null; punto_venta: number | null; numero: number | null; fecha: string | null } | null;
  };
  items: ItemEditable[];
};

/**
 * Clases que se cargan desde esta pantalla. Una nota sobre un comprobante de
 * la app se genera desde su detalle ("Generar nota de crédito"); acá se carga
 * la que asocia a mano un comprobante del sistema anterior.
 */
const CLASES_NUEVAS: ClaseComprobante[] = ["factura", "nota_credito", "nota_debito"];

export function EditorComprobante({
  comprobante,
  contexto,
  precios: preciosIniciales,
  hoy,
}: {
  comprobante: ComprobanteEditable | null;
  contexto: ContextoEditor;
  precios: { producto_id: string | null; precio_final: number }[];
  hoy: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [id, setId] = useState<string | null>(comprobante?.id ?? null);
  const [mensaje, setMensaje] = useState<{ error?: string; ok?: string } | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const confirmacion = useRef<HTMLDialogElement>(null);

  const [cliente, setCliente] = useState<ClienteEncontrado | null>(comprobante?.cliente ?? null);
  const [clase, setClase] = useState<ClaseComprobante>(comprobante?.clase ?? "factura");
  const [comerciales, setComerciales] = useState<DatosComerciales>(() => ({
    fecha: comprobante?.fecha ?? hoy,
    vencimiento: comprobante?.fecha_vencimiento_pago ?? hoy,
    condicion: comprobante?.condicion_pago ?? "cuenta_corriente",
    listaId: comprobante ? comprobante.lista_precio_id : (contexto.listas[0]?.id ?? null),
    observaciones: comprobante?.observaciones ?? "",
  }));
  const { fecha, vencimiento, condicion, listaId, observaciones } = comerciales;
  const [puntoVenta, setPuntoVenta] = useState<number | null>(
    comprobante?.punto_venta ?? contexto.puntosVenta[0]?.numero ?? null,
  );
  const interno = comprobante?.asociado?.interno ?? null;
  const manualGuardado = comprobante?.asociado?.manual ?? null;
  const [manual, setManual] = useState<AsociadoManualEnviado>({
    tipoArca: manualGuardado?.tipo_arca ? String(manualGuardado.tipo_arca) : "",
    puntoVenta: manualGuardado?.punto_venta ? String(manualGuardado.punto_venta) : "",
    numero: manualGuardado?.numero ? String(manualGuardado.numero) : "",
    fecha: manualGuardado?.fecha ?? "",
  });
  // Una nota sin asociado de la base se asocia a un comprobante cargado a mano o a un período.
  const [asociarA, setAsociarA] = useState<"comprobante" | "periodo">(comprobante?.periodo ? "periodo" : "comprobante");
  const [periodo, setPeriodo] = useState<PeriodoAsociado>(comprobante?.periodo ?? { desde: "", hasta: "" });
  const [precios, setPrecios] = useState(() => mapaPrecios(preciosIniciales));
  const [filas, setFilas] = useState<FilaItem[]>(() => filasIniciales(comprobante?.items, contexto.productos));

  // ----- Datos calculados ---------------------------------------------------

  // Un punto de venta no electrónico emite X: sin ARCA ni IVA. Uno inactivo
  // no está en la lista: es no electrónico si el comprobante no tiene ambiente.
  const puntoElegido = contexto.puntosVenta.find((p) => p.numero === puntoVenta);
  const electronico = puntoElegido ? puntoElegido.electronico : !comprobante || comprobante.ambiente !== null;
  const esX = !electronico;
  // Una nota lleva la letra de su asociado (ARCA exige la misma), no la de la condición IVA actual del cliente.
  const esNota = clase !== "factura";
  // Una nota X no lleva un asociado cargado a mano (esos tienen código de
  // ARCA): sin asociado de la base, va asociada a un período.
  const porPeriodo = esNota && !interno && (esX || asociarA === "periodo");
  // Con un período no hay asociado del que heredar: va la letra del cliente.
  const letraAsociado: LetraComprobante | null =
    esNota && !porPeriodo ? (interno?.letra ?? letraDeTipoArca(manual.tipoArca || null)) : null;
  let letra: LetraComprobante | null = esX ? "X" : null;
  const avisos: string[] = [];
  if (cliente && !cliente.condicion_iva) {
    avisos.push("El cliente no tiene condición frente al IVA: completala en su ficha antes de autorizar.");
  }
  if (!esX && cliente && (cliente.condicion_iva || letraAsociado)) {
    const resultado = letraYTipoNota(cliente.condicion_iva, clase, letraAsociado, true);
    letra = resultado.letra;
    if (resultado.aviso) avisos.push(resultado.aviso);
    if (letra === "A" && !(cliente.cuit && validarCuit(cliente.cuit).valido)) {
      avisos.push("Para un comprobante A el cliente necesita una CUIT válida: corregila en su ficha.");
    }
  }
  const ambiente: AmbienteArca | null = esX ? null : (comprobante?.ambiente ?? contexto.ambienteActivo);
  const calculables = filas.map(itemParaCalcular);
  const totales = calcularTotales(calculables.filter((c) => c !== null), { sinIva: esX });
  // Una nota generada desde otro comprobante no cambia de clase.
  const clases = interno && comprobante ? [comprobante.clase] : CLASES_NUEVAS;
  const superaSaldo =
    clase === "nota_credito" && interno?.saldo !== null && interno?.saldo !== undefined && totales.total > interno.saldo + 0.005;

  // ----- Cambios ------------------------------------------------------------

  async function cambiarComerciales(cambios: Partial<DatosComerciales>) {
    setComerciales((actuales) => ({ ...actuales, ...cambios }));
    if ("listaId" in cambios) {
      const nueva = cambios.listaId ?? null;
      setPrecios(mapaPrecios(nueva ? await preciosDeLista(nueva) : []));
    }
  }

  // ----- Acciones -----------------------------------------------------------

  function datos(): string {
    const enviado: BorradorEnviado = {
      clienteId: cliente?.id ?? "",
      clase,
      fecha,
      fechaVencimientoPago: vencimiento,
      condicionPago: condicion,
      listaPrecioId: listaId,
      puntoVenta: puntoVenta ?? "",
      observaciones,
      asociadoManual: esNota && !interno && !porPeriodo ? manual : null,
      periodoAsociado: porPeriodo ? periodo : null,
      items: filas.map(filaEnviada),
    };
    return JSON.stringify(enviado);
  }

  /**
   * Problemas que la pantalla ya conoce y que harían rechazar la autorización.
   * Si hay alguno, no se pide confirmación: se muestran directo. El servidor
   * vuelve a validar todo al autorizar.
   */
  function problemasParaAutorizar(): string[] {
    const problemas = validarParaAutorizar(
      {
        clase,
        letra,
        fecha,
        receptor: {
          razonSocial: cliente?.razon_social ?? null,
          condicionIva: cliente?.condicion_iva ?? null,
          cuit: cliente?.cuit ?? null,
        },
        items: calculables.filter((c) => c !== null),
      },
      hoy,
    );
    if (calculables.some((c) => c === null)) problemas.push("Hay ítems incompletos: revisá cantidad, precio y alícuota.");
    if (porPeriodo) problemas.push(...validarPeriodoAsociado(periodo, fecha));
    if (superaSaldo && interno?.saldo != null) {
      problemas.push(`La nota de crédito supera el saldo disponible (${pesos(interno.saldo)}).`);
    }
    return problemas;
  }

  /** Guarda y, si se pide, abre la confirmación para autorizar. */
  function guardar(paraAutorizar: boolean) {
    setMensaje(null);
    iniciar(async () => {
      const resultado = await guardarBorrador(id, datos());
      if (resultado.error || !resultado.id) {
        setMensaje({ error: resultado.error ?? "No se pudo guardar el borrador." });
        return;
      }
      const esNuevo = id === null;
      setId(resultado.id);
      if (paraAutorizar) {
        const problemas = problemasParaAutorizar();
        if (problemas.length > 0) {
          // Se queda en la pantalla para que el mensaje se vea; el id ya quedó guardado.
          setMensaje({ error: `Se guardó el borrador, pero no se puede autorizar: ${problemas.join(" ")}` });
          return;
        }
        setResumen(resultado.resumen ?? null);
        confirmacion.current?.showModal();
        return;
      }
      setMensaje({ ok: resultado.ok });
      if (esNuevo) router.replace(`/comprobantes/${resultado.id}`);
      else router.refresh();
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    guardar(false);
  }

  function cerrarConfirmacion() {
    confirmacion.current?.close();
    // Un borrador nuevo ya quedó guardado: se pasa a su dirección.
    if (id && !comprobante) router.replace(`/comprobantes/${id}`);
    else router.refresh();
  }

  function autorizar() {
    if (!id) return;
    confirmacion.current?.close();
    iniciar(async () => {
      const resultado = await autorizarComprobante(id);
      setMensaje(resultado.error ? { error: resultado.error } : { ok: resultado.ok });
      if (!comprobante) router.replace(`/comprobantes/${id}`);
      else router.refresh();
    });
  }

  function borrar() {
    if (!id || !confirm("¿Borrar este borrador? No se puede deshacer.")) return;
    iniciar(async () => {
      const resultado = await borrarBorrador(id);
      if (resultado?.error) setMensaje({ error: resultado.error });
    });
  }

  function duplicar() {
    if (!id) return;
    iniciar(async () => {
      const resultado = await duplicarComprobante(id);
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
          <div className="sm:col-span-3">
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-stone-50 p-3 text-sm">
              <div>
                <dt className="text-xs text-stone-500">Letra</dt>
                <dd className="font-semibold">{letra ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Número</dt>
                <dd className="text-stone-600">se asigna al autorizar</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Ambiente</dt>
                <dd>
                  {esX ? (
                    <Pastilla tono="neutro">Sin ARCA</Pastilla>
                  ) : ambiente ? (
                    <Pastilla tono={ambiente === "produccion" ? "verde" : "ambar"}>
                      {NOMBRES_AMBIENTE_ARCA[ambiente]}
                    </Pastilla>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
            {avisos.map((a) => (
              <p key={a} className="mt-1 text-xs text-amber-700">
                ⚠ {a}
              </p>
            ))}
          </div>

          <div>
            <label className="etiqueta" htmlFor="clase">
              Comprobante *
            </label>
            <select
              id="clase"
              value={clase}
              onChange={(e) => setClase(e.target.value as ClaseComprobante)}
              className="campo"
            >
              {clases.map((c) => (
                <option key={c} value={c}>
                  {NOMBRES_CLASE_COMPROBANTE[c]}
                </option>
              ))}
            </select>
          </div>
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
              {puntoVenta !== null && !puntoElegido && <option value={puntoVenta}>{puntoVenta} (inactivo)</option>}
              {contexto.puntosVenta.length === 0 && <option value="">Sin puntos de venta</option>}
              {contexto.puntosVenta.map((p) => (
                <option key={p.numero} value={p.numero}>
                  {String(p.numero).padStart(5, "0")}
                  {p.electronico ? "" : " (X, sin ARCA)"}
                </option>
              ))}
            </select>
          </div>
          <CamposComerciales valores={comerciales} onCambiar={cambiarComerciales} listas={contexto.listas} />
        </div>
      </Tarjeta>

      {esNota && (
        <Tarjeta
          titulo="Comprobante asociado"
          descripcion={
            interno
              ? "La nota lleva la letra de este comprobante."
              : esX
                ? "Una nota X se genera desde el comprobante X que corrige, o se asocia a un período."
                : "Un comprobante del sistema anterior (se informa a ARCA con la CUIT del emisor) o un período."
          }
        >
          {interno ? (
            <div className="space-y-1 p-4 text-sm">
              <p>
                <Link href={`/comprobantes/${interno.id}`} className="text-marca-700 hover:underline">
                  {interno.texto}
                </Link>
              </p>
              {clase === "nota_credito" && interno.saldo !== null && (
                <p className={superaSaldo ? "text-red-700" : "text-stone-500"}>
                  Saldo disponible para notas de crédito: {pesos(interno.saldo)}
                  {superaSaldo && " — la nota lo supera: no se va a poder autorizar."}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {!esX && (
                <fieldset className="flex flex-wrap gap-4 text-sm">
                  <legend className="sr-only">Asociar la nota a</legend>
                  {(
                    [
                      ["comprobante", "Comprobante"],
                      ["periodo", "Período"],
                    ] as const
                  ).map(([valor, texto]) => (
                    <label key={valor} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="asociar-a"
                        value={valor}
                        checked={asociarA === valor}
                        onChange={() => setAsociarA(valor)}
                      />
                      {texto}
                    </label>
                  ))}
                </fieldset>
              )}
              {porPeriodo ? (
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <label className="etiqueta" htmlFor="periodo-desde">
                      Desde *
                    </label>
                    <input
                      id="periodo-desde"
                      type="date"
                      value={periodo.desde}
                      max={fecha}
                      onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))}
                      className="campo"
                    />
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="periodo-hasta">
                      Hasta *
                    </label>
                    <input
                      id="periodo-hasta"
                      type="date"
                      value={periodo.hasta}
                      max={fecha}
                      onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))}
                      className="campo"
                    />
                  </div>
                  <p className="text-xs text-stone-500 sm:col-span-4">
                    ARCA pide que el desde y el hasta sean del mismo mes y que el hasta no sea posterior a la fecha de
                    la nota. {esX ? "La nota es X: sin ARCA ni IVA." : "La letra sale de la condición IVA del cliente."}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <label className="etiqueta" htmlFor="asociado-tipo">
                      Tipo *
                    </label>
                    <select
                      id="asociado-tipo"
                      value={manual.tipoArca}
                      onChange={(e) => setManual((m) => ({ ...m, tipoArca: e.target.value }))}
                      className="campo"
                    >
                      <option value="">Elegí…</option>
                      {TIPOS_ASOCIADO_MANUAL[clase as "nota_credito" | "nota_debito"].map((t) => (
                        <option key={t} value={String(t)}>
                          {nombreTipoArca(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="asociado-punto-venta">
                      Punto de venta *
                    </label>
                    <input
                      id="asociado-punto-venta"
                      inputMode="numeric"
                      value={manual.puntoVenta}
                      onChange={(e) => setManual((m) => ({ ...m, puntoVenta: e.target.value }))}
                      className="campo"
                    />
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="asociado-numero">
                      Número *
                    </label>
                    <input
                      id="asociado-numero"
                      inputMode="numeric"
                      value={manual.numero}
                      onChange={(e) => setManual((m) => ({ ...m, numero: e.target.value }))}
                      className="campo"
                    />
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="asociado-fecha">
                      Fecha *
                    </label>
                    <input
                      id="asociado-fecha"
                      type="date"
                      value={manual.fecha}
                      max={fecha}
                      onChange={(e) => setManual((m) => ({ ...m, fecha: e.target.value }))}
                      className="campo"
                    />
                  </div>
                  <p className="text-xs text-stone-500 sm:col-span-4">
                    Sin control de importe: el comprobante no está en la base, así que no se sabe cuánto queda por
                    acreditar. Revisá que la nota no supere el comprobante original.
                  </p>
                </div>
              )}
            </div>
          )}
        </Tarjeta>
      )}

      <TablaItems
        filas={filas}
        onCambiar={setFilas}
        productos={contexto.productos}
        precios={precios}
        sinIva={esX}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pendiente} className="boton-secundario">
          {pendiente ? "Guardando…" : "Guardar borrador"}
        </button>
        <button type="button" disabled={pendiente} onClick={() => guardar(true)} className="boton-primario">
          {esX ? "Emitir comprobante X" : "Autorizar en ARCA"}
        </button>
        {id && (
          <>
            <button type="button" disabled={pendiente} onClick={duplicar} className="boton-secundario">
              Duplicar
            </button>
            <button type="button" disabled={pendiente} onClick={borrar} className="boton-peligro ml-auto">
              Borrar borrador
            </button>
          </>
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
          <p className="text-sm font-semibold text-stone-900">{esX ? "Emitir comprobante X" : "Autorizar en ARCA"}</p>
          <p className="mt-2 text-sm text-stone-600">{resumen}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={cerrarConfirmacion} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="button" onClick={autorizar} className="boton-primario flex-1">
              {esX ? "Emitir" : "Autorizar"}
            </button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

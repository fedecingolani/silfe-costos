"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { numero, pesos } from "@/lib/formato";
import { validarCuit } from "@/lib/clientes/validaciones";
import { calcularItem, calcularTotales } from "@/lib/comprobantes/calculo";
import { letraYTipoNota } from "@/lib/comprobantes/letra";
import { validarParaAutorizar } from "@/lib/comprobantes/validacion";
import {
  TIPOS_ASOCIADO_MANUAL,
  letraDeTipoArca,
  nombreTipoArca,
  type AsociadoManualEnviado,
} from "@/lib/comprobantes/asociados";
import {
  buscarProductos,
  itemParaCalcular,
  mapaPrecios,
  precioPropuesto,
  vencimientoPara,
  type BorradorEnviado,
  type FilaItemEnviada,
} from "@/lib/comprobantes/borrador";
import {
  ALICUOTAS_IVA,
  CONDICIONES_PAGO,
  NO_GRAVADO,
  NOMBRES_AMBIENTE_ARCA,
  NOMBRES_CLASE_COMPROBANTE,
  NOMBRES_CONDICION_PAGO,
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
import type { ContextoEditor, ProductoOfrecido } from "./datos";

/** Renglón en pantalla: lo que se envía más lo que sólo sirve para mostrar. */
type Fila = FilaItemEnviada & {
  clave: string;
  libre: boolean;
  codigo: string | null;
  /** Alícuota del producto (texto), para volver a ella después de pasar el renglón a no gravado. */
  alicuotaProducto: string | null;
  busqueda: string;
  aviso: string | null;
};

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
  /** Comprobante asociado de una nota: de la base (lo puso "Generar nota") o cargado a mano. */
  asociado?: {
    interno: {
      id: string;
      /** "Factura A A-00007-00000361 del 10/10/2026" */
      texto: string;
      letra: LetraComprobante;
      tipoArca: number;
      /** Lo que queda para acreditar (sólo notas de crédito). */
      saldo: number | null;
    } | null;
    manual: { tipo_arca: number | null; punto_venta: number | null; numero: number | null; fecha: string | null } | null;
  };
  items: {
    producto_id: string | null;
    codigo: string | null;
    descripcion: string;
    observaciones: string | null;
    cantidad: number;
    precio_unitario: number;
    descuento_pct: number;
    gravado: boolean;
    alicuota_iva: number | null;
  }[];
};

let contador = 0;
const nuevaClave = () => `fila-${++contador}`;

const filaVacia = (): Fila => ({
  clave: nuevaClave(),
  libre: false,
  productoId: null,
  codigo: null,
  alicuotaProducto: null,
  descripcion: "",
  observaciones: "",
  cantidad: "1",
  precioUnitario: "0",
  descuentoPct: "0",
  alicuotaIva: "21",
  busqueda: "",
  aviso: null,
});

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
  const [fecha, setFecha] = useState(comprobante?.fecha ?? hoy);
  const [vencimiento, setVencimiento] = useState(comprobante?.fecha_vencimiento_pago ?? hoy);
  const [condicion, setCondicion] = useState<CondicionPago>(comprobante?.condicion_pago ?? "cuenta_corriente");
  const [listaId, setListaId] = useState<string | null>(
    comprobante ? comprobante.lista_precio_id : (contexto.listas[0]?.id ?? null),
  );
  const [puntoVenta, setPuntoVenta] = useState<number | null>(
    comprobante?.punto_venta ?? contexto.puntosVenta[0] ?? null,
  );
  const [observaciones, setObservaciones] = useState(comprobante?.observaciones ?? "");
  const interno = comprobante?.asociado?.interno ?? null;
  const manualGuardado = comprobante?.asociado?.manual ?? null;
  const [manual, setManual] = useState<AsociadoManualEnviado>({
    tipoArca: manualGuardado?.tipo_arca ? String(manualGuardado.tipo_arca) : "",
    puntoVenta: manualGuardado?.punto_venta ? String(manualGuardado.punto_venta) : "",
    numero: manualGuardado?.numero ? String(manualGuardado.numero) : "",
    fecha: manualGuardado?.fecha ?? "",
  });
  const [masOpciones, setMasOpciones] = useState(Boolean(comprobante?.observaciones));
  const [precios, setPrecios] = useState(() => mapaPrecios(preciosIniciales));
  const [filas, setFilas] = useState<Fila[]>(() =>
    comprobante && comprobante.items.length > 0
      ? comprobante.items.map((i) => ({
          clave: nuevaClave(),
          libre: i.producto_id === null,
          productoId: i.producto_id,
          codigo: i.codigo,
          alicuotaProducto: i.producto_id
            ? i.gravado
              ? String(i.alicuota_iva)
              : (() => {
                  const p = contexto.productos.find((x) => x.id === i.producto_id);
                  return p ? String(p.alicuota ?? p.alicuotaOriginal) : null;
                })()
            : null,
          descripcion: i.descripcion,
          observaciones: i.observaciones ?? "",
          cantidad: String(i.cantidad),
          precioUnitario: String(i.precio_unitario),
          descuentoPct: String(i.descuento_pct),
          alicuotaIva: i.gravado ? String(i.alicuota_iva) : NO_GRAVADO,
          busqueda: "",
          aviso: null,
        }))
      : [filaVacia()],
  );

  const productosPorId = useMemo(() => new Map(contexto.productos.map((p) => [p.id, p])), [contexto.productos]);

  // ----- Datos calculados ---------------------------------------------------

  // Una nota lleva la letra de su asociado (ARCA exige la misma), no la de la condición IVA actual del cliente.
  const esNota = clase !== "factura";
  const letraAsociado: LetraComprobante | null = esNota
    ? (interno?.letra ?? letraDeTipoArca(manual.tipoArca || null))
    : null;
  let letra: string | null = null;
  const avisos: string[] = [];
  if (cliente && !cliente.condicion_iva) {
    avisos.push("El cliente no tiene condición frente al IVA: completala en su ficha antes de autorizar.");
  }
  if (cliente && (cliente.condicion_iva || letraAsociado)) {
    const resultado = letraYTipoNota(cliente.condicion_iva, clase, letraAsociado);
    letra = resultado.letra;
    if (resultado.aviso) avisos.push(resultado.aviso);
    if (letra === "A" && !(cliente.cuit && validarCuit(cliente.cuit).valido)) {
      avisos.push("Para un comprobante A el cliente necesita una CUIT válida: corregila en su ficha.");
    }
  }
  const ambiente: AmbienteArca | null = comprobante?.ambiente ?? contexto.ambienteActivo;
  const calculables = filas.map(itemParaCalcular);
  const totales = calcularTotales(calculables.filter((c) => c !== null));
  // Una nota generada desde otro comprobante no cambia de clase.
  const clases = interno && comprobante ? [comprobante.clase] : CLASES_NUEVAS;
  const superaSaldo =
    clase === "nota_credito" && interno?.saldo !== null && interno?.saldo !== undefined && totales.total > interno.saldo + 0.005;

  // ----- Cambios ------------------------------------------------------------

  const cambiarFila = (clave: string, cambios: Partial<Fila>) =>
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));

  function elegirProducto(clave: string, producto: ProductoOfrecido) {
    const { precio, enLista } = precioPropuesto(precios, producto.id);
    cambiarFila(clave, {
      productoId: producto.id,
      codigo: producto.codigo,
      descripcion: producto.nombre,
      alicuotaIva: producto.alicuota !== null ? String(producto.alicuota) : String(producto.alicuotaOriginal),
      alicuotaProducto: producto.alicuota !== null ? String(producto.alicuota) : String(producto.alicuotaOriginal),
      precioUnitario: String(precio),
      busqueda: "",
      aviso:
        producto.alicuota === null
          ? `La alícuota del producto (${producto.alicuotaOriginal}%) no es una de ARCA: corregila en el producto.`
          : enLista
            ? null
            : "No está en la lista: cargá el precio.",
    });
  }

  function cambiarFecha(valor: string) {
    setFecha(valor);
    setVencimiento((v) => vencimientoPara(condicion, valor, v));
  }

  function cambiarCondicion(valor: CondicionPago) {
    setCondicion(valor);
    setVencimiento((v) => vencimientoPara(valor, fecha, v));
  }

  async function cambiarLista(valor: string) {
    const nueva = valor || null;
    setListaId(nueva);
    setPrecios(mapaPrecios(nueva ? await preciosDeLista(nueva) : []));
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
      asociadoManual: esNota && !interno ? manual : null,
      items: filas.map((f) => ({
        productoId: f.productoId,
        descripcion: f.descripcion,
        observaciones: f.observaciones,
        cantidad: f.cantidad,
        precioUnitario: f.precioUnitario,
        descuentoPct: f.descuentoPct,
        alicuotaIva: f.alicuotaIva,
      })),
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
        letra: letra === "A" || letra === "B" ? letra : null,
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
                  {ambiente ? (
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
              {puntoVenta !== null && !contexto.puntosVenta.includes(puntoVenta) && (
                <option value={puntoVenta}>{puntoVenta} (inactivo)</option>
              )}
              {contexto.puntosVenta.length === 0 && <option value="">Sin puntos de venta</option>}
              {contexto.puntosVenta.map((n) => (
                <option key={n} value={n}>
                  {String(n).padStart(5, "0")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">
              Fecha *
            </label>
            <input id="fecha" type="date" value={fecha} onChange={(e) => cambiarFecha(e.target.value)} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="condicion">
              Condición de pago
            </label>
            <select
              id="condicion"
              value={condicion}
              onChange={(e) => cambiarCondicion(e.target.value as CondicionPago)}
              className="campo"
            >
              {CONDICIONES_PAGO.map((c) => (
                <option key={c} value={c}>
                  {NOMBRES_CONDICION_PAGO[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="vencimiento">
              Vencimiento del cobro
            </label>
            <input
              id="vencimiento"
              type="date"
              value={vencimiento}
              min={fecha}
              disabled={condicion === "contado"}
              onChange={(e) => setVencimiento(e.target.value)}
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="lista">
              Lista de precios
            </label>
            <select id="lista" value={listaId ?? ""} onChange={(e) => cambiarLista(e.target.value)} className="campo">
              <option value="">Sin lista</option>
              {contexto.listas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-6">
            <button
              type="button"
              onClick={() => setMasOpciones((v) => !v)}
              className="text-xs font-medium text-marca-700 hover:underline"
            >
              {masOpciones ? "− Menos opciones" : "+ Más opciones"}
            </button>
            {masOpciones && (
              <div className="mt-2">
                <label className="etiqueta" htmlFor="observaciones">
                  Observaciones
                </label>
                <textarea
                  id="observaciones"
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  className="campo"
                />
              </div>
            )}
          </div>
        </div>
      </Tarjeta>

      {esNota && (
        <Tarjeta
          titulo="Comprobante asociado"
          descripcion={
            interno
              ? "La nota lleva la letra de este comprobante."
              : "Para notas sobre comprobantes del sistema anterior: se informan a ARCA con la CUIT del emisor."
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
            <div className="grid gap-3 p-4 sm:grid-cols-4">
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
        </Tarjeta>
      )}

      <Tarjeta
        titulo="Ítems"
        descripcion="Precios unitarios sin IVA. Al elegir un producto, el precio sale de la lista elegida."
        acciones={
          <button type="button" onClick={() => setFilas((f) => [...f, filaVacia()])} className="boton-secundario">
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
                <th className="w-24">IVA %</th>
                <th className="text-right">Importe</th>
                <th className="text-right">IVA</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <Vacio mensaje="Agregá al menos un ítem." colSpan={9} />}
              {filas.map((f, i) => {
                const calculado = calculables[i] ? calcularItem(calculables[i]) : null;
                const producto = f.productoId ? productosPorId.get(f.productoId) : undefined;
                return (
                  <tr key={f.clave} className="align-top">
                    <td>
                      <div className="space-y-1">
                        {f.libre ? (
                          <input
                            value={f.descripcion}
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
                          </div>
                        ) : (
                          <BuscadorProducto
                            productos={contexto.productos}
                            texto={f.busqueda}
                            onTexto={(busqueda) => cambiarFila(f.clave, { busqueda })}
                            onElegir={(p) => elegirProducto(f.clave, p)}
                            etiqueta={`Producto del ítem ${i + 1}`}
                          />
                        )}
                        <input
                          value={f.observaciones}
                          onChange={(e) => cambiarFila(f.clave, { observaciones: e.target.value })}
                          placeholder="Observaciones (se imprimen debajo)"
                          className="campo text-xs"
                          aria-label={`Observaciones del ítem ${i + 1}`}
                        />
                        <label className="flex items-center gap-1.5 text-xs text-stone-500">
                          <input
                            type="checkbox"
                            checked={f.libre}
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
                        onChange={(e) => cambiarFila(f.clave, { cantidad: e.target.value })}
                        className="campo text-right"
                        aria-label={`Cantidad del ítem ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={f.precioUnitario}
                        onChange={(e) => cambiarFila(f.clave, { precioUnitario: e.target.value, aviso: null })}
                        className="campo text-right"
                        aria-label={`Precio del ítem ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={f.descuentoPct}
                        onChange={(e) => cambiarFila(f.clave, { descuentoPct: e.target.value })}
                        className="campo text-right"
                        aria-label={`Descuento del ítem ${i + 1}`}
                      />
                    </td>
                    <td>
                      {f.libre ? (
                        <select
                          value={f.alicuotaIva}
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
                    <td className="text-right tabular-nums">{calculado ? pesos(calculado.iva) : "—"}</td>
                    <td className="text-right tabular-nums">
                      {calculado ? pesos(calculado.importe + calculado.iva) : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setFilas((actuales) => actuales.filter((x) => x.clave !== f.clave))}
                        className="boton-peligro px-2 py-1 text-xs"
                        aria-label={`Quitar el ítem ${i + 1}`}
                      >
                        Quitar
                      </button>
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

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pendiente} className="boton-secundario">
          {pendiente ? "Guardando…" : "Guardar borrador"}
        </button>
        <button type="button" disabled={pendiente} onClick={() => guardar(true)} className="boton-primario">
          Autorizar en ARCA
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
          <p className="text-sm font-semibold text-stone-900">Autorizar en ARCA</p>
          <p className="mt-2 text-sm text-stone-600">{resumen}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={cerrarConfirmacion} className="boton-secundario flex-1">
              Cancelar
            </button>
            <button type="button" onClick={autorizar} className="boton-primario flex-1">
              Autorizar
            </button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

/** Buscador de productos activos por código o nombre (filtra en el navegador). */
function BuscadorProducto({
  productos,
  texto,
  onTexto,
  onElegir,
  etiqueta,
}: {
  productos: ProductoOfrecido[];
  texto: string;
  onTexto: (texto: string) => void;
  onElegir: (producto: ProductoOfrecido) => void;
  etiqueta: string;
}) {
  const encontrados = buscarProductos(productos, texto);
  return (
    <div className="relative">
      <input
        type="search"
        value={texto}
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

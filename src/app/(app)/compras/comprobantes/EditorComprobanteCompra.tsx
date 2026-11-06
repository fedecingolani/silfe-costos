"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { Pastilla, Tarjeta, Vacio } from "@/components/ui";
import {
  armarComprobanteCompra,
  buscarArticulos,
  cambiosAlElegirArticulo,
  comprobanteEnviado,
  editorComprobanteCompraNuevo,
  editorDeComprobanteCompra,
  filaCompraVacia,
  filaPercepcionVacia,
  renglonCalculable,
  type EditorComprobanteCompra as EstadoEditor,
  type FilaCompra,
  type FilaPercepcion,
  type ModoRenglon,
} from "@/lib/compras/comprobantes/borrador";
import { discriminaIva, letraSugerida } from "@/lib/compras/comprobantes/letra";
import {
  confirmaConPrecios,
  editorNotaDeFactura,
  esNotaCompra,
  facturaAsociadaEnEditor,
  type AvisoFacturaAsociada,
  type FacturaAsociable,
  type NotaAsociada,
  type TipoNotaCompra,
} from "@/lib/compras/comprobantes/nota";
import { NOMBRES_TIPO_COMPROBANTE_COMPRA, numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import { calcularRenglonCompra, totalesComprobanteCompra } from "@/lib/compras/comprobantes/totales";
import { PROVINCIAS } from "@/lib/compras/provincias";
import { fecha, numero, pesos } from "@/lib/formato";
import {
  ALICUOTAS_IVA,
  LETRAS_COMPRA,
  NO_GRAVADO,
  TIPOS_COMPROBANTE_COMPRA,
  type LetraCompra,
  type ProveedorArticulo,
  type TipoComprobanteCompra,
  type PrecioComprobanteCompra,
  type TipoPercepcionCompra,
} from "@/lib/tipos";
import { Confirmacion } from "../../remitos/Confirmacion";
import { ActualizarPrecios } from "./ActualizarPrecios";
import {
  articulosDelProveedor,
  borrarComprobanteCompra,
  confirmarComprobanteCompra,
  facturasAsociables,
  guardarComprobanteCompra,
  preciosComprobanteCompra,
  type ResultadoComprobanteCompra,
} from "./acciones";
import type { ComprobanteCompraCargado, ContextoEditorCompra, MateriaPrimaOfrecida } from "./datos";

const RUTA = "/compras/comprobantes";

const NOMBRES_MODO: Record<ModoRenglon, string> = {
  articulo: "Artículo del proveedor",
  nuevo: "Artículo nuevo",
  libre: "Renglón libre (flete, servicio)",
};

const NOMBRES_PERCEPCION: Record<TipoPercepcionCompra, string> = {
  iva: "IVA",
  iibb: "Ingresos brutos",
  otro: "Otro",
};

/**
 * Editor de un comprobante de compra (nuevo o borrador): cabecera,
 * renglones (artículo del proveedor, artículo nuevo o renglón libre),
 * percepciones y vista previa de los totales. Guarda el borrador, lo
 * confirma (guarda y después confirma) o lo borra. Los totales que valen los
 * calcula la base al guardar. Una nota puede indicar la factura que corrige;
 * abierta desde una factura (notaDe), arranca con sus renglones y precios.
 */
export function EditorComprobanteCompra({
  guardado,
  notaDe = null,
  contexto,
  articulos: articulosIniciales,
  facturas: facturasIniciales = [],
  errorFacturas = null,
  facturaAsociada,
  hoy,
}: {
  guardado: ComprobanteCompraCargado | null;
  /** Nota nueva desde una factura confirmada: copia sus renglones y precios. */
  notaDe?: { factura: ComprobanteCompraCargado; tipo: TipoNotaCompra } | null;
  contexto: ContextoEditorCompra;
  /** Catálogo del proveedor del comprobante guardado (o de la factura de notaDe). */
  articulos: ProveedorArticulo[];
  /** Facturas confirmadas del proveedor y la letra, para asociar a una nota. */
  facturas?: FacturaAsociable[];
  /** Si no se pudo leer la lista de facturas: el mensaje. */
  errorFacturas?: string | null;
  /**
   * La factura asociada guardada (o la de notaDe), leída por id: puede no
   * estar en la lista. null si no existe; undefined si no se leyó.
   */
  facturaAsociada?: NotaAsociada | null;
  hoy: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  // Un comprobante nuevo toma su id al guardarse: así un segundo intento lo
  // actualiza en vez de crear otro, aunque el editor siga montado.
  const [id, setId] = useState<string | null>(guardado?.comprobante.id ?? null);
  // Último proveedor elegido: descarta catálogos que llegan tarde de uno anterior.
  const proveedorPedido = useRef<string>(
    guardado?.comprobante.proveedor_id ?? notaDe?.factura.comprobante.proveedor_id ?? "",
  );
  const [resultado, setResultado] = useState<ResultadoComprobanteCompra | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);
  // Editor abierto en «nuevo»: al confirmar se navega a la dirección del
  // comprobante (la de history.replaceState no la conoce el router).
  const abiertoComoNuevo = useRef(guardado === null);
  // Comprobante guardado a punto de confirmarse, con sus precios para elegir.
  const [porConfirmar, setPorConfirmar] = useState<{ id: string; lineas: PrecioComprobanteCompra[] } | null>(null);

  // Las filas se arman en el navegador: sus claves salen de un contador del módulo.
  const [editor, setEditor] = useState<EstadoEditor>(() =>
    guardado
      ? editorDeComprobanteCompra(guardado.comprobante, guardado.items, guardado.percepciones)
      : notaDe
        ? editorNotaDeFactura(notaDe.factura.comprobante, notaDe.factura.items, notaDe.tipo, hoy)
        : editorComprobanteCompraNuevo(hoy),
  );
  // Mientras no se elija la letra a mano, sigue a la condición del proveedor.
  const [letraElegida, setLetraElegida] = useState(guardado !== null || notaDe !== null);
  const [articulos, setArticulos] = useState(articulosIniciales);
  const [facturas, setFacturas] = useState(facturasIniciales);
  // Las facturas se volvieron a leer (otro proveedor, letra o tipo): el error inicial ya no vale.
  const [facturasLeidas, setFacturasLeidas] = useState(false);
  // Último proveedor y letra pedidos: descarta listas de facturas que llegan tarde.
  const facturasPedidas = useRef("");
  const esNota = esNotaCompra(editor.tipo);

  const conIva = discriminaIva(editor.letra);
  const proveedores = contexto.proveedores.filter((p) => p.activo || p.id === editor.proveedorId);
  const proveedor = contexto.proveedores.find((p) => p.id === editor.proveedorId);
  const materias = useMemo(() => new Map(contexto.materiasPrimas.map((m) => [m.id, m])), [contexto.materiasPrimas]);
  const articulosPorId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos]);

  const totales = totalesComprobanteCompra(editor.filas.map(renglonCalculable), editor.percepciones, editor.letra);

  // ----- Cambios ------------------------------------------------------------

  function cambiar(cambios: Partial<EstadoEditor>) {
    setEditor((actual) => ({ ...actual, ...cambios }));
  }

  function cambiarFila(clave: string, cambios: Partial<FilaCompra>) {
    setEditor((actual) => ({
      ...actual,
      filas: actual.filas.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)),
    }));
  }

  function cambiarPercepcion(clave: string, cambios: Partial<FilaPercepcion>) {
    setEditor((actual) => ({
      ...actual,
      percepciones: actual.percepciones.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)),
    }));
  }

  /** Lee las facturas que se pueden asociar a una nota de ese proveedor y letra. */
  async function leerFacturas(proveedorId: string, letra: LetraCompra, tipo: TipoComprobanteCompra) {
    const clave = `${proveedorId}|${letra}`;
    facturasPedidas.current = clave;
    setFacturasLeidas(true);
    if (!proveedorId || !esNotaCompra(tipo)) {
      setFacturas([]);
      return;
    }
    const lista = await facturasAsociables(proveedorId, letra);
    if (facturasPedidas.current === clave) setFacturas(lista);
  }

  /**
   * Otro proveedor: se lee su catálogo y los renglones pierden el artículo
   * elegido (era del anterior). Si la letra no se eligió a mano, se sugiere
   * la de su condición frente al IVA. La factura asociada era del anterior.
   */
  async function cambiarProveedor(proveedorId: string) {
    const elegido = contexto.proveedores.find((p) => p.id === proveedorId);
    const letra = letraElegida ? editor.letra : letraSugerida(elegido?.condicion_iva);
    setEditor((actual) => ({
      ...actual,
      proveedorId,
      letra,
      comprobanteAsociadoId: "",
      filas: actual.filas.map((f) => (f.modo === "articulo" ? { ...f, articuloId: null } : f)),
    }));
    proveedorPedido.current = proveedorId;
    void leerFacturas(proveedorId, letra, editor.tipo);
    const catalogo = proveedorId ? await articulosDelProveedor(proveedorId) : [];
    if (proveedorPedido.current === proveedorId) setArticulos(catalogo);
  }

  /** La factura asociada tiene la letra de la nota: con otra letra se elige de nuevo. */
  function cambiarLetra(letra: LetraCompra) {
    setLetraElegida(true);
    cambiar({ letra, comprobanteAsociadoId: "" });
    void leerFacturas(editor.proveedorId, letra, editor.tipo);
  }

  function cambiarTipo(tipo: TipoComprobanteCompra) {
    cambiar({ tipo });
    if (esNotaCompra(tipo) && !esNota) void leerFacturas(editor.proveedorId, editor.letra, tipo);
  }

  // ----- Acciones -----------------------------------------------------------

  /** Valida en el navegador y guarda; devuelve el id guardado o null si hubo un error. */
  async function guardar(): Promise<string | null> {
    const enviado = comprobanteEnviado(editor);
    const armado = armarComprobanteCompra(enviado);
    if ("errores" in armado) {
      setResultado({ error: armado.errores.join(" ") });
      return null;
    }
    const r = await guardarComprobanteCompra(id, JSON.stringify(enviado));
    if (r.error || !r.id) {
      // Objeto nuevo en cada error: el diálogo se vuelve a abrir aunque el mensaje se repita.
      setResultado({ error: r.error ?? "No se pudo guardar el comprobante." });
      return null;
    }
    setId(r.id);
    return r.id;
  }

  function guardarBorrador() {
    setAviso(null);
    iniciar(async () => {
      const guardadoId = await guardar();
      if (!guardadoId) return;
      if (id === null) {
        router.replace(`${RUTA}/${guardadoId}`);
        return;
      }
      setAviso("Comprobante guardado.");
      router.refresh();
    });
  }

  /**
   * Guarda y abre la confirmación con los precios de la factura para elegir
   * cuáles se actualizan. Si algo falla, el borrador queda guardado. Sin
   * navegar (desmontaría el editor y se perdería el error): sólo se ajusta
   * la dirección al comprobante.
   */
  function prepararConfirmacion() {
    setAviso(null);
    iniciar(async () => {
      const guardadoId = await guardar();
      if (!guardadoId) return;
      if (id === null) window.history.replaceState(null, "", `${RUTA}/${guardadoId}`);
      // Las notas no actualizan precios: confirmación común.
      if (!confirmaConPrecios(editor.tipo)) {
        setPorConfirmar({ id: guardadoId, lineas: [] });
        return;
      }
      const r = await preciosComprobanteCompra(guardadoId);
      if ("error" in r) {
        setResultado({ error: r.error });
        return;
      }
      setPorConfirmar({ id: guardadoId, lineas: r.lineas });
    });
  }

  /** Confirma el comprobante guardado y actualiza los precios elegidos, todo junto. */
  function confirmar(actualizarPrecios: string[]) {
    if (!porConfirmar) return;
    const guardadoId = porConfirmar.id;
    setPorConfirmar(null);
    iniciar(async () => {
      const r = await confirmarComprobanteCompra(guardadoId, actualizarPrecios);
      if (r.error) {
        setResultado({ error: r.error });
        return;
      }
      if (abiertoComoNuevo.current) router.replace(`${RUTA}/${guardadoId}`);
      else router.refresh();
    });
  }

  function borrar() {
    if (!id) return;
    iniciar(async () => {
      const r = await borrarComprobanteCompra(id);
      if (r?.error) setResultado({ error: r.error });
    });
  }

  // ----- Pantalla -----------------------------------------------------------

  const columnas = conIva ? 9 : 7;

  return (
    <div className="space-y-4">
      {aviso && (
        <div className="rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">{aviso}</div>
      )}

      <Tarjeta titulo="Cabecera">
        <div className="grid gap-3 p-4 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label className="etiqueta" htmlFor="proveedor">
              Proveedor *
            </label>
            <select
              id="proveedor"
              value={editor.proveedorId}
              onChange={(e) => cambiarProveedor(e.target.value)}
              className="campo"
            >
              <option value="">Elegí el proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.activo ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
            {proveedor && (
              <Link href={`/proveedores/${proveedor.id}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
                Ver ficha y catálogo del proveedor
              </Link>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="tipo">
              Tipo *
            </label>
            <select
              id="tipo"
              value={editor.tipo}
              onChange={(e) => cambiarTipo(e.target.value as TipoComprobanteCompra)}
              className="campo"
            >
              {TIPOS_COMPROBANTE_COMPRA.map((t) => (
                <option key={t} value={t}>
                  {NOMBRES_TIPO_COMPROBANTE_COMPRA[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="letra">
              Letra *
            </label>
            <select
              id="letra"
              value={editor.letra}
              onChange={(e) => cambiarLetra(e.target.value as LetraCompra)}
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
              value={editor.puntoVenta}
              onChange={(e) => cambiar({ puntoVenta: e.target.value })}
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
              value={editor.numero}
              onChange={(e) => cambiar({ numero: e.target.value })}
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
              value={editor.fecha}
              onChange={(e) => cambiar({ fecha: e.target.value })}
              className="campo"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="vencimiento">
              Vencimiento
            </label>
            <input
              id="vencimiento"
              type="date"
              value={editor.fechaVencimiento}
              onChange={(e) => cambiar({ fechaVencimiento: e.target.value })}
              className="campo"
            />
          </div>
          {esNota && (
            <FacturaAsociada
              valor={editor.comprobanteAsociadoId}
              facturas={facturas}
              asociada={facturaAsociada}
              error={facturasLeidas ? null : errorFacturas}
              proveedorElegido={editor.proveedorId !== ""}
              onCambiar={(comprobanteAsociadoId) => cambiar({ comprobanteAsociadoId })}
            />
          )}
          <div className="sm:col-span-6">
            <label className="etiqueta" htmlFor="observaciones">
              Observaciones
            </label>
            <textarea
              id="observaciones"
              rows={2}
              value={editor.observaciones}
              onChange={(e) => cambiar({ observaciones: e.target.value })}
              className="campo"
            />
          </div>
          <p className="text-xs text-stone-500 sm:col-span-6">
            {conIva
              ? "Las letras A y M discriminan IVA: los precios van sin IVA y cada renglón lleva su alícuota."
              : "Las letras B y C no discriminan IVA: los precios incluyen el IVA y todo va a no gravado (salvo lo exento)."}
            {proveedor?.condicion_iva && ` El proveedor es ${proveedor.condicion_iva}.`}
          </p>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Renglones"
        descripcion="Código y descripción tal como figuran en el comprobante del proveedor."
        acciones={
          <button
            type="button"
            onClick={() => cambiar({ filas: [...editor.filas, filaCompraVacia()] })}
            className="boton-secundario"
          >
            + Agregar renglón
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="min-w-80">Artículo / descripción</th>
                <th className="w-24">Cantidad</th>
                <th className="w-32">Precio</th>
                <th className="w-20">% dto</th>
                {conIva && <th className="w-28">IVA %</th>}
                <th className="w-16">Exento</th>
                <th className="text-right">Importe</th>
                {conIva && <th className="text-right">IVA</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {editor.filas.length === 0 && <Vacio mensaje="Agregá al menos un renglón." colSpan={columnas} />}
              {editor.filas.map((f, i) => {
                const calculado = calcularRenglonCompra(renglonCalculable(f), editor.letra);
                return (
                  <tr key={f.clave} className="align-top">
                    <td>
                      <CeldaArticulo
                        fila={f}
                        indice={i}
                        proveedorElegido={editor.proveedorId !== ""}
                        articulos={articulos}
                        articulosPorId={articulosPorId}
                        materias={materias}
                        materiasPrimas={contexto.materiasPrimas}
                        onCambiar={(cambios) => cambiarFila(f.clave, cambios)}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={f.cantidad}
                        onChange={(e) => cambiarFila(f.clave, { cantidad: e.target.value })}
                        className="campo text-right"
                        aria-label={`Cantidad del renglón ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={f.precioUnitario}
                        onChange={(e) => cambiarFila(f.clave, { precioUnitario: e.target.value })}
                        className="campo text-right"
                        aria-label={`Precio del renglón ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={f.descuentoPct}
                        onChange={(e) => cambiarFila(f.clave, { descuentoPct: e.target.value })}
                        className="campo text-right"
                        aria-label={`Descuento del renglón ${i + 1}`}
                      />
                    </td>
                    {conIva && (
                      <td>
                        <select
                          value={f.alicuotaIva}
                          disabled={f.exento}
                          onChange={(e) => cambiarFila(f.clave, { alicuotaIva: e.target.value })}
                          className="campo"
                          aria-label={`Alícuota del renglón ${i + 1}`}
                        >
                          {ALICUOTAS_IVA.map((a) => (
                            <option key={a} value={String(a)}>
                              {numero(a, 1)}%
                            </option>
                          ))}
                          <option value={NO_GRAVADO}>No gravado</option>
                        </select>
                      </td>
                    )}
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={f.exento}
                        onChange={(e) => cambiarFila(f.clave, { exento: e.target.checked })}
                        aria-label={`Renglón ${i + 1} exento`}
                        className="mt-2.5 rounded"
                      />
                    </td>
                    <td className="text-right tabular-nums">{calculado ? pesos(calculado.importe) : "—"}</td>
                    {conIva && <td className="text-right tabular-nums">{calculado ? pesos(calculado.iva) : "—"}</td>}
                    <td>
                      <button
                        type="button"
                        onClick={() => cambiar({ filas: editor.filas.filter((x) => x.clave !== f.clave) })}
                        className="boton-peligro px-2 py-1 text-xs"
                        aria-label={`Quitar el renglón ${i + 1}`}
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
      </Tarjeta>

      <Tarjeta
        titulo="Percepciones"
        descripcion="De IVA, de ingresos brutos (por jurisdicción) y otros impuestos."
        acciones={
          <button
            type="button"
            onClick={() => cambiar({ percepciones: [...editor.percepciones, filaPercepcionVacia()] })}
            className="boton-secundario"
          >
            + Agregar percepción
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-40">Tipo</th>
                <th className="w-64">Jurisdicción</th>
                <th>Descripción</th>
                <th className="w-36">Importe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {editor.percepciones.length === 0 && <Vacio mensaje="Sin percepciones." colSpan={5} />}
              {editor.percepciones.map((p, i) => {
                const provincias =
                  p.jurisdiccion && !(PROVINCIAS as readonly string[]).includes(p.jurisdiccion)
                    ? [p.jurisdiccion, ...PROVINCIAS]
                    : PROVINCIAS;
                return (
                  <tr key={p.clave}>
                    <td>
                      <select
                        value={p.tipo}
                        onChange={(e) => {
                          const tipo = e.target.value as TipoPercepcionCompra;
                          cambiarPercepcion(p.clave, { tipo, jurisdiccion: tipo === "iibb" ? p.jurisdiccion : "" });
                        }}
                        className="campo"
                        aria-label={`Tipo de la percepción ${i + 1}`}
                      >
                        {(Object.keys(NOMBRES_PERCEPCION) as TipoPercepcionCompra[]).map((t) => (
                          <option key={t} value={t}>
                            {NOMBRES_PERCEPCION[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {p.tipo === "iibb" ? (
                        <select
                          value={p.jurisdiccion}
                          onChange={(e) => cambiarPercepcion(p.clave, { jurisdiccion: e.target.value })}
                          className="campo"
                          aria-label={`Jurisdicción de la percepción ${i + 1}`}
                        >
                          <option value="">Elegí la jurisdicción</option>
                          {provincias.map((provincia) => (
                            <option key={provincia} value={provincia}>
                              {provincia}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-stone-400">—</span>
                      )}
                    </td>
                    <td>
                      <input
                        value={p.descripcion}
                        onChange={(e) => cambiarPercepcion(p.clave, { descripcion: e.target.value })}
                        placeholder={p.tipo === "otro" ? "Qué impuesto" : "Opcional"}
                        className="campo"
                        aria-label={`Descripción de la percepción ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={p.importe}
                        onChange={(e) => cambiarPercepcion(p.clave, { importe: e.target.value })}
                        className="campo text-right"
                        aria-label={`Importe de la percepción ${i + 1}`}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          cambiar({ percepciones: editor.percepciones.filter((x) => x.clave !== p.clave) })
                        }
                        className="boton-peligro px-2 py-1 text-xs"
                        aria-label={`Quitar la percepción ${i + 1}`}
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
      </Tarjeta>

      <Tarjeta titulo="Totales" descripcion="Vista previa: los totales que valen los calcula la base al guardar.">
        <dl className="ml-auto max-w-xs space-y-1 p-4 text-sm">
          {conIva && <Linea etiqueta="Neto gravado" valor={totales.netoGravado} />}
          {totales.ivaPorAlicuota.map((a) => (
            <Linea key={a.alicuota} etiqueta={`IVA ${numero(a.alicuota, 1)}%`} valor={a.iva} />
          ))}
          <Linea etiqueta="No gravado" valor={totales.noGravado} />
          <Linea etiqueta="Exento" valor={totales.exento} />
          {totales.percepcionIva > 0 && <Linea etiqueta="Percepciones de IVA" valor={totales.percepcionIva} />}
          {totales.percepcionIibb > 0 && <Linea etiqueta="Percepciones de IIBB" valor={totales.percepcionIibb} />}
          {totales.otrosImpuestos > 0 && <Linea etiqueta="Otros impuestos" valor={totales.otrosImpuestos} />}
          <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{pesos(totales.total)}</dd>
          </div>
        </dl>
      </Tarjeta>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pendiente} onClick={guardarBorrador} className="boton-primario">
          {pendiente ? "Guardando…" : "Guardar borrador"}
        </button>
        <button
          type="button"
          disabled={pendiente}
          onClick={prepararConfirmacion}
          title={
            esNota
              ? "Se guarda y se confirma. Las notas no actualizan precios de materias primas."
              : "Se guarda y se confirma; antes elegís qué precios de materias primas se actualizan."
          }
          className="boton-secundario"
        >
          Confirmar
        </button>
        {id && (
          <Confirmacion
            boton="Borrar"
            clase="boton-peligro"
            titulo="¿Borrar el comprobante?"
            mensaje="Se borra el borrador con sus renglones y percepciones. No se puede deshacer."
            confirmar="Borrar"
            claseConfirmar="boton-peligro"
            deshabilitado={pendiente}
            onConfirmar={borrar}
          />
        )}
      </div>
      {porConfirmar && (
        <ActualizarPrecios
          lineas={porConfirmar.lineas}
          onCancelar={() => setPorConfirmar(null)}
          onConfirmar={confirmar}
        />
      )}
      <ModalError estado={resultado} />
    </div>
  );
}

function Linea({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-stone-500">{etiqueta}</dt>
      <dd className="tabular-nums">{pesos(valor)}</dd>
    </div>
  );
}

const TEXTOS_AVISO_FACTURA: Record<AvisoFacturaAsociada, string> = {
  no_confirmada: "Factura que ya no está confirmada: elegí otra",
  inexistente: "Factura que ya no existe: elegí otra",
  sin_datos: "Factura guardada (no se pudieron leer sus datos)",
};

/**
 * Factura que corrige una nota (opcional). Elegirla no cambia los renglones:
 * los copia sólo el botón de la factura. La guardada se ofrece aunque quede
 * fuera de la lista; si ya no está confirmada o no existe, se muestra igual
 * para que se elija otra.
 */
function FacturaAsociada({
  valor,
  facturas,
  asociada,
  error,
  proveedorElegido,
  onCambiar,
}: {
  valor: string;
  facturas: FacturaAsociable[];
  asociada: NotaAsociada | null | undefined;
  error: string | null;
  proveedorElegido: boolean;
  onCambiar: (id: string) => void;
}) {
  const { opciones, aviso } = facturaAsociadaEnEditor(valor, facturas, asociada);
  const elegida = opciones.find((f) => f.id === valor);
  return (
    <div className="sm:col-span-3">
      <label className="etiqueta" htmlFor="factura-asociada">
        Factura asociada
      </label>
      <select
        id="factura-asociada"
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        disabled={!proveedorElegido}
        className="campo"
      >
        <option value="">Sin factura asociada (nota suelta)</option>
        {aviso && <option value={valor}>{TEXTOS_AVISO_FACTURA[aviso]}</option>}
        {opciones.map((f) => (
          <option key={f.id} value={f.id}>
            {numeroComprobanteCompra(f)} · {fecha(f.fecha)} · {pesos(f.total)}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {valor !== "" ? (
        <Link href={`${RUTA}/${valor}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
          Ver factura{elegida ? ` ${numeroComprobanteCompra(elegida)}` : ""}
        </Link>
      ) : (
        <p className="mt-1 text-xs text-stone-500">
          Facturas confirmadas del proveedor con la misma letra. Elegirla no cambia los renglones.
        </p>
      )}
    </div>
  );
}

/** «código — nombre (unidad de compra)» */
export function nombreMateria(m: MateriaPrimaOfrecida): string {
  return `${m.codigo} — ${m.nombre} (${m.unidad_compra})`;
}

/**
 * Primera celda del renglón: qué es (artículo del proveedor, artículo nuevo
 * o libre), el artículo o los datos del nuevo, y el código y la descripción
 * tal como los escribió el proveedor.
 */
function CeldaArticulo({
  fila: f,
  indice: i,
  proveedorElegido,
  articulos,
  articulosPorId,
  materias,
  materiasPrimas,
  onCambiar,
}: {
  fila: FilaCompra;
  indice: number;
  proveedorElegido: boolean;
  articulos: ProveedorArticulo[];
  articulosPorId: ReadonlyMap<string, ProveedorArticulo>;
  materias: ReadonlyMap<string, MateriaPrimaOfrecida>;
  materiasPrimas: MateriaPrimaOfrecida[];
  onCambiar: (cambios: Partial<FilaCompra>) => void;
}) {
  const articulo = f.articuloId ? articulosPorId.get(f.articuloId) : undefined;
  const materia = articulo?.materia_prima_id ? materias.get(articulo.materia_prima_id) : undefined;
  const ofrecidas = materiasPrimas.filter((m) => m.activo || m.id === f.materiaPrimaId);

  return (
    <div className="space-y-1">
      <select
        value={f.modo}
        onChange={(e) => onCambiar({ modo: e.target.value as ModoRenglon, articuloId: null, busqueda: "" })}
        className="campo text-xs"
        aria-label={`Tipo de renglón ${i + 1}`}
      >
        {(Object.keys(NOMBRES_MODO) as ModoRenglon[]).map((m) => (
          <option key={m} value={m}>
            {NOMBRES_MODO[m]}
          </option>
        ))}
      </select>

      {f.modo === "articulo" &&
        (f.articuloId ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span>
                {articulo ? (
                  <>
                    {articulo.codigo && <span className="font-medium tabular-nums">{articulo.codigo} </span>}
                    {articulo.descripcion}
                    {articulo.unidad && <span className="text-stone-500"> · {articulo.unidad}</span>}
                    {!articulo.activo && <span className="text-stone-400"> (inactivo)</span>}
                  </>
                ) : (
                  <span className="text-stone-500">Artículo del catálogo</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onCambiar({ articuloId: null })}
                className="text-marca-700 hover:underline"
              >
                Cambiar
              </button>
            </div>
            {articulo &&
              (materia ? (
                <p className="mt-0.5 text-stone-500">
                  Materia prima: {nombreMateria(materia)}
                  {articulo.factor_conversion !== 1 && ` · factor ${numero(articulo.factor_conversion, 8)}`}
                </p>
              ) : articulo.materia_prima_id ? (
                <p className="mt-0.5 text-stone-500">Materia prima asociada</p>
              ) : (
                <p className="mt-1" title="No deja confirmar el comprobante: asociala en el catálogo del proveedor.">
                  <Pastilla tono="ambar">⚠ Sin materia prima: no deja confirmar</Pastilla>
                </p>
              ))}
          </div>
        ) : (
          <BuscadorArticulo
            articulos={articulos}
            texto={f.busqueda}
            onTexto={(busqueda) => onCambiar({ busqueda })}
            onElegir={(a) => onCambiar(cambiosAlElegirArticulo(a))}
            etiqueta={`Artículo del renglón ${i + 1}`}
            deshabilitado={!proveedorElegido}
          />
        ))}

      {f.modo === "nuevo" && (
        <div className="grid grid-cols-6 gap-1">
          <select
            value={f.materiaPrimaId}
            onChange={(e) => onCambiar({ materiaPrimaId: e.target.value })}
            className="campo col-span-6 text-xs"
            aria-label={`Materia prima del renglón ${i + 1}`}
          >
            <option value="">Elegí la materia prima</option>
            {ofrecidas.map((m) => (
              <option key={m.id} value={m.id}>
                {nombreMateria(m)}
              </option>
            ))}
          </select>
          <input
            value={f.unidad}
            onChange={(e) => onCambiar({ unidad: e.target.value })}
            placeholder="Unidad (rollo, caja)"
            className="campo col-span-3 text-xs"
            aria-label={`Unidad del renglón ${i + 1}`}
          />
          <input
            inputMode="decimal"
            value={f.factor}
            onChange={(e) => onCambiar({ factor: e.target.value })}
            placeholder="Factor"
            title="Cuántas unidades de compra de la materia prima equivale una unidad del proveedor"
            className="campo col-span-3 text-right text-xs"
            aria-label={`Factor de conversión del renglón ${i + 1}`}
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-1">
        <input
          value={f.codigo}
          onChange={(e) => onCambiar({ codigo: e.target.value })}
          placeholder="Código"
          className="campo text-xs"
          aria-label={`Código del proveedor del renglón ${i + 1}`}
        />
        <input
          value={f.descripcion}
          onChange={(e) => onCambiar({ descripcion: e.target.value })}
          placeholder={f.modo === "libre" ? "Descripción (flete, servicio)" : "Descripción del proveedor"}
          className="campo col-span-2 text-xs"
          aria-label={`Descripción del renglón ${i + 1}`}
        />
      </div>
    </div>
  );
}

/** Buscador de los artículos activos del proveedor por código o descripción (filtra en el navegador). También lo usa el editor de remitos de compra. */
export function BuscadorArticulo({
  articulos,
  texto,
  onTexto,
  onElegir,
  etiqueta,
  deshabilitado,
}: {
  articulos: ProveedorArticulo[];
  texto: string;
  onTexto: (texto: string) => void;
  onElegir: (articulo: ProveedorArticulo) => void;
  etiqueta: string;
  deshabilitado: boolean;
}) {
  const encontrados = buscarArticulos(articulos, texto);
  return (
    <div className="relative">
      <input
        type="search"
        value={texto}
        disabled={deshabilitado}
        onChange={(e) => onTexto(e.target.value)}
        placeholder={deshabilitado ? "Elegí primero el proveedor" : "Buscar artículo por código o descripción"}
        className="campo"
        aria-label={etiqueta}
      />
      {texto.trim() !== "" && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white text-sm shadow-lg">
          {encontrados.length === 0 && (
            <li className="px-3 py-2 text-stone-400">
              Ningún artículo activo coincide. Usá «Artículo nuevo» para darlo de alta.
            </li>
          )}
          {encontrados.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onElegir(a)}
                className="block w-full px-3 py-1.5 text-left hover:bg-marca-50"
              >
                {a.codigo && <span className="font-medium tabular-nums">{a.codigo} </span>}
                {a.descripcion}
                {!a.materia_prima_id && <span className="ml-1 text-xs text-amber-700">(sin materia prima)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

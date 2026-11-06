"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModalError } from "@/components/ModalError";
import { Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { cambiosAlElegirArticulo } from "@/lib/compras/comprobantes/borrador";
import {
  armarRemitoCompra,
  editorDeRemitoCompra,
  editorRemitoCompraNuevo,
  filaRemitoCompraVacia,
  remitoCompraEnviado,
  type EditorRemitoCompra as EstadoEditor,
  type FilaRemitoCompra,
  type ModoRenglonRemito,
} from "@/lib/compras/remitos/borrador";
import { numero } from "@/lib/formato";
import type { ProveedorArticulo } from "@/lib/tipos";
import { articulosDelProveedor } from "../comprobantes/acciones";
import type { ContextoEditorCompra, MateriaPrimaOfrecida } from "../comprobantes/datos";
import { BuscadorArticulo, nombreMateria } from "../comprobantes/EditorComprobanteCompra";
import { AccionesRemitoCompra } from "./AccionesRemitoCompra";
import { guardarRemitoCompra, type ResultadoRemitoCompra } from "./acciones";
import type { RemitoCompraCargado } from "./datos";

const RUTA = "/compras/remitos";

const NOMBRES_MODO: Record<ModoRenglonRemito, string> = {
  articulo: "Artículo del proveedor",
  nuevo: "Artículo nuevo",
};

/**
 * Editor de un remito de compra (nuevo o borrador): proveedor, número del
 * remito del proveedor, fecha, observaciones y renglones. Cada renglón es
 * un artículo del catálogo del proveedor o uno nuevo con su materia prima
 * (se da de alta al guardar, como en las facturas). Guarda el borrador; con
 * lo guardado se recibe o se borra.
 */
export function EditorRemitoCompra({
  guardado,
  contexto,
  articulos: articulosIniciales,
  hoy,
}: {
  guardado: RemitoCompraCargado | null;
  contexto: ContextoEditorCompra;
  /** Catálogo del proveedor del remito guardado. */
  articulos: ProveedorArticulo[];
  hoy: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const id = guardado?.remito.id ?? null;
  const [resultado, setResultado] = useState<ResultadoRemitoCompra | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);
  // Último proveedor elegido: descarta catálogos que llegan tarde de uno anterior.
  const proveedorPedido = useRef(guardado?.remito.proveedor_id ?? "");

  // Las filas se arman en el navegador: sus claves salen de un contador del módulo.
  const [editor, setEditor] = useState<EstadoEditor>(() =>
    guardado ? editorDeRemitoCompra(guardado.remito, guardado.items) : editorRemitoCompraNuevo(hoy),
  );
  const [articulos, setArticulos] = useState(articulosIniciales);

  // Se recibe lo guardado: con cambios sin guardar, Recibir espera.
  const actual = JSON.stringify(remitoCompraEnviado(editor));
  const [ultimoGuardado, setUltimoGuardado] = useState(actual);
  const sinCambios = actual === ultimoGuardado;

  const proveedores = contexto.proveedores.filter((p) => p.activo || p.id === editor.proveedorId);
  const proveedor = contexto.proveedores.find((p) => p.id === editor.proveedorId);
  const materias = useMemo(() => new Map(contexto.materiasPrimas.map((m) => [m.id, m])), [contexto.materiasPrimas]);
  const articulosPorId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos]);

  // ----- Cambios ------------------------------------------------------------

  function cambiar(cambios: Partial<EstadoEditor>) {
    setEditor((e) => ({ ...e, ...cambios }));
  }

  function cambiarFila(clave: string, cambios: Partial<FilaRemitoCompra>) {
    setEditor((e) => ({ ...e, filas: e.filas.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)) }));
  }

  /** Otro proveedor: se lee su catálogo y los renglones pierden el artículo elegido (era del anterior). */
  async function cambiarProveedor(proveedorId: string) {
    setEditor((e) => ({
      ...e,
      proveedorId,
      filas: e.filas.map((f) => (f.modo === "articulo" ? { ...f, articuloId: null } : f)),
    }));
    proveedorPedido.current = proveedorId;
    const catalogo = proveedorId ? await articulosDelProveedor(proveedorId) : [];
    if (proveedorPedido.current === proveedorId) setArticulos(catalogo);
  }

  // ----- Acciones -----------------------------------------------------------

  function guardar() {
    setAviso(null);
    const enviado = remitoCompraEnviado(editor);
    const armado = armarRemitoCompra(enviado);
    if ("errores" in armado) {
      setResultado({ error: armado.errores.join(" ") });
      return;
    }
    const datos = JSON.stringify(enviado);
    iniciar(async () => {
      const r = await guardarRemitoCompra(id, datos);
      if (r.error || !r.id) {
        // Objeto nuevo en cada error: el diálogo se vuelve a abrir aunque el mensaje se repita.
        setResultado({ error: r.error ?? "No se pudo guardar el remito." });
        return;
      }
      if (id === null) {
        router.replace(`${RUTA}/${r.id}`);
        return;
      }
      setUltimoGuardado(datos);
      setAviso("Remito guardado.");
      router.refresh();
    });
  }

  // ----- Pantalla -----------------------------------------------------------

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
          <div>
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
            Punto de venta y número del remito del proveedor, tal como figuran en el papel.
          </p>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Renglones"
        descripcion="Cada renglón es un artículo del proveedor. Código y descripción tal como figuran en su remito."
        acciones={
          <button
            type="button"
            onClick={() => cambiar({ filas: [...editor.filas, filaRemitoCompraVacia()] })}
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
                <th className="w-32">Cantidad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {editor.filas.length === 0 && <Vacio mensaje="Agregá al menos un renglón." colSpan={3} />}
              {editor.filas.map((f, i) => (
                <tr key={f.clave} className="align-top">
                  <td>
                    <CeldaArticuloRemito
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
                    {f.unidad && <p className="mt-1 text-right text-xs text-stone-500">{f.unidad}</p>}
                  </td>
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
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pendiente} onClick={guardar} className="boton-primario">
          {pendiente ? "Guardando…" : "Guardar borrador"}
        </button>
        {id && <AccionesRemitoCompra id={id} proveedorId={editor.proveedorId} estado="borrador" sinCambios={sinCambios} />}
      </div>
      {id && !sinCambios && <p className="text-xs text-stone-500">Hay cambios sin guardar: guardalos para recibir el remito.</p>}
      <ModalError estado={resultado} />
    </div>
  );
}

/**
 * Primera celda del renglón: artículo del catálogo (con buscador) o
 * artículo nuevo (materia prima, unidad y factor), y el código y la
 * descripción tal como los escribió el proveedor.
 */
function CeldaArticuloRemito({
  fila: f,
  indice: i,
  proveedorElegido,
  articulos,
  articulosPorId,
  materias,
  materiasPrimas,
  onCambiar,
}: {
  fila: FilaRemitoCompra;
  indice: number;
  proveedorElegido: boolean;
  articulos: ProveedorArticulo[];
  articulosPorId: ReadonlyMap<string, ProveedorArticulo>;
  materias: ReadonlyMap<string, MateriaPrimaOfrecida>;
  materiasPrimas: MateriaPrimaOfrecida[];
  onCambiar: (cambios: Partial<FilaRemitoCompra>) => void;
}) {
  const articulo = f.articuloId ? articulosPorId.get(f.articuloId) : undefined;
  const materia = articulo?.materia_prima_id ? materias.get(articulo.materia_prima_id) : undefined;
  const ofrecidas = materiasPrimas.filter((m) => m.activo || m.id === f.materiaPrimaId);

  return (
    <div className="space-y-1">
      <select
        value={f.modo}
        onChange={(e) => onCambiar({ modo: e.target.value as ModoRenglonRemito, articuloId: null, busqueda: "" })}
        className="campo text-xs"
        aria-label={`Tipo de renglón ${i + 1}`}
      >
        {(Object.keys(NOMBRES_MODO) as ModoRenglonRemito[]).map((m) => (
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
              <button type="button" onClick={() => onCambiar({ articuloId: null })} className="text-marca-700 hover:underline">
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
                <p className="mt-1" title="No deja recibir el remito: asociala en el catálogo del proveedor.">
                  <Pastilla tono="ambar">⚠ Sin materia prima: no deja recibir</Pastilla>
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
          placeholder="Descripción del proveedor"
          className="campo col-span-2 text-xs"
          aria-label={`Descripción del renglón ${i + 1}`}
        />
      </div>
    </div>
  );
}

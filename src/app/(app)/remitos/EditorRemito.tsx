"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tarjeta } from "@/components/ui";
import { CamposComerciales, type DatosComerciales } from "@/components/ventas/CamposComerciales";
import { TablaItems } from "@/components/ventas/TablaItems";
import { mapaPrecios } from "@/lib/comprobantes/borrador";
import { numero, pesos } from "@/lib/formato";
import {
  editorDeRemito,
  filaRemitoEnviada,
  filaRemitoVacia,
  remitoEnviado,
  type EditorRemito as EstadoEditor,
  type FilaItemRemito,
} from "@/lib/remitos/borrador";
import {
  bultosTotal,
  erroresRemito,
  valorDeclaradoAlCambiarItems,
  valorDeclaradoEditado,
  valorDeclaradoInicial,
  volverAlValorSugerido,
  type ValorDeclarado,
} from "@/lib/remitos/editor";
import type { EstadoRemito, Remito, RemitoItem } from "@/lib/tipos";
import { preciosDeLista, type ClienteEncontrado } from "../comprobantes/acciones";
import { BuscadorCliente } from "../comprobantes/BuscadorCliente";
import type { ContextoEditor } from "../comprobantes/datos";
import { AccionesRemito } from "./AccionesRemito";
import { datosDeEntrega, guardarRemito } from "./acciones";
import type { TransporteOfrecido } from "./datos";

/** Remito guardado que se puede editar (borrador o emitido sin nada facturado). */
export type RemitoEditable = {
  remito: Remito;
  items: RemitoItem[];
  cliente: ClienteEncontrado;
  /** Estado derivado (v_remito_estado). */
  estado: EstadoRemito;
};

type Items = { filas: FilaItemRemito[]; valorDeclarado: ValorDeclarado };

/** Estado inicial de un remito nuevo: hoy, el primer punto de venta y la primera lista. */
function editorNuevo(contexto: Pick<ContextoEditor, "listas" | "puntosVenta">, hoy: string): EstadoEditor {
  const filas = [filaRemitoVacia()];
  return {
    clienteId: "",
    puntoVenta: contexto.puntosVenta[0] ? String(contexto.puntosVenta[0].numero) : "",
    fecha: hoy,
    fechaVencimientoPago: hoy,
    condicionPago: "cuenta_corriente",
    listaPrecioId: contexto.listas[0]?.id ?? null,
    transporteId: "",
    domicilioEntrega: "",
    observaciones: "",
    valorDeclarado: valorDeclaradoInicial(filas.map(filaRemitoEnviada)),
    filas,
  };
}

/**
 * Editor de un remito (nuevo, borrador o emitido sin nada facturado):
 * cliente, punto de venta, campos comerciales, transporte, domicilio de
 * entrega, ítems con bultos y valor declarado. El valor declarado sigue a la
 * suma de los importes hasta que se lo cambia a mano. En un emitido no se
 * cambian el cliente ni el punto de venta.
 */
export function EditorRemito({
  remito,
  contexto,
  transportes,
  precios: preciosIniciales,
  hoy,
}: {
  remito: RemitoEditable | null;
  contexto: Pick<ContextoEditor, "listas" | "productos" | "puntosVenta">;
  transportes: TransporteOfrecido[];
  precios: { producto_id: string | null; precio_final: number }[];
  hoy: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const id = remito?.remito.id ?? null;
  const emitido = remito?.estado === "emitido";
  const [mensaje, setMensaje] = useState<{ error?: string; ok?: string } | null>(null);

  // Las filas se arman en el navegador (no en el servidor): sus claves salen de un contador del módulo.
  const [inicial] = useState<EstadoEditor>(() =>
    remito ? editorDeRemito(remito.remito, remito.items, contexto.productos) : editorNuevo(contexto, hoy),
  );
  const [cliente, setCliente] = useState<ClienteEncontrado | null>(remito?.cliente ?? null);
  const [puntoVenta, setPuntoVenta] = useState(inicial.puntoVenta);
  const [comerciales, setComerciales] = useState<DatosComerciales>({
    fecha: inicial.fecha,
    vencimiento: inicial.fechaVencimientoPago,
    condicion: inicial.condicionPago,
    listaId: inicial.listaPrecioId,
    observaciones: inicial.observaciones,
  });
  const [transporteId, setTransporteId] = useState(inicial.transporteId);
  const [domicilioEntrega, setDomicilioEntrega] = useState(inicial.domicilioEntrega);
  const [items, setItems] = useState<Items>({ filas: inicial.filas, valorDeclarado: inicial.valorDeclarado });
  const [precios, setPrecios] = useState(() => mapaPrecios(preciosIniciales));
  const { filas, valorDeclarado } = items;

  // Puntos de venta activos, más el del remito si ya no está activo (no se cambia en un emitido).
  const puntos = contexto.puntosVenta.map((p) => p.numero);
  if (puntoVenta && !puntos.includes(Number(puntoVenta))) puntos.push(Number(puntoVenta));
  // Transportes activos, más el elegido si está inactivo.
  const transportesOfrecidos = transportes.filter((t) => t.activo || t.id === transporteId);

  // ----- Cambios ------------------------------------------------------------

  async function cambiarComerciales(cambios: Partial<DatosComerciales>) {
    setComerciales((actuales) => ({ ...actuales, ...cambios }));
    if ("listaId" in cambios) {
      const nueva = cambios.listaId ?? null;
      setPrecios(mapaPrecios(nueva ? await preciosDeLista(nueva) : []));
    }
  }

  /** Cambiar los ítems recalcula la sugerencia del valor declarado (si no se cambió a mano). */
  function cambiarFilas(actualizar: (actuales: FilaItemRemito[]) => FilaItemRemito[]) {
    setItems((actuales) => {
      const nuevas = actualizar(actuales.filas);
      return {
        filas: nuevas,
        valorDeclarado: valorDeclaradoAlCambiarItems(actuales.valorDeclarado, nuevas.map(filaRemitoEnviada)),
      };
    });
  }

  /** Al elegir otro cliente, transporte y domicilio de entrega arrancan con los suyos. */
  async function cambiarCliente(nuevo: ClienteEncontrado | null) {
    setCliente(nuevo);
    if (!nuevo) return;
    const entrega = await datosDeEntrega(nuevo.id);
    if (!entrega) return;
    setTransporteId(entrega.transporteId);
    setDomicilioEntrega(entrega.domicilioEntrega);
  }

  // ----- Acciones -----------------------------------------------------------

  const editor: EstadoEditor = {
    clienteId: cliente?.id ?? "",
    puntoVenta,
    fecha: comerciales.fecha,
    fechaVencimientoPago: comerciales.vencimiento,
    condicionPago: comerciales.condicion,
    listaPrecioId: comerciales.listaId,
    transporteId,
    domicilioEntrega,
    observaciones: comerciales.observaciones,
    valorDeclarado,
    filas,
  };
  // Se emite y se factura lo guardado: con cambios sin guardar, esos botones esperan.
  const actual = JSON.stringify(remitoEnviado(editor));
  const [guardado, setGuardado] = useState(actual);
  const sinCambios = actual === guardado;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMensaje(null);
    const enviado = remitoEnviado(editor);
    const errores = erroresRemito(enviado);
    if (errores.length > 0) {
      setMensaje({ error: errores.join(" ") });
      return;
    }
    const datos = JSON.stringify(enviado);
    iniciar(async () => {
      // Uno nuevo redirige a su dirección; uno editado devuelve "ok".
      const resultado = await guardarRemito(id, datos);
      if (resultado?.error) {
        setMensaje({ error: resultado.error });
        return;
      }
      if (!resultado?.ok) return;
      setGuardado(datos);
      setMensaje({ ok: resultado.ok });
      router.refresh();
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
            <BuscadorCliente cliente={cliente} onCambiar={cambiarCliente} deshabilitado={emitido} />
            {cliente && (
              <Link href={`/clientes/${cliente.id}`} className="mt-1 inline-block text-xs text-marca-700 hover:underline">
                Ver ficha del cliente
              </Link>
            )}
          </div>
          <div>
            <label className="etiqueta" htmlFor="punto-venta">
              Punto de venta *
            </label>
            <select
              id="punto-venta"
              value={puntoVenta}
              disabled={emitido}
              onChange={(e) => setPuntoVenta(e.target.value)}
              className="campo"
            >
              {puntos.length === 0 && <option value="">No hay puntos de venta activos</option>}
              {puntos.map((n) => (
                <option key={n} value={String(n)}>
                  {String(n).padStart(5, "0")}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden sm:col-span-2 sm:block" />
          <CamposComerciales valores={comerciales} onCambiar={cambiarComerciales} listas={contexto.listas} />
        </div>
      </Tarjeta>

      <Tarjeta titulo="Entrega">
        <div className="grid gap-3 p-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="transporte">
              Transporte
            </label>
            <select
              id="transporte"
              value={transporteId}
              onChange={(e) => setTransporteId(e.target.value)}
              className="campo"
            >
              <option value="">Sin transporte</option>
              {transportesOfrecidos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activo ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className="etiqueta" htmlFor="domicilio-entrega">
              Domicilio de entrega
            </label>
            <input
              id="domicilio-entrega"
              value={domicilioEntrega}
              onChange={(e) => setDomicilioEntrega(e.target.value)}
              placeholder="Dirección, localidad, provincia"
              className="campo"
            />
          </div>
        </div>
      </Tarjeta>

      <TablaItems<FilaItemRemito>
        filas={filas}
        onCambiar={cambiarFilas}
        productos={contexto.productos}
        precios={precios}
        nuevaFila={filaRemitoVacia}
        columnaExtra={{
          titulo: "Bultos",
          clase: "w-20",
          celda: (f, i, cambiar) => (
            <input
              inputMode="numeric"
              value={f.bultos}
              onChange={(e) => cambiar({ bultos: e.target.value })}
              className="campo text-right"
              aria-label={`Bultos del ítem ${i + 1}`}
            />
          ),
        }}
      />

      <Tarjeta titulo="Transporte de la mercadería">
        <div className="grid gap-3 p-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <p className="etiqueta">Bultos total</p>
            <p className="py-2 text-sm font-semibold tabular-nums">{numero(bultosTotal(filas), 0)}</p>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="valor-declarado">
              Valor declarado
            </label>
            <input
              id="valor-declarado"
              inputMode="decimal"
              value={valorDeclarado.valor}
              onChange={(e) =>
                setItems((actuales) => ({ ...actuales, valorDeclarado: valorDeclaradoEditado(e.target.value) }))
              }
              className="campo text-right"
            />
            {valorDeclarado.manual ? (
              <button
                type="button"
                onClick={() =>
                  setItems((actuales) => ({
                    ...actuales,
                    valorDeclarado: volverAlValorSugerido(actuales.filas.map(filaRemitoEnviada)),
                  }))
                }
                className="mt-1 text-xs font-medium text-marca-700 hover:underline"
              >
                Usar la suma de los ítems
              </button>
            ) : (
              <p className="mt-1 text-xs text-stone-500">
                La suma de los importes de los ítems ({pesos(Number(valorDeclarado.valor))}), sin IVA.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pendiente} className="boton-primario">
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        {id && remito && (
          <AccionesRemito id={id} clienteId={remito.remito.cliente_id} estado={remito.estado} sinCambios={sinCambios} />
        )}
      </div>
      {id && !sinCambios && <p className="text-xs text-stone-500">Hay cambios sin guardar: guardalos para emitir o facturar.</p>}
    </form>
  );
}

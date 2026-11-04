import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta } from "@/components/ui";
import { fecha, fechaHora, numero, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { ivaDelComprobante } from "@/lib/comprobantes/pdf-datos";
import { NOMBRES_ESTADO, TONO_ESTADO, nombreComprobante, numeroVisible } from "@/lib/comprobantes/listado";
import { permisosRemito } from "@/lib/remitos/editor";
import { NOMBRES_ESTADO_REMITO, TONO_ESTADO_REMITO } from "@/lib/remitos/listado";
import { numeroVisibleRemito } from "@/lib/remitos/numero";
import {
  NOMBRES_CONDICION_PAGO,
  type ClaseComprobante,
  type EstadoComprobante,
  type EstadoRemito,
  type LetraComprobante,
} from "@/lib/tipos";
import type { ClienteEncontrado } from "../../comprobantes/acciones";
import { cargarContextoEditor, cargarPrecios } from "../../comprobantes/datos";
import { AccionesRemito } from "../AccionesRemito";
import { cargarRemito, cargarTransportes } from "../datos";
import { EditorRemito } from "../EditorRemito";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FacturaVinculada = {
  id: string;
  fecha: string;
  clase: ClaseComprobante;
  letra: LetraComprobante | null;
  punto_venta: number;
  numero: number | null;
  estado: EstadoComprobante;
};

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

export default async function RemitoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const [cargado, { data: estadoData, error: errorEstado }] = await Promise.all([
    cargarRemito(supabase, id),
    supabase.from("v_remito_estado").select("estado").eq("remito_id", id).maybeSingle(),
  ]);
  if (typeof cargado === "string" || errorEstado) {
    const mensaje = typeof cargado === "string" ? cargado : errorEstado!.message;
    return <p className="text-sm text-red-700">Error al cargar el remito: {mensaje}</p>;
  }
  if (!cargado || !estadoData) notFound();
  const { remito: r, items } = cargado;
  const estado = estadoData.estado as EstadoRemito;
  const permisos = permisosRemito(estado);

  const { data: clienteData } = await supabase
    .from("cliente")
    .select("id, razon_social, cuit, condicion_iva, codigo_legado")
    .eq("id", r.cliente_id)
    .maybeSingle();
  const cliente = clienteData as ClienteEncontrado | null;

  const titulo = `Remito ${numeroVisibleRemito(r)}`;
  const pastilla = <Pastilla tono={TONO_ESTADO_REMITO[estado]}>{NOMBRES_ESTADO_REMITO[estado]}</Pastilla>;
  const migas = <Migas items={[{ href: "/remitos", texto: "Remitos" }, { texto: titulo }]} />;

  // ----- Borrador o emitido sin facturar: se edita -----------------------------

  if (permisos.puedeEditar) {
    const [contexto, transportes] = await Promise.all([cargarContextoEditor(supabase), cargarTransportes(supabase)]);
    if (typeof contexto === "string" || typeof transportes === "string") {
      const error = typeof contexto === "string" ? contexto : transportes;
      return <p className="text-sm text-red-700">Error al cargar los datos del remito: {error as string}</p>;
    }
    if (!cliente) return <p className="text-sm text-red-700">No se encontró el cliente del remito.</p>;
    const precios = await cargarPrecios(supabase, r.lista_precio_id);

    return (
      <>
        {migas}
        <Encabezado
          titulo={titulo}
          descripcion={
            estado === "borrador"
              ? "Borrador: se puede editar, borrar o emitir. El número se asigna al emitirlo."
              : `Emitido el ${fechaHora(r.emitido_en)}: se puede editar, facturar o anular mientras no tenga nada facturado.`
          }
          acciones={pastilla}
        />
        <EditorRemito
          remito={{ remito: r, items, cliente, estado }}
          contexto={contexto}
          transportes={transportes}
          precios={precios}
          hoy={hoyArgentina()}
        />
      </>
    );
  }

  // ----- Parcial, facturado o anulado: sólo lectura -----------------------------

  const conFacturas = estado === "parcial" || estado === "facturado";
  const itemIds = items.map((i) => i.id);
  const [{ data: transporteData }, { data: listaData }, pendientesRes, vinculosRes] = await Promise.all([
    r.transporte_id
      ? supabase.from("transporte").select("nombre").eq("id", r.transporte_id).maybeSingle()
      : Promise.resolve({ data: null }),
    r.lista_precio_id
      ? supabase.from("lista_precio").select("nombre").eq("id", r.lista_precio_id).maybeSingle()
      : Promise.resolve({ data: null }),
    conFacturas
      ? supabase.from("v_remito_item_pendiente").select("remito_item_id, facturado, pendiente").eq("remito_id", id)
      : Promise.resolve({ data: [], error: null }),
    conFacturas && itemIds.length > 0
      ? supabase.from("comprobante_item").select("comprobante_id").in("remito_item_id", itemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const errorFacturado = pendientesRes.error ?? vinculosRes.error;
  if (errorFacturado) {
    return <p className="text-sm text-red-700">Error al cargar lo facturado del remito: {errorFacturado.message}</p>;
  }
  const facturadoPorItem = new Map(
    (pendientesRes.data ?? []).map((p) => [
      p.remito_item_id as string,
      { facturado: Number(p.facturado), pendiente: Number(p.pendiente) },
    ]),
  );
  const facturaIds = [...new Set((vinculosRes.data ?? []).map((v) => v.comprobante_id as string))];
  let facturas: FacturaVinculada[] = [];
  if (facturaIds.length > 0) {
    const { data, error } = await supabase
      .from("comprobante")
      .select("id, fecha, clase, letra, punto_venta, numero, estado")
      .in("id", facturaIds)
      .order("fecha");
    if (error) return <p className="text-sm text-red-700">Error al cargar las facturas del remito: {error.message}</p>;
    facturas = (data ?? []) as FacturaVinculada[];
  }

  const ivaPorAlicuota = ivaDelComprobante({ iva: r.iva, iva_detalle: null }, items).alicuotas;
  const descripcion =
    estado === "anulado"
      ? `Anulado el ${fechaHora(r.anulado_en)}: conserva el número, ya no se modifica ni se factura.`
      : estado === "parcial"
        ? "Facturado en parte: ya no se modifica. Lo pendiente se puede facturar."
        : "Facturado por completo: ya no se modifica.";

  return (
    <>
      {migas}
      <Encabezado titulo={titulo} descripcion={descripcion} acciones={pastilla} />

      {permisos.puedeFacturar && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <AccionesRemito id={r.id} clienteId={r.cliente_id} estado={estado} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Remito">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <Dato etiqueta="Número">{numeroVisibleRemito(r)}</Dato>
            <Dato etiqueta="Fecha">{fecha(r.fecha)}</Dato>
            <Dato etiqueta="Punto de venta">{String(r.punto_venta).padStart(5, "0")}</Dato>
            <Dato etiqueta="Emitido">{fechaHora(r.emitido_en)}</Dato>
            <Dato etiqueta="Condición de pago">{NOMBRES_CONDICION_PAGO[r.condicion_pago]}</Dato>
            <Dato etiqueta="Vencimiento del cobro">{fecha(r.fecha_vencimiento_pago)}</Dato>
            <Dato etiqueta="Lista de precios">{listaData?.nombre ?? "—"}</Dato>
            {r.observaciones && (
              <div className="col-span-2">
                <Dato etiqueta="Observaciones">{r.observaciones}</Dato>
              </div>
            )}
          </dl>
        </Tarjeta>
        <Tarjeta titulo="Cliente y entrega">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <div className="col-span-2">
              <Dato etiqueta="Razón social">
                {cliente ? (
                  <Link href={`/clientes/${cliente.id}`} className="text-marca-700 hover:underline">
                    {cliente.razon_social}
                  </Link>
                ) : (
                  "—"
                )}
              </Dato>
            </div>
            <Dato etiqueta="CUIT">{cliente?.cuit ?? "—"}</Dato>
            <Dato etiqueta="Condición IVA">{cliente?.condicion_iva ?? "—"}</Dato>
            <Dato etiqueta="Transporte">{transporteData?.nombre ?? "Sin transporte"}</Dato>
            <Dato etiqueta="Domicilio de entrega">{r.domicilio_entrega ?? "—"}</Dato>
            <Dato etiqueta="Bultos total">{numero(r.bultos_total, 0)}</Dato>
            <Dato etiqueta="Valor declarado">{pesos(r.valor_declarado)}</Dato>
          </dl>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Ítems" className="mt-4">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Bultos</th>
                {conFacturas && <th className="text-right">Facturado</th>}
                {conFacturas && <th className="text-right">Pendiente</th>}
                <th className="text-right">Precio</th>
                <th className="text-right">% dto</th>
                <th className="text-right">Importe</th>
                <th className="text-right">IVA %</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const f = facturadoPorItem.get(i.id);
                return (
                  <tr key={i.id}>
                    <td className="tabular-nums">{i.codigo ?? "—"}</td>
                    <td>
                      {i.descripcion}
                      {i.observaciones && <p className="text-xs text-stone-500">{i.observaciones}</p>}
                    </td>
                    <td className="text-right tabular-nums">
                      {numero(i.cantidad, 4)} {i.unidad ?? ""}
                    </td>
                    <td className="text-right tabular-nums">{numero(i.bultos, 0)}</td>
                    {conFacturas && <td className="text-right tabular-nums">{f ? numero(f.facturado, 4) : "—"}</td>}
                    {conFacturas && (
                      <td
                        className={`text-right tabular-nums ${f && f.pendiente > 0 ? "font-medium text-amber-800" : ""}`}
                      >
                        {f ? numero(f.pendiente, 4) : "—"}
                      </td>
                    )}
                    <td className="text-right tabular-nums">{numero(i.precio_unitario, 4)}</td>
                    <td className="text-right tabular-nums">{numero(i.descuento_pct, 2)}</td>
                    <td className="text-right tabular-nums">{pesos(i.importe)}</td>
                    <td className="text-right tabular-nums">
                      {i.gravado ? `${numero(Number(i.alicuota_iva), 1)}%` : "No grav."}
                    </td>
                    <td className="text-right tabular-nums">{pesos(i.importe + i.iva)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Neto gravado</dt>
            <dd className="tabular-nums">{pesos(r.neto)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">No gravado</dt>
            <dd className="tabular-nums">{pesos(r.no_gravado)}</dd>
          </div>
          {ivaPorAlicuota.map((a) => (
            <div key={a.id} className="flex justify-between">
              <dt className="text-stone-500">IVA {numero(a.alicuota, 1)}%</dt>
              <dd className="tabular-nums">{pesos(a.importe)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{pesos(r.total)}</dd>
          </div>
          <div className="flex justify-between pt-2">
            <dt className="text-stone-500">Bultos total</dt>
            <dd className="tabular-nums">{numero(r.bultos_total, 0)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Valor declarado</dt>
            <dd className="tabular-nums">{pesos(r.valor_declarado)}</dd>
          </div>
        </dl>
      </Tarjeta>

      {conFacturas && (
        <Tarjeta titulo="Facturas" descripcion="Comprobantes con ítems de este remito, borradores incluidos." className="mt-4">
          {facturas.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">No se encontraron las facturas vinculadas.</p>
          ) : (
            <ul className="divide-y divide-stone-200">
              {facturas.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <Link href={`/comprobantes/${c.id}`} className="font-medium text-marca-700 hover:underline">
                    {nombreComprobante(c.clase, c.letra)} {numeroVisible(c)}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="text-stone-500">{fecha(c.fecha)}</span>
                    <Pastilla tono={TONO_ESTADO[c.estado]}>{NOMBRES_ESTADO[c.estado]}</Pastilla>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      )}
    </>
  );
}

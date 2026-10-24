import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta } from "@/components/ui";
import { fecha, fechaHora, numero, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { ivaDelComprobante } from "@/lib/comprobantes/pdf-datos";
import {
  NOMBRES_ESTADO_PRESUPUESTO,
  TONO_ESTADO_PRESUPUESTO,
  estaVencido,
  numeroPresupuesto,
} from "@/lib/presupuestos/listado";
import { NOMBRES_CONDICION_PAGO, type Presupuesto, type PresupuestoItem } from "@/lib/tipos";
import type { ClienteEncontrado } from "../../comprobantes/acciones";
import { cargarContextoEditor, cargarPrecios } from "../../comprobantes/datos";
import { COLUMNAS_ITEM, COLUMNAS_PRESUPUESTO } from "../datos";
import { EditorPresupuesto } from "../EditorPresupuesto";
import { AccionesDetalle } from "./AccionesDetalle";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PresupuestoLeido = Omit<Presupuesto, "creado_por" | "creado_en" | "actualizado_en">;
type ItemLeido = Omit<PresupuestoItem, "presupuesto_id">;

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

export default async function PresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const [{ data, error }, { data: itemsData, error: errorItems }] = await Promise.all([
    supabase.from("presupuesto").select(COLUMNAS_PRESUPUESTO).eq("id", id).maybeSingle(),
    supabase.from("presupuesto_item").select(COLUMNAS_ITEM).eq("presupuesto_id", id).order("orden"),
  ]);
  if (error || errorItems) {
    return <p className="text-sm text-red-700">Error al cargar el presupuesto: {(error ?? errorItems)?.message}</p>;
  }
  if (!data) notFound();
  const p = data as unknown as PresupuestoLeido;
  const items = (itemsData ?? []) as unknown as ItemLeido[];

  const { data: clienteData } = await supabase
    .from("cliente")
    .select("id, razon_social, cuit, condicion_iva, codigo_legado")
    .eq("id", p.cliente_id)
    .maybeSingle();
  const cliente = clienteData as ClienteEncontrado | null;

  const hoy = hoyArgentina();
  const titulo = `Presupuesto ${numeroPresupuesto(p.numero)}`;
  const vencido = p.estado === "abierto" && estaVencido(p.valido_hasta, hoy);
  const estado = (
    <span className="flex items-center gap-2">
      {vencido && <Pastilla tono="ambar">Vencido</Pastilla>}
      <Pastilla tono={TONO_ESTADO_PRESUPUESTO[p.estado]}>{NOMBRES_ESTADO_PRESUPUESTO[p.estado]}</Pastilla>
    </span>
  );
  const migas = <Migas items={[{ href: "/presupuestos", texto: "Presupuestos" }, { texto: titulo }]} />;

  // ----- Abierto: se edita ------------------------------------------------------

  if (p.estado === "abierto") {
    const contexto = await cargarContextoEditor(supabase);
    if (typeof contexto === "string") {
      return <p className="text-sm text-red-700">Error al cargar los datos del presupuesto: {contexto}</p>;
    }
    if (!cliente) return <p className="text-sm text-red-700">No se encontró el cliente del presupuesto.</p>;
    const precios = await cargarPrecios(supabase, p.lista_precio_id);

    return (
      <>
        {migas}
        <Encabezado
          titulo={titulo}
          descripcion={
            vencido
              ? `Venció el ${fecha(p.valido_hasta)}: se puede editar y convertir igual.`
              : `Abierto: se puede editar. Válido hasta el ${fecha(p.valido_hasta)}.`
          }
          acciones={estado}
        />
        <EditorPresupuesto
          presupuesto={{
            id: p.id,
            fecha: p.fecha,
            valido_hasta: p.valido_hasta,
            fecha_vencimiento_pago: p.fecha_vencimiento_pago,
            condicion_pago: p.condicion_pago,
            lista_precio_id: p.lista_precio_id,
            observaciones: p.observaciones,
            cliente,
            items: items.map((i) => ({
              producto_id: i.producto_id,
              codigo: i.codigo,
              descripcion: i.descripcion,
              observaciones: i.observaciones,
              cantidad: Number(i.cantidad),
              precio_unitario: Number(i.precio_unitario),
              descuento_pct: Number(i.descuento_pct),
              gravado: i.gravado,
              alicuota_iva: i.alicuota_iva === null ? null : Number(i.alicuota_iva),
            })),
          }}
          contexto={contexto}
          precios={precios}
          hoy={hoy}
        />
      </>
    );
  }

  // ----- Convertido: sólo lectura ---------------------------------------------

  const ivaPorAlicuota = ivaDelComprobante({ iva: p.iva, iva_detalle: null }, items).alicuotas;

  return (
    <>
      {migas}
      <Encabezado
        titulo={titulo}
        descripcion="Convertido en factura: ya no se modifica. Para otro parecido, duplicalo."
        acciones={estado}
      />

      {p.comprobante_id && (
        <div role="status" className="mb-4 rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          Convertido el {fechaHora(p.convertido_en)}.{" "}
          <Link href={`/comprobantes/${p.comprobante_id}`} className="font-medium underline">
            Ver la factura
          </Link>
        </div>
      )}

      <div className="mb-4">
        <AccionesDetalle id={p.id} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Presupuesto">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <Dato etiqueta="Número">{numeroPresupuesto(p.numero)}</Dato>
            <Dato etiqueta="Fecha">{fecha(p.fecha)}</Dato>
            <Dato etiqueta="Válido hasta">{fecha(p.valido_hasta)}</Dato>
            <Dato etiqueta="Condición de pago">{NOMBRES_CONDICION_PAGO[p.condicion_pago]}</Dato>
            <Dato etiqueta="Vencimiento del cobro">{fecha(p.fecha_vencimiento_pago)}</Dato>
            {p.observaciones && (
              <div className="col-span-2">
                <Dato etiqueta="Observaciones">{p.observaciones}</Dato>
              </div>
            )}
          </dl>
        </Tarjeta>
        <Tarjeta titulo="Cliente">
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
                <th className="text-right">Precio</th>
                <th className="text-right">% dto</th>
                <th className="text-right">Importe</th>
                <th className="text-right">IVA %</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="tabular-nums">{i.codigo ?? "—"}</td>
                  <td>
                    {i.descripcion}
                    {i.observaciones && <p className="text-xs text-stone-500">{i.observaciones}</p>}
                  </td>
                  <td className="text-right tabular-nums">
                    {numero(Number(i.cantidad), 4)} {i.unidad ?? ""}
                  </td>
                  <td className="text-right tabular-nums">{numero(Number(i.precio_unitario), 4)}</td>
                  <td className="text-right tabular-nums">{numero(Number(i.descuento_pct), 2)}</td>
                  <td className="text-right tabular-nums">{pesos(Number(i.importe))}</td>
                  <td className="text-right tabular-nums">
                    {i.gravado ? `${numero(Number(i.alicuota_iva), 1)}%` : "No grav."}
                  </td>
                  <td className="text-right tabular-nums">{pesos(Number(i.importe) + Number(i.iva))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Neto gravado</dt>
            <dd className="tabular-nums">{pesos(Number(p.neto))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">No gravado</dt>
            <dd className="tabular-nums">{pesos(Number(p.no_gravado))}</dd>
          </div>
          {ivaPorAlicuota.map((a) => (
            <div key={a.id} className="flex justify-between">
              <dt className="text-stone-500">IVA {numero(a.alicuota, 1)}%</dt>
              <dd className="tabular-nums">{pesos(a.importe)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{pesos(Number(p.total))}</dd>
          </div>
        </dl>
      </Tarjeta>
    </>
  );
}

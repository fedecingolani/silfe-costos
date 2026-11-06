import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, fechaHora, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { sumarPesos } from "@/lib/cobranzas/dinero";
import { TONO_ESTADO_CHEQUE } from "@/lib/cobranzas/cartera";
import { numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import { NOMBRES_ESTADO_ORDEN_PAGO, TONO_ESTADO_ORDEN_PAGO, avisoDeParametroPago } from "@/lib/compras/pagos/listado";
import { NOMBRES_ESTADO_CHEQUE, NOMBRES_MEDIO_PAGO_COMPRA } from "@/lib/tipos";
import {
  cargarCartera,
  cargarCuentaProveedor,
  cargarOrdenPago,
  cargarProveedores,
  medioEditable,
  type MedioLeido,
} from "../datos";
import { EditorOrdenPago } from "../EditorOrdenPago";
import { AnularOrdenPago } from "./AnularOrdenPago";

export const dynamic = "force-dynamic";

// Pendiente posible: PDF de la orden de pago, como el del recibo (/cobranzas/[id]/pdf).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

/** Detalle de un medio: referencia de la transferencia o datos del cheque. */
function DetalleMedio({ medio }: { medio: MedioLeido }) {
  if (medio.tipo === "cheque_tercero" && medio.cheque) {
    const ch = medio.cheque;
    return (
      <span>
        <Link href={`/cheques/${ch.id}`} className="text-marca-700 hover:underline">
          {ch.banco} N° {ch.numero}
        </Link>{" "}
        · pago {fecha(ch.fecha_pago)}
        {ch.librador && ` · ${ch.librador}`}{" "}
        <Pastilla tono={TONO_ESTADO_CHEQUE[ch.estado]}>{NOMBRES_ESTADO_CHEQUE[ch.estado]}</Pastilla>
      </span>
    );
  }
  if (medio.tipo === "cheque_propio") {
    return (
      <span>
        {medio.banco} N° {medio.numero} · pago {fecha(medio.fecha_pago)}
      </span>
    );
  }
  if (medio.tipo === "transferencia") return <span>{medio.referencia || "—"}</span>;
  return <span>—</span>;
}

export default async function OrdenPagoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const aviso = avisoDeParametroPago((await searchParams).aviso);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const leida = await cargarOrdenPago(supabase, id);
  if (typeof leida === "string") return <p className="text-sm text-red-700">{leida}</p>;
  if (!leida) notFound();
  const { orden, medios, imputaciones } = leida;

  const titulo = orden.numero_texto ? `Orden de pago ${orden.numero_texto}` : "Orden de pago en borrador";
  const migas = <Migas items={[{ href: "/compras/pagos", texto: "Pagos" }, { texto: titulo }]} />;
  const estado = <Pastilla tono={TONO_ESTADO_ORDEN_PAGO[orden.estado]}>{NOMBRES_ESTADO_ORDEN_PAGO[orden.estado]}</Pastilla>;

  // ----- Borrador: se edita ----------------------------------------------------

  if (orden.estado === "borrador") {
    const elegidos = medios.flatMap((m) => (m.cheque_id ? [m.cheque_id] : []));
    const [proveedores, cartera, cuenta] = await Promise.all([
      cargarProveedores(supabase),
      cargarCartera(supabase, elegidos),
      cargarCuentaProveedor(supabase, orden.proveedor_id),
    ]);
    if (typeof proveedores === "string") return <p className="text-sm text-red-700">{proveedores}</p>;
    if (typeof cartera === "string") return <p className="text-sm text-red-700">{cartera}</p>;
    if (typeof cuenta === "string") return <p className="text-sm text-red-700">{cuenta}</p>;

    return (
      <>
        {migas}
        <Encabezado titulo={titulo} descripcion="Borrador: se edita hasta confirmarla." acciones={estado} />
        <EditorOrdenPago
          orden={{
            id: orden.id,
            proveedorId: orden.proveedor_id,
            fecha: orden.fecha,
            observaciones: orden.observaciones,
            medios: medios.map(medioEditable),
            imputaciones: imputaciones.map((i) => ({
              comprobanteId: i.comprobante_compra_id,
              importe: i.importe,
              numeroTexto: i.comprobante ? numeroComprobanteCompra(i.comprobante) : null,
            })),
          }}
          proveedores={proveedores}
          cartera={cartera}
          cuentaInicial={cuenta}
          hoy={hoyArgentina()}
          aviso={aviso}
        />
      </>
    );
  }

  // ----- Confirmada o anulada: sólo lectura --------------------------------------

  const { data: proveedor } = await supabase
    .from("proveedor")
    .select("id, nombre, cuit")
    .eq("id", orden.proveedor_id)
    .maybeSingle();
  const imputado = sumarPesos(imputaciones.map((i) => i.importe));
  const aFavor = sumarPesos([orden.total, -imputado]);
  const chequesTerceros = medios.flatMap((m) =>
    m.tipo === "cheque_tercero" && m.cheque ? [{ banco: m.cheque.banco, numero: m.cheque.numero, estado: m.cheque.estado }] : [],
  );

  return (
    <>
      {migas}
      <Encabezado
        titulo={titulo}
        descripcion={
          orden.estado === "anulado"
            ? "Anulada: sus imputaciones se deshicieron y sus cheques de terceros volvieron a la cartera."
            : "Confirmada: no se modifica. Si se cargó mal, se anula."
        }
        acciones={estado}
      />

      {aviso && (
        <div role="status" className="mb-4 rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          {aviso}
        </div>
      )}

      {orden.estado === "confirmado" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <AnularOrdenPago id={orden.id} numero={orden.numero_texto ?? ""} cheques={chequesTerceros} />
        </div>
      )}

      {orden.estado === "anulado" && orden.motivo_anulacion && (
        <div role="status" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Motivo de la anulación: {orden.motivo_anulacion}
        </div>
      )}

      <Tarjeta titulo="Orden de pago">
        <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Dato etiqueta="Número">{orden.numero_texto ?? "—"}</Dato>
          <Dato etiqueta="Fecha">{fecha(orden.fecha)}</Dato>
          <Dato etiqueta="Proveedor">
            {proveedor ? (
              <Link href={`/proveedores/${proveedor.id}`} className="text-marca-700 hover:underline">
                {proveedor.nombre}
              </Link>
            ) : (
              "—"
            )}
          </Dato>
          <Dato etiqueta="Total">
            <span className="font-semibold tabular-nums">{pesos(orden.total)}</span>
          </Dato>
          <Dato etiqueta="Confirmada el">{fechaHora(orden.confirmado_en)}</Dato>
          {orden.anulado_en && <Dato etiqueta="Anulada el">{fechaHora(orden.anulado_en)}</Dato>}
          {orden.observaciones && (
            <div className="col-span-2 sm:col-span-4">
              <Dato etiqueta="Observaciones">{orden.observaciones}</Dato>
            </div>
          )}
        </dl>
      </Tarjeta>

      <Tarjeta titulo="Medios de pago" className="mt-4">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Medio</th>
                <th>Detalle</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {medios.map((m) => (
                <tr key={m.id}>
                  <td>{NOMBRES_MEDIO_PAGO_COMPRA[m.tipo]}</td>
                  <td>
                    <DetalleMedio medio={m} />
                  </td>
                  <td className="text-right tabular-nums">{pesos(m.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Imputaciones" className="mt-4">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Fecha</th>
                <th>Origen</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {imputaciones.length === 0 && (
                <Vacio
                  mensaje={
                    orden.estado === "anulado"
                      ? "Las imputaciones se deshicieron al anularla."
                      : "No imputó comprobantes: todo quedó a favor."
                  }
                  colSpan={4}
                />
              )}
              {imputaciones.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/compras/comprobantes/${i.comprobante_compra_id}`} className="text-marca-700 hover:underline">
                      {i.comprobante ? numeroComprobanteCompra(i.comprobante) : "Comprobante"}
                    </Link>
                  </td>
                  <td>{fecha(i.comprobante?.fecha)}</td>
                  <td>{i.automatica ? "Saldo a favor (automática)" : "Pago"}</td>
                  <td className="text-right tabular-nums">{pesos(i.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orden.estado === "confirmado" && (
          <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-500">Imputado</dt>
              <dd className="tabular-nums">{pesos(imputado)}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
              <dt>Quedó a favor</dt>
              <dd className="tabular-nums">{pesos(aFavor)}</dd>
            </div>
          </dl>
        )}
      </Tarjeta>

    </>
  );
}

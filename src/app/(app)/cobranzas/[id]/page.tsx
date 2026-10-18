import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, fechaHora, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { nombreComprobante, numeroVisible } from "@/lib/comprobantes/listado";
import { sumarPesos } from "@/lib/cobranzas/dinero";
import { NOMBRES_ESTADO_RECIBO, TONO_ESTADO_RECIBO } from "@/lib/cobranzas/listado";
import { TONO_ESTADO_CHEQUE } from "@/lib/cobranzas/cartera";
import { avisoDeParametro } from "@/lib/cobranzas/editor";
import {
  NOMBRES_ESTADO_CHEQUE,
  NOMBRES_MEDIO_PAGO,
  NOMBRES_RETENCION,
  type LetraComprobante,
  type TipoRetencion,
} from "@/lib/tipos";
import type { ClienteEncontrado } from "../../comprobantes/acciones";
import {
  cargarComprobanteContado,
  cargarDebitos,
  cargarRecibo,
  medioEditable,
  type MedioLeido,
} from "../datos";
import { EditorRecibo, type ContadoAPagar } from "../EditorRecibo";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

/** Detalle de un medio: banco y referencia, datos del cheque o de la retención. */
function DetalleMedio({ medio }: { medio: MedioLeido }) {
  if (medio.cheque) {
    const ch = medio.cheque;
    return (
      <span>
        <Link href={`/cheques/${ch.id}`} className="text-marca-700 hover:underline">
          {ch.banco} N° {ch.numero}
        </Link>{" "}
        · pago {fecha(ch.fecha_pago)}
        {ch.librador && ` · ${ch.librador}`}
        {ch.librador_cuit && ` (CUIT ${ch.librador_cuit})`}{" "}
        <Pastilla tono={TONO_ESTADO_CHEQUE[ch.estado]}>{NOMBRES_ESTADO_CHEQUE[ch.estado]}</Pastilla>
      </span>
    );
  }
  if (medio.tipo === "transferencia") {
    return <span>{[medio.banco, medio.referencia].filter(Boolean).join(" · ") || "—"}</span>;
  }
  if (medio.tipo === "retencion") {
    const tipo = medio.retencion_tipo ? NOMBRES_RETENCION[medio.retencion_tipo as TipoRetencion] : "—";
    return (
      <span>
        {tipo}
        {medio.retencion_jurisdiccion && ` (${medio.retencion_jurisdiccion})`} · certificado {medio.certificado} ·{" "}
        {fecha(medio.fecha_retencion)}
      </span>
    );
  }
  return <span>—</span>;
}

export default async function ReciboPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const aviso = avisoDeParametro((await searchParams).aviso);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const leido = await cargarRecibo(supabase, id);
  if (typeof leido === "string") return <p className="text-sm text-red-700">{leido}</p>;
  if (!leido) notFound();
  const { recibo, medios, imputaciones } = leido;

  const { data: clienteData } = await supabase
    .from("cliente")
    .select("id, razon_social, cuit, condicion_iva, codigo_legado")
    .eq("id", recibo.cliente_id)
    .maybeSingle();
  const cliente = clienteData as ClienteEncontrado | null;
  if (!cliente) return <p className="text-sm text-red-700">No se encontró el cliente del recibo.</p>;

  const titulo = recibo.numero_texto ? `Recibo ${recibo.numero_texto}` : "Recibo en borrador";
  const migas = <Migas items={[{ href: "/cobranzas", texto: "Cobranzas" }, { texto: titulo }]} />;
  const estado = <Pastilla tono={TONO_ESTADO_RECIBO[recibo.estado]}>{NOMBRES_ESTADO_RECIBO[recibo.estado]}</Pastilla>;

  // ----- Borrador: se edita ----------------------------------------------------

  if (recibo.estado === "borrador") {
    let contado: ContadoAPagar | null = null;
    if (recibo.comprobante_contado_id) {
      const c = await cargarComprobanteContado(supabase, recibo.comprobante_contado_id);
      if (typeof c === "string") return <p className="text-sm text-red-700">{c}</p>;
      contado = { id: c.id, texto: `${nombreComprobante(c.clase, null)} ${c.numeroTexto}`, total: c.total, cliente };
    }
    const cuenta = contado ? null : await cargarDebitos(supabase, recibo.cliente_id);
    if (typeof cuenta === "string") return <p className="text-sm text-red-700">{cuenta}</p>;

    return (
      <>
        {migas}
        <Encabezado
          titulo={contado ? "Pago de contado en borrador" : titulo}
          descripcion="Borrador: se edita hasta emitirlo."
          acciones={estado}
        />
        <EditorRecibo
          recibo={{
            id: recibo.id,
            cliente,
            fecha: recibo.fecha,
            observaciones: recibo.observaciones,
            medios: medios.map(medioEditable),
            imputaciones: imputaciones.map((i) => ({ comprobanteId: i.comprobante_id, importe: i.importe })),
          }}
          contado={contado}
          cuentaInicial={cuenta}
          hoy={hoyArgentina()}
          aviso={aviso}
        />
      </>
    );
  }

  // ----- Emitido o anulado: sólo lectura ---------------------------------------

  const imputado = sumarPesos(imputaciones.map((i) => i.importe));
  const aFavor = sumarPesos([Number(recibo.total), -imputado]);

  return (
    <>
      {migas}
      <Encabezado
        titulo={titulo}
        descripcion={
          recibo.estado === "anulado"
            ? "Anulado: sus imputaciones se deshicieron y sus cheques salieron de la cartera."
            : "Emitido: no se modifica. Si se cargó mal, se anula."
        }
        acciones={estado}
      />

      {aviso && (
        <div role="status" className="mb-4 rounded-lg border border-marca-200 bg-marca-50 px-3 py-2 text-sm text-marca-800">
          {aviso}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* T8: PDF del recibo y anulación. */}
        <button type="button" disabled title="Próximamente" className="boton-secundario opacity-50">
          PDF
        </button>
        {recibo.estado === "emitido" && (
          <button type="button" disabled title="Próximamente" className="boton-secundario opacity-50">
            Anular
          </button>
        )}
      </div>

      {recibo.estado === "anulado" && recibo.motivo_anulacion && (
        <div role="status" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Motivo de la anulación: {recibo.motivo_anulacion}
        </div>
      )}

      <Tarjeta titulo="Recibo">
        <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Dato etiqueta="Número">{recibo.numero_texto ?? "—"}</Dato>
          <Dato etiqueta="Fecha">{fecha(recibo.fecha)}</Dato>
          <Dato etiqueta="Cliente">
            <Link href={`/clientes/${cliente.id}`} className="text-marca-700 hover:underline">
              {cliente.razon_social}
            </Link>
          </Dato>
          <Dato etiqueta="Total">
            <span className="font-semibold tabular-nums">{pesos(Number(recibo.total))}</span>
          </Dato>
          <Dato etiqueta="Emitido el">{fechaHora(recibo.emitido_en)}</Dato>
          {recibo.anulado_en && <Dato etiqueta="Anulado el">{fechaHora(recibo.anulado_en)}</Dato>}
          {recibo.comprobante_contado_id && (
            <Dato etiqueta="Pago de contado">
              <Link href={`/comprobantes/${recibo.comprobante_contado_id}`} className="text-marca-700 hover:underline">
                Ver comprobante
              </Link>
            </Dato>
          )}
          {recibo.observaciones && (
            <div className="col-span-2 sm:col-span-4">
              <Dato etiqueta="Observaciones">{recibo.observaciones}</Dato>
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
                  <td>{NOMBRES_MEDIO_PAGO[m.tipo]}</td>
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
                  mensaje={recibo.estado === "anulado" ? "Las imputaciones se deshicieron al anularlo." : "No imputó comprobantes."}
                  colSpan={4}
                />
              )}
              {imputaciones.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/comprobantes/${i.comprobante_id}`} className="text-marca-700 hover:underline">
                      {i.comprobante
                        ? `${nombreComprobante(i.comprobante.clase, i.comprobante.letra as LetraComprobante | null)} ${numeroVisible({
                            letra: i.comprobante.letra as LetraComprobante | null,
                            punto_venta: Number(i.comprobante.punto_venta),
                            numero: i.comprobante.numero,
                          })}`
                        : "Comprobante"}
                    </Link>
                  </td>
                  <td>{fecha(i.comprobante?.fecha)}</td>
                  <td>{i.automatica ? "Saldo a favor (automática)" : "Cobranza"}</td>
                  <td className="text-right tabular-nums">{pesos(i.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recibo.estado === "emitido" && (
          <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-500">Imputado</dt>
              <dd className="tabular-nums">{pesos(imputado)}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
              <dt>Queda a favor</dt>
              <dd className="tabular-nums">{pesos(aFavor)}</dd>
            </div>
          </dl>
        )}
      </Tarjeta>
    </>
  );
}

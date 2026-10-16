import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta } from "@/components/ui";
import { fecha, fechaHora, numero, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { ivaDelComprobante, puedeImprimir } from "@/lib/comprobantes/pdf-datos";
import { nombreTipoArca, notasPermitidas, textoAsociado } from "@/lib/comprobantes/asociados";
import {
  datosAsociado,
  leerAsociados,
  leerNotasSobre,
  saldoDe,
  type AsociadoLeido,
  type ComprobanteRelacionado,
} from "@/lib/comprobantes/asociados-carga";
import { NOMBRES_ESTADO, TONO_ESTADO, nombreComprobante, numeroVisible } from "@/lib/comprobantes/listado";
import {
  NOMBRES_AMBIENTE_ARCA,
  NOMBRES_CONDICION_PAGO,
  type Comprobante,
  type ComprobanteItem,
  type MensajeArca,
  type TipoComprobanteArca,
} from "@/lib/tipos";
import type { ClienteEncontrado } from "../acciones";
import { cargarContextoEditor, cargarPrecios } from "../datos";
import { EditorComprobante } from "../EditorComprobante";
import { AccionesDetalle } from "./AccionesDetalle";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columnas explícitas del comprobante y sus ítems.
const COLUMNAS_COMPROBANTE =
  "id, punto_venta, ambiente, estado, clase, letra, tipo_arca, numero, fecha, fecha_vencimiento_pago, cliente_id, " +
  "lista_precio_id, condicion_pago, observaciones, receptor_razon_social, receptor_doc_tipo, receptor_doc_nro, " +
  "receptor_condicion_iva, receptor_domicilio, receptor_provincia, neto, iva, total, iva_detalle, cae, cae_vencimiento, " +
  "arca_resultado, arca_observaciones, arca_errores, intento_numero, autorizado_en";
const COLUMNAS_ITEM =
  "id, orden, producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, " +
  "alicuota_iva, importe, iva";

type ComprobanteLeido = Omit<Comprobante, "creado_por" | "creado_en" | "actualizado_en" | "moneda">;
type ItemLeido = Omit<ComprobanteItem, "comprobante_id">;

const DOCUMENTO: Record<number, string> = { 80: "CUIT", 96: "DNI", 99: "Sin identificar" };

function Mensajes({ titulo, mensajes, tono }: { titulo: string; mensajes: MensajeArca[]; tono: "rojo" | "ambar" }) {
  const clases = tono === "rojo" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div role={tono === "rojo" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${clases}`}>
      <p className="font-medium">{titulo}</p>
      <ul className="mt-1 list-disc pl-5">
        {mensajes.map((m, i) => (
          <li key={i}>
            {m.code ? <span className="tabular-nums">[{m.code}] </span> : null}
            {m.msg}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Factura A A-00007-00000361 del 10/10/2026", con enlace si está en la base. */
function Asociado({ asociado }: { asociado: AsociadoLeido }) {
  const datos = datosAsociado(asociado);
  const tipo = datos.tipo_arca ? nombreTipoArca(datos.tipo_arca as TipoComprobanteArca) : "Comprobante";
  const texto = `${tipo} ${textoAsociado(datos)}`;
  return asociado.interno ? (
    <Link href={`/comprobantes/${asociado.interno.id}`} className="text-marca-700 hover:underline">
      {texto}
    </Link>
  ) : (
    <span>
      {texto} <span className="text-xs text-stone-500">(sistema anterior)</span>
    </span>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const [{ data, error }, { data: itemsData, error: errorItems }] = await Promise.all([
    supabase.from("comprobante").select(COLUMNAS_COMPROBANTE).eq("id", id).maybeSingle(),
    supabase.from("comprobante_item").select(COLUMNAS_ITEM).eq("comprobante_id", id).order("orden"),
  ]);
  if (error || errorItems) {
    return <p className="text-sm text-red-700">Error al cargar el comprobante: {(error ?? errorItems)?.message}</p>;
  }
  if (!data) notFound();
  const c = data as unknown as ComprobanteLeido;
  const items = (itemsData ?? []) as unknown as ItemLeido[];

  // Asociados de una nota (los de la base, con su comprobante).
  const asociados = c.clase === "factura" ? [] : await leerAsociados(supabase, c.id);
  if (typeof asociados === "string") return <p className="text-sm text-red-700">{asociados}</p>;
  const asociadosBase = asociados.map((a) => a.asociado_id).filter((v): v is string => Boolean(v));

  const { data: clienteData } = await supabase
    .from("cliente")
    .select("id, razon_social, cuit, condicion_iva, codigo_legado")
    .eq("id", c.cliente_id)
    .maybeSingle();
  const cliente = clienteData as ClienteEncontrado | null;

  const titulo = `${nombreComprobante(c.clase, c.letra)} ${c.numero !== null ? numeroVisible(c) : ""}`.trim();
  const migas = <Migas items={[{ href: "/comprobantes", texto: "Comprobantes" }, { texto: titulo }]} />;
  const homologacion = c.ambiente === "homologacion" && (
    <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      Homologación: este comprobante no tiene validez fiscal.
    </div>
  );

  // ----- Borrador o rechazado: se edita ---------------------------------------

  if (c.estado === "borrador" || c.estado === "rechazado") {
    const contexto = await cargarContextoEditor(supabase);
    if (typeof contexto === "string") {
      return <p className="text-sm text-red-700">Error al cargar los datos del comprobante: {contexto}</p>;
    }
    if (!cliente) return <p className="text-sm text-red-700">No se encontró el cliente del comprobante.</p>;
    const precios = await cargarPrecios(supabase, c.lista_precio_id);
    const errores = c.arca_errores ?? [];
    const interno = asociados.find((a) => a.interno)?.interno ?? null;
    const manual = asociados.find((a) => !a.asociado_id) ?? null;
    let saldo: number | null = null;
    if (c.clase === "nota_credito" && interno) {
      const notas = await leerNotasSobre(supabase, asociadosBase, c.id);
      if (typeof notas === "string") return <p className="text-sm text-red-700">{notas}</p>;
      saldo = saldoDe(asociados, notas)?.saldo ?? null;
    }
    const observaciones = c.arca_observaciones ?? [];

    return (
      <>
        {migas}
        <Encabezado
          titulo={titulo}
          descripcion={c.estado === "rechazado" ? "ARCA lo rechazó: corregilo y volvé a autorizarlo." : "Borrador."}
          acciones={<Pastilla tono={TONO_ESTADO[c.estado]}>{NOMBRES_ESTADO[c.estado]}</Pastilla>}
        />
        {homologacion}
        {c.estado === "rechazado" && (
          <div className="mb-4 space-y-2">
            {errores.length > 0 && <Mensajes titulo="Errores de ARCA" mensajes={errores} tono="rojo" />}
            {observaciones.length > 0 && <Mensajes titulo="Observaciones de ARCA" mensajes={observaciones} tono="ambar" />}
          </div>
        )}
        <EditorComprobante
          comprobante={{
            id: c.id,
            clase: c.clase,
            fecha: c.fecha,
            fecha_vencimiento_pago: c.fecha_vencimiento_pago,
            condicion_pago: c.condicion_pago,
            lista_precio_id: c.lista_precio_id,
            punto_venta: Number(c.punto_venta),
            observaciones: c.observaciones,
            ambiente: c.ambiente,
            cliente,
            asociado: {
              interno:
                interno && interno.tipo_arca && interno.letra
                  ? {
                      id: interno.id,
                      texto: `${nombreTipoArca(interno.tipo_arca)} ${textoAsociado(interno)}`,
                      letra: interno.letra,
                      tipoArca: interno.tipo_arca,
                      saldo,
                    }
                  : null,
              manual:
                manual && !interno
                  ? {
                      tipo_arca: manual.tipo_arca,
                      punto_venta: manual.punto_venta,
                      numero: manual.numero,
                      fecha: manual.fecha,
                    }
                  : null,
            },
            items: items.map((i) => ({
              producto_id: i.producto_id,
              codigo: i.codigo,
              descripcion: i.descripcion,
              observaciones: i.observaciones,
              cantidad: Number(i.cantidad),
              precio_unitario: Number(i.precio_unitario),
              descuento_pct: Number(i.descuento_pct),
              alicuota_iva: Number(i.alicuota_iva),
            })),
          }}
          contexto={contexto}
          precios={precios}
          hoy={hoyArgentina()}
        />
      </>
    );
  }

  // ----- Autorizado o en verificación: sólo lectura ---------------------------

  // El IVA por alícuota autorizado (lo enviado a ARCA); recalculado sólo en los anteriores a guardarlo.
  const ivaPorAlicuota = ivaDelComprobante(c, items).alicuotas;
  const [{ data: puntoVenta }, { data: emisor }] = await Promise.all([
    supabase.from("punto_venta").select("electronico").eq("numero", c.punto_venta).maybeSingle(),
    supabase.from("arca_emisor").select("cuit").eq("id", true).maybeSingle(),
  ]);
  const imprimible = puedeImprimir({
    ...c,
    puntoVentaElectronico: puntoVenta?.electronico === true,
    cuitEmisor: emisor?.cuit as string | null | undefined,
  });
  const observaciones = c.arca_observaciones ?? [];
  const verificando = c.estado === "verificando";

  // Notas que asocian este comprobante y, en una factura, lo que queda para acreditar.
  const notas: ComprobanteRelacionado[] | string = c.clase === "nota_credito" ? [] : await leerNotasSobre(supabase, [c.id]);
  if (typeof notas === "string") return <p className="text-sm text-red-700">{notas}</p>;
  const esteComoAsociado: AsociadoLeido = {
    asociado_id: c.id,
    tipo_arca: null,
    punto_venta: null,
    numero: null,
    fecha: null,
    cuit: null,
    interno: { ...c, punto_venta: Number(c.punto_venta), total: Number(c.total) },
  };
  const saldo = c.estado === "autorizado" && c.clase !== "nota_credito" ? saldoDe([esteComoAsociado], notas) : null;

  return (
    <>
      {migas}
      <Encabezado
        titulo={titulo}
        descripcion={
          verificando
            ? "Enviado a ARCA sin confirmar el resultado."
            : "Autorizado en ARCA: es un documento fiscal y no se modifica. Para corregirlo, emití una nota de crédito."
        }
        acciones={<Pastilla tono={TONO_ESTADO[c.estado]}>{NOMBRES_ESTADO[c.estado]}</Pastilla>}
      />
      {homologacion}

      {verificando && (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Se pidió el CAE a ARCA con el número {c.intento_numero ?? "—"} pero la respuesta no llegó o no fue clara. Puede
          que ARCA lo haya autorizado. «Verificar con ARCA» lo consulta: si ARCA lo tiene, se guarda su CAE; si no, se
          vuelve a pedir. No lo cargues de nuevo: podrías emitirlo dos veces.
        </div>
      )}

      <div className="mb-4">
        <AccionesDetalle
          id={c.id}
          verificando={verificando}
          pdf={imprimible.ok ? { ok: true } : { ok: false, motivo: imprimible.motivo }}
          notas={notasPermitidas(c)}
        />
      </div>

      {observaciones.length > 0 && (
        <div className="mb-4">
          <Mensajes titulo="Observaciones de ARCA" mensajes={observaciones} tono="ambar" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Comprobante">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <Dato etiqueta="Número">{numeroVisible(c)}</Dato>
            <Dato etiqueta="Fecha">{fecha(c.fecha)}</Dato>
            <Dato etiqueta="Vencimiento del cobro">{fecha(c.fecha_vencimiento_pago)}</Dato>
            <Dato etiqueta="Condición de pago">{NOMBRES_CONDICION_PAGO[c.condicion_pago]}</Dato>
            <Dato etiqueta="Ambiente">{c.ambiente ? NOMBRES_AMBIENTE_ARCA[c.ambiente] : "—"}</Dato>
            <Dato etiqueta="CAE">{c.cae ?? "—"}</Dato>
            <Dato etiqueta="Vencimiento del CAE">{fecha(c.cae_vencimiento)}</Dato>
            <Dato etiqueta="Autorizado el">{fechaHora(c.autorizado_en)}</Dato>
            {asociados.length > 0 && (
              <div className="col-span-2">
                <Dato etiqueta="Comprobante asociado">
                  <span className="flex flex-col">
                    {asociados.map((a, i) => (
                      <Asociado key={i} asociado={a} />
                    ))}
                  </span>
                </Dato>
              </div>
            )}
            {c.observaciones && (
              <div className="col-span-2">
                <Dato etiqueta="Observaciones">{c.observaciones}</Dato>
              </div>
            )}
          </dl>
        </Tarjeta>
        <Tarjeta titulo="Receptor">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <div className="col-span-2">
              <Dato etiqueta="Razón social">{c.receptor_razon_social ?? cliente?.razon_social ?? "—"}</Dato>
            </div>
            <Dato etiqueta={c.receptor_doc_tipo ? (DOCUMENTO[c.receptor_doc_tipo] ?? "Documento") : "Documento"}>
              {c.receptor_doc_nro ?? "—"}
            </Dato>
            <Dato etiqueta="Condición IVA">{c.receptor_condicion_iva ?? "—"}</Dato>
            <Dato etiqueta="Domicilio">{c.receptor_domicilio ?? "—"}</Dato>
            <Dato etiqueta="Provincia">{c.receptor_provincia ?? "—"}</Dato>
          </dl>
        </Tarjeta>
      </div>

      {(notas.length > 0 || saldo) && (
        <Tarjeta
          titulo="Notas de crédito y débito"
          descripcion={saldo ? `Saldo para notas de crédito: ${pesos(saldo.saldo)}` : undefined}
          className="mt-4"
        >
          {notas.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">Todavía no tiene notas asociadas.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {notas.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={`/comprobantes/${n.id}`} className="text-marca-700 hover:underline">
                    {nombreComprobante(n.clase, n.letra)} {n.numero !== null ? numeroVisible(n) : ""}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{pesos(n.total)}</span>
                    <Pastilla tono={TONO_ESTADO[n.estado]}>{NOMBRES_ESTADO[n.estado]}</Pastilla>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      )}

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
                  <td className="text-right tabular-nums">{numero(Number(i.alicuota_iva), 1)}%</td>
                  <td className="text-right tabular-nums">{pesos(Number(i.importe) + Number(i.iva))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Neto gravado</dt>
            <dd className="tabular-nums">{pesos(Number(c.neto))}</dd>
          </div>
          {ivaPorAlicuota.map((a) => (
            <div key={a.id} className="flex justify-between">
              <dt className="text-stone-500">IVA {numero(a.alicuota, 1)}%</dt>
              <dd className="tabular-nums">{pesos(a.importe)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{pesos(Number(c.total))}</dd>
          </div>
        </dl>
      </Tarjeta>
    </>
  );
}

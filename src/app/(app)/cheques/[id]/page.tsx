import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, fechaHora, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { nombreComprobante, numeroVisible } from "@/lib/comprobantes/listado";
import { accionesDisponibles, estadoChequeVisible, TONO_ESTADO_CHEQUE } from "@/lib/cobranzas/cartera";
import { armarNotaDebitoRechazo, type ComprobanteImputado } from "@/lib/cobranzas/cheques";
import {
  NOMBRES_ESTADO_CHEQUE,
  type Cheque,
  type ChequeEstado,
  type ClaseComprobante,
  type CondicionIva,
  type EstadoComprobante,
  type LetraComprobante,
  type Recibo,
} from "@/lib/tipos";
import { AccionesCheque } from "./AccionesCheque";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChequeLeido = Cheque & {
  recibo: Pick<Recibo, "id" | "numero_texto" | "fecha" | "estado"> | null;
  cliente: { id: string; razon_social: string; condicion_iva: CondicionIva | null } | null;
  nd: { id: string; estado: EstadoComprobante; letra: LetraComprobante | null; punto_venta: number; numero: number | null } | null;
};

type Imputado = {
  comprobante: { id: string; clase: ClaseComprobante; letra: LetraComprobante | null; punto_venta: number; numero: number | null } | null;
};

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

/**
 * Qué nota de débito crearía el rechazo (el mismo armado que rechazar_cheque),
 * para mostrarlo antes de confirmar.
 */
async function previaDelRechazo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cheque: ChequeLeido,
  hoy: string,
): Promise<{ texto: string } | { error: string }> {
  const [{ data: imputadas, error }, { data: puntos, error: errorPuntos }] = await Promise.all([
    supabase
      .from("imputacion")
      .select("comprobante:comprobante_id(id, clase, letra, punto_venta, numero)")
      .eq("recibo_id", cheque.recibo_id),
    supabase.from("punto_venta").select("numero, electronico").eq("activo", true).order("numero"),
  ]);
  if (error ?? errorPuntos) return { error: `No se pudo preparar la nota de débito: ${(error ?? errorPuntos)?.message}` };

  const comprobantes = ((imputadas ?? []) as unknown as Imputado[]).flatMap((i) => (i.comprobante ? [i.comprobante] : []));
  const nota = armarNotaDebitoRechazo(
    { numero: cheque.numero, banco: cheque.banco, importe: Number(cheque.importe), clienteId: cheque.cliente_id },
    {
      hoy,
      // Electrónico para A o B, no electrónico para X: lo elige el armado.
      puntosActivos: (puntos ?? []).map((p) => ({ numero: Number(p.numero), electronico: Boolean(p.electronico) })),
      condicionIva: cheque.cliente?.condicion_iva ?? null,
      listaPrecioId: null,
      reciboFecha: cheque.recibo?.fecha ?? hoy,
      imputados: comprobantes.map((c): ComprobanteImputado => ({ id: c.id, clase: c.clase, letra: c.letra })),
    },
  );
  if ("error" in nota) return { error: nota.error };

  const tipo = `nota de débito ${nota.cabecera.letra}`;
  if (nota.cabecera.periodo_asoc_desde && nota.cabecera.periodo_asoc_hasta) {
    return {
      texto:
        `Se crea una ${tipo} en borrador por ${pesos(Number(cheque.importe))} (no gravado) más los gastos, asociada al ` +
        `período ${fecha(nota.cabecera.periodo_asoc_desde)} – ${fecha(nota.cabecera.periodo_asoc_hasta)} (el recibo fue a cuenta).`,
    };
  }
  const facturas = comprobantes
    .filter((c) => nota.asociados.some((a) => "asociado_id" in a && a.asociado_id === c.id))
    .map((c) => numeroVisible({ letra: c.letra, punto_venta: Number(c.punto_venta), numero: c.numero }));
  return {
    texto:
      `Se crea una ${tipo} en borrador por ${pesos(Number(cheque.importe))} (no gravado) más los gastos, asociada a ` +
      `${[...new Set(facturas)].join(", ")} (lo que canceló el recibo).`,
  };
}

export default async function ChequePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const [{ data, error }, { data: historialData, error: errorHistorial }] = await Promise.all([
    supabase
      .from("cheque")
      .select(
        "*, recibo:recibo_id(id, numero_texto, fecha, estado), cliente:cliente_id(id, razon_social, condicion_iva), " +
          "nd:nd_comprobante_id(id, estado, letra, punto_venta, numero)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("cheque_estado").select("*").eq("cheque_id", id).order("id"),
  ]);
  if (error || errorHistorial) {
    return <p className="text-sm text-red-700">Error al cargar el cheque: {(error ?? errorHistorial)?.message}</p>;
  }
  if (!data) notFound();
  const cheque = data as unknown as ChequeLeido;
  const historial = (historialData ?? []) as ChequeEstado[];

  const enCartera = cheque.recibo?.estado === "emitido";
  const acciones = enCartera ? accionesDisponibles(cheque.estado) : [];
  const hoy = hoyArgentina();
  const previa = acciones.includes("rechazar") ? await previaDelRechazo(supabase, cheque, hoy) : null;

  const ndNumero = cheque.nd && cheque.nd.numero !== null ? numeroVisible({ ...cheque.nd, punto_venta: Number(cheque.nd.punto_venta) }) : null;
  const visible = estadoChequeVisible({
    estado: cheque.estado,
    nd_estado: cheque.nd?.estado ?? null,
    nd_numero_texto: cheque.nd?.estado === "autorizado" ? ndNumero : null,
  });
  const titulo = `${cheque.tipo === "echeq" ? "E-cheq" : "Cheque"} ${cheque.banco} N° ${cheque.numero}`;

  return (
    <>
      <Migas items={[{ href: "/cheques", texto: "Cartera de cheques" }, { texto: titulo }]} />
      <Encabezado
        titulo={titulo}
        descripcion={
          enCartera
            ? "Cada cambio de estado queda en el historial."
            : cheque.recibo?.estado === "borrador"
              ? "Su recibo está en borrador: entra a la cartera cuando se emite."
              : "Su recibo se anuló: el cheque salió de la cartera."
        }
        acciones={<Pastilla tono={visible.tono}>{visible.texto}</Pastilla>}
      />

      {cheque.estado === "rechazado" && cheque.nd && (
        <div
          role="status"
          className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
            cheque.nd.estado === "autorizado"
              ? "border-marca-200 bg-marca-50 text-marca-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span>
            {cheque.nd.estado === "autorizado"
              ? `La nota de débito ${nombreComprobante("nota_debito", cheque.nd.letra)} ${ndNumero} está autorizada: el cliente vuelve a deber el cheque.`
              : "La nota de débito por el rechazo está pendiente: revisala y autorizala."}
          </span>
          <Link
            href={`/comprobantes/${cheque.nd.id}`}
            className={cheque.nd.estado === "autorizado" ? "font-medium underline" : "boton-primario"}
          >
            {cheque.nd.estado === "autorizado" ? "Ver nota de débito" : "Abrir la nota de débito"}
          </Link>
        </div>
      )}

      <div className="mb-4">
        <AccionesCheque id={cheque.id} acciones={acciones} hoy={hoy} previaRechazo={previa} />
      </div>

      <Tarjeta titulo="Cheque">
        <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Dato etiqueta="Tipo">{cheque.tipo === "echeq" ? "E-cheq" : "Físico"}</Dato>
          <Dato etiqueta="Banco">{cheque.banco}</Dato>
          <Dato etiqueta="Número">{cheque.numero}</Dato>
          <Dato etiqueta="Importe">
            <span className="font-semibold tabular-nums">{pesos(Number(cheque.importe))}</span>
          </Dato>
          <Dato etiqueta="Fecha de emisión">{fecha(cheque.fecha_emision)}</Dato>
          <Dato etiqueta="Fecha de pago">{fecha(cheque.fecha_pago)}</Dato>
          <Dato etiqueta="Librador">{cheque.librador ?? "—"}</Dato>
          <Dato etiqueta="CUIT del librador">{cheque.librador_cuit ?? "—"}</Dato>
          <Dato etiqueta="Cliente">
            {cheque.cliente ? (
              <Link href={`/clientes/${cheque.cliente.id}`} className="text-marca-700 hover:underline">
                {cheque.cliente.razon_social}
              </Link>
            ) : (
              "—"
            )}
          </Dato>
          <Dato etiqueta="Recibo">
            {cheque.recibo ? (
              <Link href={`/cobranzas/${cheque.recibo.id}`} className="text-marca-700 hover:underline">
                {cheque.recibo.numero_texto ?? "Borrador"}
              </Link>
            ) : (
              "—"
            )}
          </Dato>
          {cheque.entregado_a && <Dato etiqueta="Entregado a">{cheque.entregado_a}</Dato>}
          {cheque.nd && (
            <Dato etiqueta="Nota de débito">
              <Link href={`/comprobantes/${cheque.nd.id}`} className="text-marca-700 hover:underline">
                {visible.nd ?? "Nota de débito"}
              </Link>
            </Dato>
          )}
        </dl>
      </Tarjeta>

      <Tarjeta titulo="Historial de estados" className="mt-4">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Observación</th>
                <th>Registrado</th>
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 && <Vacio mensaje="Sin movimientos." colSpan={4} />}
              {historial.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{fecha(h.fecha)}</td>
                  <td>
                    <Pastilla tono={TONO_ESTADO_CHEQUE[h.estado]}>{NOMBRES_ESTADO_CHEQUE[h.estado]}</Pastilla>
                  </td>
                  <td>{h.observacion ?? "—"}</td>
                  <td className="whitespace-nowrap text-stone-500">{fechaHora(h.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}

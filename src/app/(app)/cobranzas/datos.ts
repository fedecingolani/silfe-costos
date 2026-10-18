import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { DebitoPendiente } from "@/lib/cobranzas/imputacion";
import type { MedioBorrador } from "@/lib/cobranzas/recibo";
import type {
  ClaseComprobante,
  CondicionPago,
  Recibo,
  ReciboMedio,
  Cheque,
  TipoRetencion,
} from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Débito pendiente con lo que muestra la tabla de imputación. */
export type DebitoListado = DebitoPendiente & { numeroTexto: string; clase: ClaseComprobante; total: number };

export type CuentaCliente = { debitos: DebitoListado[]; saldoAFavor: number };

/**
 * Débitos de cuenta corriente con saldo del cliente (producción o no
 * electrónicos: lo que ya filtra v_comprobante_saldo), del más viejo al más
 * nuevo, y su saldo a favor. Los de contado no se cobran acá: se pagan
 * desde la factura.
 */
export async function cargarDebitos(supabase: Supabase, clienteId: string): Promise<CuentaCliente | string> {
  const [debitos, aFavor] = await Promise.all([
    supabase
      .from("v_comprobante_saldo")
      .select("comprobante_id, fecha, numero_texto, clase, total, saldo")
      .eq("cliente_id", clienteId)
      .eq("condicion_pago", "cuenta_corriente")
      .gt("saldo", 0)
      .order("fecha")
      .order("numero_texto"),
    supabase.from("v_cliente_saldo_a_favor").select("disponible").eq("cliente_id", clienteId),
  ]);
  const error = debitos.error ?? aFavor.error;
  if (error) return `No se pudieron leer los comprobantes pendientes: ${error.message}`;
  return {
    debitos: (debitos.data ?? []).map((d) => ({
      comprobanteId: d.comprobante_id as string,
      fecha: d.fecha as string,
      numeroTexto: d.numero_texto as string,
      clase: d.clase as ClaseComprobante,
      total: Number(d.total),
      saldo: Number(d.saldo),
    })),
    saldoAFavor: (aFavor.data ?? []).reduce((total, f) => total + Math.round(Number(f.disponible) * 100), 0) / 100,
  };
}

export type ComprobanteContadoLeido = {
  id: string;
  clienteId: string;
  clase: ClaseComprobante;
  numeroTexto: string;
  fecha: string;
  total: number;
  saldo: number;
  condicionPago: CondicionPago;
};

/** Factura o ND de contado que se puede pagar (débito de cuenta corriente: autorizado, producción o no electrónico). */
export async function cargarComprobanteContado(
  supabase: Supabase,
  id: string,
): Promise<ComprobanteContadoLeido | string> {
  const { data, error } = await supabase
    .from("v_comprobante_saldo")
    .select("comprobante_id, cliente_id, clase, numero_texto, fecha, total, saldo, condicion_pago")
    .eq("comprobante_id", id)
    .maybeSingle();
  if (error) return `No se pudo leer el comprobante: ${error.message}`;
  if (!data) return "El comprobante no se puede pagar: tiene que ser una factura o nota de débito autorizada de producción.";
  if (data.condicion_pago !== "contado") return "El comprobante es de cuenta corriente: se cobra con una cobranza.";
  return {
    id: data.comprobante_id,
    clienteId: data.cliente_id,
    clase: data.clase,
    numeroTexto: data.numero_texto,
    fecha: data.fecha,
    total: Number(data.total),
    saldo: Number(data.saldo),
    condicionPago: data.condicion_pago,
  };
}

/** Recibo emitido que pagó un comprobante de contado, si lo hay. */
export async function reciboDeContado(
  supabase: Supabase,
  comprobanteId: string,
): Promise<{ id: string; numero_texto: string | null; estado: Recibo["estado"] }[] | string> {
  const { data, error } = await supabase
    .from("recibo")
    .select("id, numero_texto, estado")
    .eq("comprobante_contado_id", comprobanteId)
    .in("estado", ["borrador", "emitido"])
    .order("creado_en");
  if (error) return `No se pudo leer el pago del comprobante: ${error.message}`;
  return (data ?? []) as { id: string; numero_texto: string | null; estado: Recibo["estado"] }[];
}

export const COLUMNAS_RECIBO =
  "id, punto_venta, numero, numero_texto, fecha, cliente_id, total, estado, motivo_anulacion, " +
  "comprobante_contado_id, observaciones, creado_en, emitido_en, anulado_en";

export type ReciboLeido = Omit<Recibo, "creado_por" | "actualizado_en">;

export type MedioLeido = Omit<ReciboMedio, "recibo_id"> & {
  cheque: Pick<
    Cheque,
    "id" | "tipo" | "banco" | "numero" | "fecha_emision" | "fecha_pago" | "librador" | "librador_cuit" | "estado"
  > | null;
};

export type ImputacionLeida = {
  id: string;
  comprobante_id: string;
  importe: number;
  automatica: boolean;
  comprobante: { clase: ClaseComprobante; letra: string | null; punto_venta: number; numero: number | null; fecha: string } | null;
};

/** Recibo con sus medios (y cheques) e imputaciones. */
export async function cargarRecibo(
  supabase: Supabase,
  id: string,
): Promise<{ recibo: ReciboLeido; medios: MedioLeido[]; imputaciones: ImputacionLeida[] } | null | string> {
  const [recibo, medios, imputaciones] = await Promise.all([
    supabase.from("recibo").select(COLUMNAS_RECIBO).eq("id", id).maybeSingle(),
    supabase
      .from("recibo_medio")
      .select(
        "id, orden, tipo, importe, banco, referencia, cheque_id, retencion_tipo, retencion_jurisdiccion, certificado, " +
          "fecha_retencion, cheque(id, tipo, banco, numero, fecha_emision, fecha_pago, librador, librador_cuit, estado)",
      )
      .eq("recibo_id", id)
      .order("orden"),
    supabase
      .from("imputacion")
      .select("id, comprobante_id, importe, automatica, comprobante:comprobante_id(clase, letra, punto_venta, numero, fecha)")
      .eq("recibo_id", id)
      .order("creado_en"),
  ]);
  const error = recibo.error ?? medios.error ?? imputaciones.error;
  if (error) return `No se pudo leer el recibo: ${error.message}`;
  if (!recibo.data) return null;
  return {
    recibo: recibo.data as unknown as ReciboLeido,
    medios: ((medios.data ?? []) as unknown as MedioLeido[]).map((m) => ({ ...m, importe: Number(m.importe) })),
    imputaciones: ((imputaciones.data ?? []) as unknown as ImputacionLeida[]).map((i) => ({
      ...i,
      importe: Number(i.importe),
    })),
  };
}

/** Medio guardado → el que edita la pantalla. */
export function medioEditable(m: MedioLeido): MedioBorrador {
  return {
    tipo: m.tipo,
    importe: Number(m.importe),
    banco: m.banco,
    referencia: m.referencia,
    cheque: m.cheque
      ? {
          banco: m.cheque.banco,
          numero: m.cheque.numero,
          fechaEmision: m.cheque.fecha_emision,
          fechaPago: m.cheque.fecha_pago,
          librador: m.cheque.librador,
          libradorCuit: m.cheque.librador_cuit,
        }
      : null,
    retencion:
      m.tipo === "retencion"
        ? {
            tipo: m.retencion_tipo as TipoRetencion | null,
            jurisdiccion: m.retencion_jurisdiccion,
            certificado: m.certificado ?? "",
            fecha: m.fecha_retencion ?? "",
          }
        : null,
  };
}

/** Imputación vigente recibida por un débito: de un recibo emitido o de una nota de crédito. */
export type ImputacionRecibida = {
  id: string;
  importe: number;
  fecha: string;
  automatica: boolean;
  texto: string;
  href: string;
};

type FilaImputacionRecibida = {
  id: string;
  importe: number | string;
  fecha: string;
  automatica: boolean;
  recibo: { id: string; numero_texto: string | null; estado: string } | null;
  nota: { id: string; letra: string | null; punto_venta: number; numero: number | null } | null;
};

/** Pagos (recibos emitidos) y notas de crédito imputados a un débito, por fecha. */
export async function imputacionesRecibidas(
  supabase: Supabase,
  comprobanteId: string,
): Promise<ImputacionRecibida[] | string> {
  const { data, error } = await supabase
    .from("imputacion")
    .select(
      "id, importe, fecha, automatica, recibo:recibo_id(id, numero_texto, estado), " +
        "nota:nota_credito_id(id, letra, punto_venta, numero)",
    )
    .eq("comprobante_id", comprobanteId)
    .order("fecha")
    .order("creado_en");
  if (error) return `No se pudieron leer los pagos del comprobante: ${error.message}`;
  return ((data ?? []) as unknown as FilaImputacionRecibida[])
    .filter((i) => i.nota || i.recibo?.estado === "emitido")
    .map((i) => ({
      id: i.id,
      importe: Number(i.importe),
      fecha: i.fecha,
      automatica: i.automatica,
      texto: i.recibo
        ? `Recibo ${i.recibo.numero_texto ?? ""}`.trim()
        : `Nota de crédito ${i.nota?.letra ?? ""}-${String(i.nota?.punto_venta ?? "").padStart(5, "0")}-${String(
            i.nota?.numero ?? "",
          ).padStart(8, "0")}`,
      href: i.recibo ? `/cobranzas/${i.recibo.id}` : `/comprobantes/${i.nota?.id}`,
    }));
}

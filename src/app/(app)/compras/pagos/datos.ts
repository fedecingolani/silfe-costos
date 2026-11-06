import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { DebitoPendiente } from "@/lib/compras/pagos/imputacion";
import type { ChequeCartera, MedioBorrador } from "@/lib/compras/pagos/medios";
import type {
  Cheque,
  ComprobanteCompraSaldo,
  LetraCompra,
  OrdenPago,
  OrdenPagoMedio,
  TipoComprobanteCompra,
} from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Proveedor que se ofrece en el editor. Los inactivos sólo si la orden ya lo tiene. */
export type ProveedorOfrecido = { id: string; nombre: string; cuit: string | null; activo: boolean };

export async function cargarProveedores(supabase: Supabase): Promise<ProveedorOfrecido[] | string> {
  const { data, error } = await supabase.from("proveedor").select("id, nombre, cuit, activo").order("nombre");
  if (error) return `No se pudieron leer los proveedores: ${error.message}`;
  return (data ?? []) as ProveedorOfrecido[];
}

/** Débito con saldo con lo que muestra la tabla de imputación. */
export type DebitoCompraListado = DebitoPendiente & {
  numeroTexto: string;
  tipo: ComprobanteCompraSaldo["tipo"];
  total: number;
  fechaVencimiento: string | null;
};

export type CuentaProveedor = { debitos: DebitoCompraListado[]; saldoAFavor: number };

/**
 * Facturas y notas de débito confirmadas con saldo del proveedor, de la más
 * vieja a la más nueva, y su saldo a favor (órdenes de pago y notas de
 * crédito con algo sin imputar).
 */
export async function cargarCuentaProveedor(supabase: Supabase, proveedorId: string): Promise<CuentaProveedor | string> {
  const [debitos, aFavor] = await Promise.all([
    supabase
      .from("v_comprobante_compra_saldo")
      .select("comprobante_compra_id, tipo, numero_texto, fecha, fecha_vencimiento, total, saldo")
      .eq("proveedor_id", proveedorId)
      .gt("saldo", 0)
      .order("fecha")
      .order("numero_texto"),
    supabase.from("v_proveedor_saldo_a_favor").select("disponible").eq("proveedor_id", proveedorId),
  ]);
  const error = debitos.error ?? aFavor.error;
  if (error) return `No se pudieron leer los comprobantes pendientes: ${error.message}`;
  return {
    debitos: (debitos.data ?? []).map((d) => ({
      comprobanteId: d.comprobante_compra_id as string,
      fecha: d.fecha as string,
      fechaVencimiento: (d.fecha_vencimiento as string | null) ?? null,
      numeroTexto: d.numero_texto as string,
      tipo: d.tipo as ComprobanteCompraSaldo["tipo"],
      total: Number(d.total),
      saldo: Number(d.saldo),
    })),
    saldoAFavor: (aFavor.data ?? []).reduce((total, f) => total + Math.round(Number(f.disponible) * 100), 0) / 100,
  };
}

const COLUMNAS_CHEQUE = "id, banco, numero, fecha_pago, importe, librador, estado, cliente(razon_social)";

type FilaCheque = Pick<Cheque, "id" | "banco" | "numero" | "fecha_pago" | "librador" | "estado"> & {
  importe: number | string;
  cliente: { razon_social: string } | null;
};

function chequeCartera(fila: FilaCheque): ChequeCartera {
  return {
    id: fila.id,
    banco: fila.banco,
    numero: fila.numero,
    fechaPago: fila.fecha_pago,
    importe: Number(fila.importe),
    librador: fila.librador,
    cliente: fila.cliente?.razon_social ?? null,
    estado: fila.estado,
  };
}

/**
 * Cheques de terceros en cartera, por fecha de pago, más los que ya eligió
 * el borrador (`incluir`) aunque hayan salido de la cartera: así la pantalla
 * los muestra y avisa que ya no se pueden entregar.
 */
export async function cargarCartera(supabase: Supabase, incluir: readonly string[] = []): Promise<ChequeCartera[] | string> {
  const [cartera, elegidos] = await Promise.all([
    supabase.from("cheque").select(COLUMNAS_CHEQUE).eq("estado", "en_cartera").order("fecha_pago").order("numero"),
    incluir.length > 0
      ? supabase.from("cheque").select(COLUMNAS_CHEQUE).in("id", [...incluir])
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = cartera.error ?? elegidos.error;
  if (error) return `No se pudo leer la cartera de cheques: ${error.message}`;
  const porId = new Map<string, ChequeCartera>();
  for (const fila of [...(cartera.data ?? []), ...(elegidos.data ?? [])] as unknown as FilaCheque[]) {
    porId.set(fila.id, chequeCartera(fila));
  }
  return [...porId.values()];
}

/** Cheques por id, con su estado actual (para validar en el servidor). */
export async function cargarCheques(supabase: Supabase, ids: readonly string[]): Promise<ChequeCartera[] | string> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("cheque").select(COLUMNAS_CHEQUE).in("id", [...ids]);
  if (error) return `No se pudieron leer los cheques: ${error.message}`;
  return ((data ?? []) as unknown as FilaCheque[]).map(chequeCartera);
}

export const COLUMNAS_ORDEN_PAGO =
  "id, numero, numero_texto, fecha, proveedor_id, total, estado, motivo_anulacion, observaciones, creado_en, " +
  "confirmado_en, anulado_en";

export type OrdenPagoLeida = Omit<OrdenPago, "creado_por" | "actualizado_en">;

export type MedioLeido = Omit<OrdenPagoMedio, "orden_pago_id"> & {
  cheque: Pick<Cheque, "id" | "banco" | "numero" | "fecha_pago" | "librador" | "estado"> | null;
};

export type ImputacionLeida = {
  id: string;
  comprobante_compra_id: string;
  importe: number;
  automatica: boolean;
  comprobante: {
    tipo: TipoComprobanteCompra;
    letra: LetraCompra;
    punto_venta: number;
    numero: number;
    fecha: string;
  } | null;
};

/** Orden de pago con sus medios (y cheques de terceros) e imputaciones. */
export async function cargarOrdenPago(
  supabase: Supabase,
  id: string,
): Promise<{ orden: OrdenPagoLeida; medios: MedioLeido[]; imputaciones: ImputacionLeida[] } | null | string> {
  const [orden, medios, imputaciones] = await Promise.all([
    supabase.from("orden_pago").select(COLUMNAS_ORDEN_PAGO).eq("id", id).maybeSingle(),
    supabase
      .from("orden_pago_medio")
      .select(
        "id, orden, tipo, importe, referencia, cheque_id, banco, numero, fecha_pago, " +
          "cheque:cheque_id(id, banco, numero, fecha_pago, librador, estado)",
      )
      .eq("orden_pago_id", id)
      .order("orden"),
    supabase
      .from("imputacion_compra")
      .select(
        "id, comprobante_compra_id, importe, automatica, comprobante:comprobante_compra_id(tipo, letra, punto_venta, numero, fecha)",
      )
      .eq("orden_pago_id", id)
      .order("creado_en"),
  ]);
  const error = orden.error ?? medios.error ?? imputaciones.error;
  if (error) return `No se pudo leer la orden de pago: ${error.message}`;
  if (!orden.data) return null;
  const o = orden.data as unknown as OrdenPagoLeida;
  return {
    orden: { ...o, total: Number(o.total) },
    medios: ((medios.data ?? []) as unknown as MedioLeido[]).map((m) => ({ ...m, importe: Number(m.importe) })),
    imputaciones: ((imputaciones.data ?? []) as unknown as ImputacionLeida[]).map((i) => ({
      ...i,
      importe: Number(i.importe),
      comprobante: i.comprobante
        ? { ...i.comprobante, punto_venta: Number(i.comprobante.punto_venta), numero: Number(i.comprobante.numero) }
        : null,
    })),
  };
}

/** Medio guardado → el que edita la pantalla. */
export function medioEditable(m: MedioLeido): MedioBorrador {
  return {
    tipo: m.tipo,
    importe: Number(m.importe),
    referencia: m.referencia,
    chequeId: m.cheque_id,
    banco: m.banco,
    numero: m.numero,
    fechaPago: m.fecha_pago,
  };
}

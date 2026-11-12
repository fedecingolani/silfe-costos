import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { CuentaElegible } from "@/lib/finanzas/medios";
import type { TransferenciaConCuentas } from "@/lib/finanzas/transferencias";
import type { CuentaFondos, MovimientoFondos, SaldoCuentaFondos, TipoCuentaFondos } from "@/lib/tipos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CuentaConSaldo = CuentaFondos & { saldo: SaldoCuentaFondos };

/** Tope de movimientos: con el rango de fechas alcanza para acotar. */
export const LIMITE_MOVIMIENTOS = 500;

function saldoVacio(cuentaId: string): SaldoCuentaFondos {
  return { cuenta_id: cuentaId, saldo_actual: 0, movimientos_futuros: 0, ultimo_movimiento: null };
}

function aSaldo(fila: SaldoCuentaFondos): SaldoCuentaFondos {
  return {
    ...fila,
    saldo_actual: Number(fila.saldo_actual),
    movimientos_futuros: Number(fila.movimientos_futuros),
  };
}

/** Cuentas de un tipo con su saldo: las activas primero, por nombre. */
export async function cargarCuentas(supabase: Supabase, tipo: TipoCuentaFondos): Promise<CuentaConSaldo[] | string> {
  const [cuentas, saldos] = await Promise.all([
    supabase
      .from("cuenta_fondos")
      .select("*")
      .eq("tipo", tipo)
      .order("activa", { ascending: false })
      .order("nombre"),
    supabase.from("v_cuenta_fondos_saldo").select("*"),
  ]);
  const error = cuentas.error ?? saldos.error;
  if (error) return `No se pudieron leer las cuentas: ${error.message}`;
  const porCuenta = new Map(((saldos.data ?? []) as SaldoCuentaFondos[]).map((s) => [s.cuenta_id, aSaldo(s)]));
  return ((cuentas.data ?? []) as CuentaFondos[]).map((c) => ({ ...c, saldo: porCuenta.get(c.id) ?? saldoVacio(c.id) }));
}

/** Una cuenta del tipo pedido con su saldo; null si no existe o es del otro tipo. */
export async function cargarCuenta(
  supabase: Supabase,
  id: string,
  tipo: TipoCuentaFondos,
): Promise<CuentaConSaldo | null | string> {
  const [cuenta, saldo] = await Promise.all([
    supabase.from("cuenta_fondos").select("*").eq("id", id).eq("tipo", tipo).maybeSingle(),
    supabase.from("v_cuenta_fondos_saldo").select("*").eq("cuenta_id", id).maybeSingle(),
  ]);
  const error = cuenta.error ?? saldo.error;
  if (error) return `No se pudo leer la cuenta: ${error.message}`;
  if (!cuenta.data) return null;
  return {
    ...(cuenta.data as CuentaFondos),
    saldo: saldo.data ? aSaldo(saldo.data as SaldoCuentaFondos) : saldoVacio(id),
  };
}

/** Movimientos del rango, del más nuevo al más viejo, con el saldo acumulado de toda la historia. */
export async function cargarMovimientos(
  supabase: Supabase,
  cuentaId: string,
  desde: string,
  hasta: string,
): Promise<MovimientoFondos[] | string> {
  const { data, error } = await supabase
    .from("v_movimiento_fondos")
    .select("*")
    .eq("cuenta_id", cuentaId)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .order("origen_id", { ascending: false })
    .order("origen", { ascending: false })
    .limit(LIMITE_MOVIMIENTOS);
  if (error) return `No se pudieron leer los movimientos: ${error.message}`;
  return ((data ?? []) as MovimientoFondos[]).map((m) => ({
    ...m,
    ingreso: Number(m.ingreso),
    egreso: Number(m.egreso),
    importe: Number(m.importe),
    saldo: Number(m.saldo),
  }));
}

/** Cuentas activas, bancos y cajas, por nombre: los destinos posibles de una transferencia. */
export async function cargarCuentasActivas(supabase: Supabase): Promise<CuentaElegible[] | string> {
  const { data, error } = await supabase
    .from("cuenta_fondos")
    .select("id, tipo, nombre")
    .eq("activa", true)
    .order("nombre");
  if (error) return `No se pudieron leer las cuentas: ${error.message}`;
  return (data ?? []) as CuentaElegible[];
}

/** Las transferencias de los movimientos, con el tipo de sus dos cuentas (para enlazar a la otra), por id. */
export async function cargarTransferencias(
  supabase: Supabase,
  movimientos: readonly MovimientoFondos[],
): Promise<Map<string, TransferenciaConCuentas> | string> {
  const ids = [...new Set(movimientos.filter((m) => m.origen === "transferencia").map((m) => m.origen_id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("transferencia_fondos")
    .select(
      "id, cuenta_origen_id, cuenta_destino_id, origen:cuenta_fondos!cuenta_origen_id(tipo), destino:cuenta_fondos!cuenta_destino_id(tipo)",
    )
    .in("id", ids);
  if (error) return `No se pudieron leer las transferencias: ${error.message}`;
  return new Map(((data ?? []) as unknown as (TransferenciaConCuentas & { id: string })[]).map((t) => [t.id, t]));
}

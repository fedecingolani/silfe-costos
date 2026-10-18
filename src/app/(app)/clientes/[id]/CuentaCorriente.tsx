import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { nombreComprobante } from "@/lib/comprobantes/listado";
import { diasDeAntiguedad, estadoSaldo } from "@/lib/cobranzas/cuenta-corriente";
import type { ClaseComprobante, CondicionPago } from "@/lib/tipos";

/** Tope de movimientos: con el rango de fechas alcanza para acotar. */
const LIMITE_MOVIMIENTOS = 500;

type Pendiente = {
  comprobante_id: string;
  clase: ClaseComprobante;
  numero_texto: string | null;
  fecha: string;
  condicion_pago: CondicionPago;
  total: number;
  saldo: number;
};

type Movimiento = {
  fecha: string;
  creado_en: string;
  tipo: ClaseComprobante | "recibo";
  comprobante_id: string | null;
  recibo_id: string | null;
  numero_texto: string | null;
  debe: number;
  haber: number;
  saldo: number;
};

function textoMovimiento(m: Movimiento): string {
  const nombre = m.tipo === "recibo" ? "Recibo" : nombreComprobante(m.tipo, null);
  return `${nombre} ${m.numero_texto ?? ""}`.trim();
}

/**
 * Cuenta corriente del cliente en su ficha: saldo actual, débitos pendientes
 * (del más viejo al más nuevo, con antigüedad) y movimientos del rango (del
 * más nuevo al más viejo, con el saldo acumulado de toda la historia). Sin
 * homologación ni recibos anulados (los excluyen las vistas).
 */
export async function CuentaCorriente({
  clienteId,
  desde,
  hasta,
  hoy,
}: {
  clienteId: string;
  desde: string;
  hasta: string;
  hoy: string;
}) {
  const supabase = await createClient();
  const [saldoRes, pendientesRes, movimientosRes] = await Promise.all([
    supabase
      .from("v_cliente_saldo")
      .select("saldo, deuda_pendiente, saldo_a_favor")
      .eq("cliente_id", clienteId)
      .maybeSingle(),
    supabase
      .from("v_comprobante_saldo")
      .select("comprobante_id, clase, numero_texto, fecha, condicion_pago, total, saldo")
      .eq("cliente_id", clienteId)
      .gt("saldo", 0)
      .order("fecha")
      .order("numero"),
    supabase
      .from("v_cuenta_corriente")
      .select("fecha, creado_en, tipo, comprobante_id, recibo_id, numero_texto, debe, haber, saldo")
      .eq("cliente_id", clienteId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(LIMITE_MOVIMIENTOS),
  ]);

  const error = saldoRes.error ?? pendientesRes.error ?? movimientosRes.error;
  if (error) {
    return (
      <Tarjeta titulo="Cuenta corriente" className="mb-6">
        <p role="alert" className="p-4 text-sm text-red-700">
          No se pudo cargar la cuenta corriente: {error.message}
        </p>
      </Tarjeta>
    );
  }

  const saldo = Number(saldoRes.data?.saldo ?? 0);
  const deuda = Number(saldoRes.data?.deuda_pendiente ?? 0);
  const aFavor = Number(saldoRes.data?.saldo_a_favor ?? 0);
  const estado = estadoSaldo(saldo);
  const pendientes = (pendientesRes.data ?? []) as Pendiente[];
  const movimientos = (movimientosRes.data ?? []) as Movimiento[];
  const colorSaldo = estado.tono === "rojo" ? "text-red-700" : estado.tono === "azul" ? "text-sky-700" : "text-stone-900";

  return (
    <div id="cuenta-corriente" className="mb-6 scroll-mt-4 space-y-4">
      <Tarjeta
        titulo="Cuenta corriente"
        descripcion="Facturas, notas de débito y crédito y recibos de producción o no electrónicos. Sin homologación ni recibos anulados."
        acciones={
          <Link href={`/cobranzas/nueva?cliente=${clienteId}`} className="boton-primario text-xs">
            Nueva cobranza
          </Link>
        }
      >
        <dl className="grid gap-4 p-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Saldo actual</dt>
            <dd className={`mt-0.5 flex items-center gap-2 text-lg font-semibold tabular-nums ${colorSaldo}`}>
              {pesos(Math.abs(saldo))} <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Pendiente de cobro</dt>
            <dd className="mt-0.5 text-sm tabular-nums">{pesos(deuda)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Saldo a favor</dt>
            <dd className="mt-0.5 text-sm tabular-nums">{pesos(aFavor)}</dd>
          </div>
        </dl>
      </Tarjeta>

      <Tarjeta titulo={`Pendientes (${pendientes.length})`} descripcion="Del más viejo al más nuevo.">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th className="text-right">Total</th>
                <th className="text-right">Saldo</th>
                <th className="text-right">Antigüedad</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.length === 0 && <Vacio mensaje="No tiene comprobantes pendientes." colSpan={5} />}
              {pendientes.map((p) => (
                <tr key={p.comprobante_id}>
                  <td className="whitespace-nowrap">{fecha(p.fecha)}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1">
                      <Link href={`/comprobantes/${p.comprobante_id}`} className="text-marca-700 hover:underline">
                        {nombreComprobante(p.clase, null)} {p.numero_texto ?? ""}
                      </Link>
                      {p.condicion_pago === "contado" && <Pastilla tono="ambar">Contado – pago pendiente</Pastilla>}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{pesos(Number(p.total))}</td>
                  <td className="text-right tabular-nums">{pesos(Number(p.saldo))}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{diasDeAntiguedad(p.fecha, hoy)} días</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Movimientos"
        descripcion={
          movimientos.length >= LIMITE_MOVIMIENTOS
            ? `Se muestran los ${LIMITE_MOVIMIENTOS} más recientes del rango: acotá las fechas.`
            : "Del más nuevo al más viejo. El saldo acumulado incluye los movimientos anteriores al rango."
        }
      >
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-stone-200 p-4">
          <div>
            <label className="etiqueta" htmlFor="cc-desde">
              Desde
            </label>
            <input id="cc-desde" name="cc_desde" type="date" defaultValue={desde} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cc-hasta">
              Hasta
            </label>
            <input id="cc-hasta" name="cc_hasta" type="date" defaultValue={hasta} className="campo" />
          </div>
          <button type="submit" className="boton-secundario">
            Filtrar
          </button>
          <Link href={`/clientes/${clienteId}#cuenta-corriente`} className="text-xs text-marca-700 hover:underline">
            Últimos 12 meses
          </Link>
        </form>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th className="text-right">Debe</th>
                <th className="text-right">Haber</th>
                <th className="text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 && <Vacio mensaje="Sin movimientos en el rango." colSpan={5} />}
              {movimientos.map((m) => {
                const href = m.recibo_id ? `/cobranzas/${m.recibo_id}` : `/comprobantes/${m.comprobante_id}`;
                return (
                  <tr key={`${m.tipo}-${m.recibo_id ?? m.comprobante_id}`}>
                    <td className="whitespace-nowrap">{fecha(m.fecha)}</td>
                    <td>
                      <Link href={href} className="text-marca-700 hover:underline">
                        {textoMovimiento(m)}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{Number(m.debe) ? pesos(Number(m.debe)) : ""}</td>
                    <td className="text-right tabular-nums">{Number(m.haber) ? pesos(Number(m.haber)) : ""}</td>
                    <td
                      className={`text-right tabular-nums ${Number(m.saldo) < 0 ? "text-sky-700" : Number(m.saldo) > 0 ? "text-red-700" : ""}`}
                    >
                      {pesos(Number(m.saldo))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}

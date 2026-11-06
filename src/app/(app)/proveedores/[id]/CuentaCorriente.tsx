import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { diasDeAntiguedad, estadoSaldoProveedor } from "@/lib/compras/cuenta-corriente/cuenta-corriente";
import type { TipoComprobanteCompra } from "@/lib/tipos";
import { AplicarSaldoAFavor } from "./AplicarSaldoAFavor";

/** Tope de movimientos: con el rango de fechas alcanza para acotar. */
const LIMITE_MOVIMIENTOS = 500;

type Pendiente = {
  comprobante_compra_id: string;
  numero_texto: string;
  fecha: string;
  fecha_vencimiento: string | null;
  total: number;
  saldo: number;
};

type Credito = {
  origen: "orden_pago" | "nota_credito";
  orden_pago_id: string | null;
  nota_credito_id: string | null;
  fecha: string;
  numero_texto: string;
  total: number;
  disponible: number;
};

type Movimiento = {
  fecha: string;
  creado_en: string;
  tipo: TipoComprobanteCompra | "orden_pago";
  comprobante_compra_id: string | null;
  orden_pago_id: string | null;
  numero_texto: string;
  debito: number;
  credito: number;
  saldo: number;
};

function hrefMovimiento(m: { orden_pago_id: string | null; comprobante_compra_id: string | null; nota_credito_id?: string | null }) {
  if (m.orden_pago_id) return `/compras/pagos/${m.orden_pago_id}`;
  return `/compras/comprobantes/${m.comprobante_compra_id ?? m.nota_credito_id}`;
}

function textoMovimiento(tipo: Movimiento["tipo"], numeroTexto: string): string {
  return tipo === "orden_pago" ? `Orden de pago ${numeroTexto}` : numeroTexto;
}

/**
 * Cuenta corriente del proveedor en su ficha: saldo actual, saldo a favor
 * por crédito, débitos pendientes (del más viejo al más nuevo, con
 * antigüedad, "Pagar" y "Aplicar saldo a favor") y movimientos del rango
 * (del más nuevo al más viejo, con el saldo acumulado de toda la historia).
 * Es la de clientes al revés: sin borradores ni anulados (los excluyen las
 * vistas).
 */
export async function CuentaCorriente({
  proveedorId,
  desde,
  hasta,
  hoy,
}: {
  proveedorId: string;
  desde: string;
  hasta: string;
  hoy: string;
}) {
  const supabase = await createClient();
  const [saldoRes, pendientesRes, creditosRes, movimientosRes] = await Promise.all([
    supabase
      .from("v_proveedor_saldo")
      .select("saldo, deuda_pendiente, saldo_a_favor")
      .eq("proveedor_id", proveedorId)
      .maybeSingle(),
    supabase
      .from("v_comprobante_compra_saldo")
      .select("comprobante_compra_id, numero_texto, fecha, fecha_vencimiento, total, saldo")
      .eq("proveedor_id", proveedorId)
      .gt("saldo", 0)
      .order("fecha")
      .order("numero_texto"),
    supabase
      .from("v_proveedor_saldo_a_favor")
      .select("origen, orden_pago_id, nota_credito_id, fecha, numero_texto, total, disponible")
      .eq("proveedor_id", proveedorId)
      .order("fecha")
      .order("creado_en"),
    supabase
      .from("v_proveedor_cuenta_corriente")
      .select("fecha, creado_en, tipo, comprobante_compra_id, orden_pago_id, numero_texto, debito, credito, saldo")
      .eq("proveedor_id", proveedorId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(LIMITE_MOVIMIENTOS),
  ]);

  const error = saldoRes.error ?? pendientesRes.error ?? creditosRes.error ?? movimientosRes.error;
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
  const estado = estadoSaldoProveedor(saldo);
  const pendientes = (pendientesRes.data ?? []) as Pendiente[];
  const creditos = (creditosRes.data ?? []) as Credito[];
  const movimientos = (movimientosRes.data ?? []) as Movimiento[];
  const colorSaldo = estado.tono === "rojo" ? "text-red-700" : estado.tono === "azul" ? "text-sky-700" : "text-stone-900";
  const hrefFicha = `/proveedores/${proveedorId}`;

  return (
    <div id="cuenta-corriente" className="mb-6 scroll-mt-4 space-y-4">
      <Tarjeta
        titulo="Cuenta corriente"
        descripcion="Facturas y notas de débito suman deuda; notas de crédito y órdenes de pago la restan. Sin borradores ni anulados."
        acciones={
          <Link href={`/compras/pagos/nuevo?proveedor=${proveedorId}`} className="boton-primario text-xs">
            Pagar
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
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Pendiente de pago</dt>
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
                <th>Vencimiento</th>
                <th className="text-right">Total</th>
                <th className="text-right">Saldo</th>
                <th className="text-right">Antigüedad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pendientes.length === 0 && <Vacio mensaje="No tiene comprobantes pendientes." colSpan={7} />}
              {pendientes.map((p) => (
                <tr key={p.comprobante_compra_id}>
                  <td className="whitespace-nowrap">{fecha(p.fecha)}</td>
                  <td>
                    <Link href={`/compras/comprobantes/${p.comprobante_compra_id}`} className="text-marca-700 hover:underline">
                      {p.numero_texto}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{p.fecha_vencimiento ? fecha(p.fecha_vencimiento) : "—"}</td>
                  <td className="text-right tabular-nums">{pesos(Number(p.total))}</td>
                  <td className="text-right tabular-nums">{pesos(Number(p.saldo))}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{diasDeAntiguedad(p.fecha, hoy)} días</td>
                  <td className="whitespace-nowrap text-right">
                    <span className="flex items-center justify-end gap-3">
                      {aFavor > 0 && (
                        <AplicarSaldoAFavor
                          proveedorId={proveedorId}
                          comprobanteId={p.comprobante_compra_id}
                          numeroTexto={p.numero_texto}
                          saldo={Number(p.saldo)}
                          aFavor={aFavor}
                        />
                      )}
                      <Link
                        href={`/compras/pagos/nuevo?proveedor=${proveedorId}&comprobante=${p.comprobante_compra_id}`}
                        className="text-xs text-marca-700 hover:underline"
                      >
                        Pagar
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {creditos.length > 0 && (
        <Tarjeta
          titulo={`Saldo a favor (${creditos.length})`}
          descripcion="Órdenes de pago y notas de crédito con algo sin imputar. Se aplican del más viejo al más nuevo."
        >
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Crédito</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {creditos.map((c) => (
                  <tr key={c.orden_pago_id ?? c.nota_credito_id}>
                    <td className="whitespace-nowrap">{fecha(c.fecha)}</td>
                    <td>
                      <Link
                        href={hrefMovimiento({ orden_pago_id: c.orden_pago_id, comprobante_compra_id: c.nota_credito_id })}
                        className="text-marca-700 hover:underline"
                      >
                        {textoMovimiento(c.origen, c.numero_texto)}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{pesos(Number(c.total))}</td>
                    <td className="text-right tabular-nums">{pesos(Number(c.disponible))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

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
          <Link href={`${hrefFicha}#cuenta-corriente`} className="text-xs text-marca-700 hover:underline">
            Últimos 12 meses
          </Link>
        </form>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th className="text-right">Débito</th>
                <th className="text-right">Crédito</th>
                <th className="text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 && <Vacio mensaje="Sin movimientos en el rango." colSpan={5} />}
              {movimientos.map((m) => (
                <tr key={`${m.tipo}-${m.orden_pago_id ?? m.comprobante_compra_id}`}>
                  <td className="whitespace-nowrap">{fecha(m.fecha)}</td>
                  <td>
                    <Link href={hrefMovimiento(m)} className="text-marca-700 hover:underline">
                      {textoMovimiento(m.tipo, m.numero_texto)}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{Number(m.debito) ? pesos(Number(m.debito)) : ""}</td>
                  <td className="text-right tabular-nums">{Number(m.credito) ? pesos(Number(m.credito)) : ""}</td>
                  <td
                    className={`text-right tabular-nums ${Number(m.saldo) < 0 ? "text-sky-700" : Number(m.saldo) > 0 ? "text-red-700" : ""}`}
                  >
                    {pesos(Number(m.saldo))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}

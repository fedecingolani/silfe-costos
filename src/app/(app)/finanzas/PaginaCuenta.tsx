import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fecha, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { rangoMovimientos } from "@/lib/cobranzas/cuenta-corriente";
import { PANTALLA_CUENTAS } from "@/lib/finanzas/cuentas";
import { enlaceOrigen, nombreOrigen } from "@/lib/finanzas/movimientos";
import type { MovimientoFondos, TipoCuentaFondos } from "@/lib/tipos";
import { actualizarCuenta } from "./acciones";
import { AnularAjuste } from "./AnularAjuste";
import { cargarCuenta, cargarMovimientos, LIMITE_MOVIMIENTOS } from "./datos";
import { FormularioCuenta } from "./FormularioCuenta";
import { RegistrarAjuste } from "./RegistrarAjuste";

export type ParametrosCuenta = { desde?: string; hasta?: string; editar?: string };

/** Descripción del movimiento, con enlace a su origen si tiene página (un recibo, una orden de pago o un cheque). */
function Descripcion({ movimiento }: { movimiento: MovimientoFondos }) {
  const enlace = enlaceOrigen(movimiento);
  if (!enlace) return <>{movimiento.descripcion}</>;
  return (
    <Link href={enlace} className="text-marca-700 hover:underline">
      {movimiento.descripcion}
    </Link>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Detalle de una cuenta de banco o de caja: datos, saldo actual y futuro,
 * y movimientos del rango (del más nuevo al más viejo, con el saldo
 * acumulado de toda la historia). Registra ajustes manuales y anula los
 * vigentes; los anulados no aparecen.
 */
export async function PaginaCuenta({
  tipo,
  id,
  parametros,
}: {
  tipo: TipoCuentaFondos;
  id: string;
  parametros: ParametrosCuenta;
}) {
  const pantalla = PANTALLA_CUENTAS[tipo];
  const supabase = await createClient();
  const hoy = hoyArgentina();
  const { desde, hasta } = rangoMovimientos({ desde: parametros.desde, hasta: parametros.hasta }, hoy);
  const [cuenta, movimientos] = await Promise.all([
    cargarCuenta(supabase, id, tipo),
    cargarMovimientos(supabase, id, desde, hasta),
  ]);

  if (cuenta === null) notFound();
  if (typeof cuenta === "string") return <p className="text-sm text-red-700">{cuenta}</p>;
  if (typeof movimientos === "string") return <p className="text-sm text-red-700">{movimientos}</p>;

  const hrefCuenta = `${pantalla.ruta}/${cuenta.id}`;
  const { saldo_actual, movimientos_futuros } = cuenta.saldo;

  return (
    <>
      <Migas items={[{ href: pantalla.ruta, texto: pantalla.titulo }, { texto: cuenta.nombre }]} />
      <Encabezado
        titulo={cuenta.nombre}
        descripcion={cuenta.observacion ?? undefined}
        acciones={
          <>
            <Link href={`${hrefCuenta}?editar=1`} className="boton-secundario">
              Editar
            </Link>
            {cuenta.activa && <RegistrarAjuste cuentaId={cuenta.id} tipoCuenta={tipo} hoy={hoy} />}
          </>
        }
      />

      <Tarjeta className="mb-6">
        <dl className="grid gap-4 p-4 sm:grid-cols-4">
          <Dato etiqueta="Saldo actual">
            <span className={`text-lg font-semibold tabular-nums ${saldo_actual < 0 ? "text-red-700" : "text-stone-900"}`}>
              {pesos(saldo_actual)}
            </span>
          </Dato>
          <Dato etiqueta="Movimientos futuros">
            <span className="tabular-nums">{movimientos_futuros ? pesos(movimientos_futuros) : "—"}</span>
            {movimientos_futuros !== 0 && (
              <span className="block text-xs text-stone-500">
                Saldo con lo futuro: {pesos(saldo_actual + movimientos_futuros)}
              </span>
            )}
          </Dato>
          <Dato etiqueta="Estado">
            {cuenta.activa ? <Pastilla tono="verde">Activa</Pastilla> : <Pastilla>Inactiva</Pastilla>}
          </Dato>
          {tipo === "banco" && (
            <Dato etiqueta="Banco">
              <div>{cuenta.banco ?? "—"}</div>
              {cuenta.numero_cuenta && <div className="text-xs text-stone-500">Cuenta {cuenta.numero_cuenta}</div>}
              {cuenta.cbu && <div className="text-xs text-stone-500">CBU {cuenta.cbu}</div>}
              {cuenta.alias && <div className="text-xs text-stone-500">Alias {cuenta.alias}</div>}
            </Dato>
          )}
        </dl>
        {!cuenta.activa && (
          <p className="border-t border-stone-200 px-4 py-3 text-xs text-stone-500">
            La cuenta está inactiva: no admite ajustes nuevos. Se reactiva desde «Editar».
          </p>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Movimientos"
        descripcion={
          movimientos.length >= LIMITE_MOVIMIENTOS
            ? `Se muestran los ${LIMITE_MOVIMIENTOS} más recientes del rango: acote las fechas.`
            : "Del más nuevo al más viejo. El saldo acumulado incluye los movimientos anteriores al rango. Lo anulado no aparece (ajustes, recibos y órdenes de pago)."
        }
      >
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-stone-200 p-4">
          <div>
            <label className="etiqueta" htmlFor="mov-desde">
              Desde
            </label>
            <input id="mov-desde" name="desde" type="date" defaultValue={desde} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="mov-hasta">
              Hasta
            </label>
            <input id="mov-hasta" name="hasta" type="date" defaultValue={hasta} className="campo" />
          </div>
          <button type="submit" className="boton-secundario">
            Filtrar
          </button>
          <Link href={hrefCuenta} className="text-xs text-marca-700 hover:underline">
            Últimos 12 meses
          </Link>
        </form>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Origen</th>
                <th>Concepto</th>
                <th className="text-right">Ingreso</th>
                <th className="text-right">Egreso</th>
                <th className="text-right">Saldo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 && <Vacio mensaje="Sin movimientos en el rango." colSpan={7} />}
              {movimientos.map((m) => (
                // Una orden de pago puede dar varios movimientos en la misma cuenta (sus cheques propios, en otras fechas).
                <tr key={`${m.origen}-${m.origen_id}-${m.fecha}`}>
                  <td className="whitespace-nowrap">
                    {fecha(m.fecha)}
                    {m.fecha > hoy && (
                      <span className="ml-2">
                        <Pastilla tono="ambar">Futuro</Pastilla>
                      </span>
                    )}
                  </td>
                  <td className="text-stone-500">{nombreOrigen(m.origen)}</td>
                  <td>
                    <div>
                      <Descripcion movimiento={m} />
                    </div>
                    {m.observacion && <div className="text-xs text-stone-400">{m.observacion}</div>}
                  </td>
                  <td className="text-right tabular-nums">{m.ingreso ? pesos(m.ingreso) : ""}</td>
                  <td className="text-right tabular-nums">{m.egreso ? pesos(m.egreso) : ""}</td>
                  <td className={`text-right tabular-nums ${m.saldo < 0 ? "text-red-700" : ""}`}>{pesos(m.saldo)}</td>
                  <td className="whitespace-nowrap text-right">
                    {m.origen === "ajuste" && (
                      <AnularAjuste ajusteId={m.origen_id} cuentaId={cuenta.id} tipoCuenta={tipo} descripcion={m.descripcion} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {parametros.editar && (
        <Modal titulo={`Editar: ${cuenta.nombre}`} abierto hrefAlCerrar={hrefCuenta}>
          <FormularioCuenta
            key={cuenta.id}
            accion={actualizarCuenta}
            tipo={tipo}
            cuenta={cuenta}
            cancelarHref={hrefCuenta}
          />
        </Modal>
      )}
    </>
  );
}

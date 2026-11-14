import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fecha, pesos } from "@/lib/formato";
import { sumarPesos } from "@/lib/cobranzas/dinero";
import { PANTALLA_CUENTAS } from "@/lib/finanzas/cuentas";
import type { TipoCuentaFondos } from "@/lib/tipos";
import { crearCuenta } from "./acciones";
import { cargarCuentas } from "./datos";
import { FormularioCuenta } from "./FormularioCuenta";

/** Listado de Bancos o de Caja: cuentas del tipo con saldo actual y movimientos futuros. */
export async function PaginaCuentas({ tipo }: { tipo: TipoCuentaFondos }) {
  const pantalla = PANTALLA_CUENTAS[tipo];
  const supabase = await createClient();
  const cuentas = await cargarCuentas(supabase, tipo);

  if (typeof cuentas === "string") {
    return <p className="text-sm text-red-700">{cuentas}</p>;
  }

  const total = sumarPesos(cuentas.filter((c) => c.activa).map((c) => c.saldo.saldo_actual));
  const columnas = tipo === "banco" ? 6 : 5;

  return (
    <>
      <Encabezado
        titulo={pantalla.titulo}
        descripcion={pantalla.descripcion}
        acciones={
          <Modal boton={`+ ${pantalla.nueva}`} titulo={pantalla.nueva}>
            <FormularioCuenta accion={crearCuenta} tipo={tipo} />
          </Modal>
        }
      />

      <Tarjeta
        titulo={`${cuentas.length} ${tipo === "banco" ? (cuentas.length === 1 ? "cuenta" : "cuentas") : cuentas.length === 1 ? "caja" : "cajas"}`}
        descripcion={`Saldo actual de las activas: ${pesos(total)}. El saldo cuenta los movimientos hasta hoy.`}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                {tipo === "banco" && <th>Banco / CBU</th>}
                <th className="text-right">Saldo actual</th>
                <th className="text-right">Movimientos futuros</th>
                <th>Último movimiento</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuentas.length === 0 && <Vacio mensaje={pantalla.vacio} colSpan={columnas} />}
              {cuentas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      href={`${pantalla.ruta}/${c.id}`}
                      className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                    >
                      {c.nombre}
                    </Link>
                  </td>
                  {tipo === "banco" && (
                    <td className="text-stone-500">
                      <div>{c.banco ?? "—"}</div>
                      {(c.cbu || c.alias) && <div className="text-xs text-stone-400">{c.cbu ?? c.alias}</div>}
                    </td>
                  )}
                  <td className={`text-right tabular-nums ${c.saldo.saldo_actual < 0 ? "text-red-700" : ""}`}>
                    {pesos(c.saldo.saldo_actual)}
                  </td>
                  <td className="text-right tabular-nums text-stone-500">
                    {c.saldo.movimientos_futuros ? pesos(c.saldo.movimientos_futuros) : "—"}
                  </td>
                  <td className="whitespace-nowrap text-stone-500">
                    {c.saldo.ultimo_movimiento ? fecha(c.saldo.ultimo_movimiento) : "—"}
                  </td>
                  <td>{c.activa ? <Pastilla tono="verde">Activa</Pastilla> : <Pastilla>Inactiva</Pastilla>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}
